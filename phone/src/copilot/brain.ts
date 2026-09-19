// Das Copilot-Hirn: Briefing, Live-Hinweise, Rückfragen.
//
// Aufbau in einem Satz: Claude bekommt die neun Toolbox-Werkzeuge als Werkzeugdefinitionen,
// ruft sie selbst auf, wir führen sie mit `toolboxClient.invoke(...)` aus und reichen die
// Ergebnisse zurück, bis die Antwort steht. Jede Antwort ist strukturiert (JSON-Schema statt
// freiem Text), damit die Oberfläche sie ohne Nachbearbeitung anzeigen kann.
//
// Drei Entscheidungen, die den Rest erklären:
//
// 1. Prompt-Caching. Systemprompt und Briefing ändern sich während eines Anrufs nicht, werden
//    aber bei jedem Hinweis erneut geschickt. Zwei Cache-Punkte: einer auf dem Systemprompt
//    (die Werkzeugdefinitionen stehen davor und sind damit mitgecacht), einer hinter dem
//    Briefing. Danach steht nur noch das Flüchtige – Transkript und Auslöser. Deshalb enthält
//    prompts.ts kein Datum und keinen Namen: ein einziges verändertes Byte im Präfix und der
//    ganze Cache ist hin.
//
// 2. Denkmodus bleibt an. Claude Opus 5 denkt von Haus aus adaptiv. Das Abschalten spart
//    weniger, als es kostet: ohne Denkmodus schreibt das Modell Werkzeugaufrufe gelegentlich
//    in den sichtbaren Text, statt sie als Aufruf zu senden – in einer Werkzeugschleife ein
//    stiller Totalausfall. Wir steuern den Aufwand stattdessen über `effort`: `low` in der
//    Live-Schleife, `high` beim Briefing, das nur einmal läuft.
//
// 3. Mock-Betrieb ist keine Notlösung, sondern der Vorführmodus. Mit `MOCK_BRAIN=1` oder ohne
//    Schlüssel kommen feste, plausible Antworten aus den Werkzeugdaten – ohne Modellaufruf,
//    ohne Netz. Die Oberfläche ist damit jederzeit vorführbar, und jeder Modellfehler fällt
//    still auf diesen Pfad zurück, statt die Anzeige leer zu lassen.

import type Anthropic from '@anthropic-ai/sdk'
import type { Answer, Briefing, BriefingCard, Severity, Suggestion } from './events.ts'
import { nextId } from './events.ts'
import { falten, gefaltetesMuster as fm } from './roles.ts'
import type { AskInput, Brain, HintInput, ToolName, ToolRow, ToolboxClient } from './types.ts'
import { LIMITS, TOOL_NAMES } from './types.ts'
import {
  SCHEMA_ANSWER, SCHEMA_BRIEFING, SCHEMA_HINTS,
  SYSTEM_ASK, SYSTEM_BRIEFING, SYSTEM_HINTS,
  askUser, briefingUser, hintsUser, istQuelle, quelle,
} from './prompts.ts'

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const env = (name: string, fallback: string): string => process.env[name]?.trim() || fallback

const CONF = {
  model: env('MODEL', 'claude-opus-5'),
  /** Aufwand der Live-Schleife. Niedrig, weil zwei Sekunden das Ziel sind. */
  effort: env('EFFORT', 'low') as Effort,
  maxTokens: Number(env('MAX_TOKENS', String(LIMITS.hintMaxTokens))),
  /** Das Briefing läuft einmal je Anruf und parallel zum Gesprächsbeginn – hier lohnt Aufwand. */
  effortBriefing: env('EFFORT_BRIEFING', 'high') as Effort,
  maxTokensBriefing: Number(env('MAX_TOKENS_BRIEFING', '4000')),
  /** Obergrenze für Runden in der Werkzeugschleife. */
  hopsBriefing: 6,
  hopsLive: 3,
  /** So viele Zeichen eines Werkzeugergebnisses gehen ans Modell. */
  ergebnisZeichen: 24_000,
}

/** Ohne Schlüssel oder mit MOCK_BRAIN=1 läuft alles ohne Modell. */
const mockModus = (): boolean => process.env.MOCK_BRAIN === '1' || !process.env.ANTHROPIC_API_KEY

/** Nur Opus 5 und Fable 5 kennen die serverseitige Ausweichkette. */
const kannAusweichen = (model: string): boolean => /^claude-(opus-5|fable-5)/.test(model)

const abbruchFehler = (grund: string) => new DOMException(grund, 'AbortError')
const istAbbruch = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError'

/** Hat der Server die strukturierte Ausgabe zurückgewiesen? Dann lohnt ein Versuch ohne Schema. */
const istFormatFehler = (e: unknown): boolean =>
  !istAbbruch(e) &&
  (e as { status?: number })?.status === 400 &&
  /output_config|json_schema|format|schema/i.test(e instanceof Error ? e.message : '')

// ---------------------------------------------------------------------------
// Kleine Helfer für Werkzeugzeilen
// ---------------------------------------------------------------------------

/** Feld aus einer Werkzeugzeile holen, unabhängig von Schreibweise und Trennzeichen. */
export function feld(row: ToolRow | undefined, ...namen: string[]): unknown {
  if (!row) return undefined
  const flach = (s: string) => s.toLowerCase().replace(/[_\s-]/g, '')
  const index = new Map(Object.keys(row).map((k) => [flach(k), k]))
  for (const n of namen) {
    const treffer = index.get(flach(n))
    if (treffer !== undefined && row[treffer] !== null && row[treffer] !== undefined) return row[treffer]
  }
  return undefined
}

const alsZahl = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

const alsText = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

const WAEHRUNG: Record<string, string> = { CHF: 'Franken', EUR: 'Euro', USD: 'Dollar', GBP: 'Pfund' }

/** Beträge so, wie man sie am Telefon sagt: «rund 726 Tausend Franken». */
export function franken(n: number | null, ccy = 'CHF'): string {
  if (n === null) return 'keine Angabe'
  const w = WAEHRUNG[ccy.toUpperCase()] ?? ccy
  const a = Math.abs(n)
  const vz = n < 0 ? 'minus ' : ''
  if (a >= 1_000_000) return `${vz}rund ${(a / 1_000_000).toFixed(1).replace('.', ',')} Millionen ${w}`
  if (a >= 1_000) return `${vz}rund ${Math.round(a / 1_000)} Tausend ${w}`
  return `${vz}rund ${Math.round(a)} ${w}`
}

/** Prozente aus Brüchen 0..1, gesprochen: «8,3 Prozent», «minus 4 Prozent». */
export function prozent(bruch: number | null): string {
  if (bruch === null) return 'keine Angabe'
  const zahl = Math.abs(bruch * 100).toFixed(1)
  return `${bruch < 0 ? 'minus ' : ''}${zahl.replace('.', ',').replace(/,0$/, '')} Prozent`
}

/** «1 offener Verstoss» statt «1 offene Verstösse». */
const anzahl = (n: number, einzahl: string, mehrzahl: string): string => `${n} ${n === 1 ? einzahl : mehrzahl}`

// ---------------------------------------------------------------------------
// Die Werkzeugschleife
// ---------------------------------------------------------------------------

type Zweck = 'briefing' | 'hints' | 'ask'

type Auftrag = {
  zweck: Zweck
  system: string
  /** Über das Gespräch stabiler Teil der Nachricht; bekommt den zweiten Cache-Punkt. */
  stabil: string
  /** Wechselt bei jedem Aufruf; steht deshalb hinter dem Cache-Punkt. */
  fluechtig: string
  schema: Record<string, unknown>
  maxTokens: number
  effort: Effort
  hops: number
  clientRef: string | null
  signal?: AbortSignal
}

type Lauf = { daten: unknown; quellen: string[] }

export function createBrain(toolboxClient: ToolboxClient, opts: { log?: (zeile: string) => void } = {}): Brain {
  const log = (zeile: string) => (opts.log ?? console.log)(`[hirn] ${zeile}`)

  let sdk: Promise<Anthropic> | null = null
  let werkzeuge: Promise<Anthropic.Beta.BetaToolUnion[]> | null = null
  const daten = new Map<string, Promise<Geladen>>()
  const laufend = new Map<Zweck, AbortController>()

  // -------------------------------------------------------------------------
  // Modellzugang, bewusst spät geladen: im Mock-Betrieb wird das SDK nie angefasst,
  // damit die Vorführung auch ohne installiertes Paket und ohne Netz läuft.
  // -------------------------------------------------------------------------

  const client = async (): Promise<Anthropic> => {
    if (!sdk) sdk = import('@anthropic-ai/sdk').then((m) => new m.default())
    return sdk
  }

  const werkzeugdefinitionen = async (): Promise<Anthropic.Beta.BetaToolUnion[]> => {
    if (!werkzeuge) {
      werkzeuge = toolboxClient.describe().then((liste) =>
        // Feste Reihenfolge: Werkzeuge stehen ganz vorne im Präfix, jede Umsortierung
        // würde den Cache für Systemprompt und Briefing mit entwerten.
        [...liste]
          .sort((a, b) => TOOL_NAMES.indexOf(a.name) - TOOL_NAMES.indexOf(b.name))
          .map((w) => ({ name: w.name, description: w.description, input_schema: w.inputSchema })),
      )
    }
    return werkzeuge
  }

  /** Ein Werkzeug ausführen und die Quelle mitschreiben. */
  const fuehreAus = async (
    block: Anthropic.Beta.BetaToolUseBlock,
    quellen: Set<string>,
    fallbackRef: string | null,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
    const args = (block.input ?? {}) as Record<string, unknown>
    const ref = alsText(args.client_ref ?? args.clientRef) ?? fallbackRef
    try {
      const rows = await toolboxClient.invoke(block.name as ToolName, args)
      quellen.add(quelle(block.name, ref))
      const text = JSON.stringify(rows)
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: text.length > CONF.ergebnisZeichen
          ? `${text.slice(0, CONF.ergebnisZeichen)}\n[gekürzt: ${rows.length} Zeilen, nur der Anfang]`
          : text || '[]',
      }
    } catch (e) {
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        is_error: true,
        content: `Werkzeug ${block.name} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}. Antworte ohne diese Angabe und sage, dass sie fehlt.`,
      }
    }
  }

  /**
   * Eine vollständige Anfrage samt Werkzeugschleife. Abbrechbar: kommt während eines
   * laufenden Aufrufs eine neue Kundenaussage, wirft das Signal und der Lauf wird verworfen.
   */
  const laufe = async (a: Auftrag): Promise<Lauf> => {
    try {
      return await laufeEinmal(a, false)
    } catch (e) {
      // Strukturierte Ausgaben und Werkzeuge vertragen sich; weist der Server die Kombination
      // wider Erwarten doch zurück, ist ein zweiter Versuch ohne Schema allemal besser als
      // eine leere Karte. Der Systemprompt verlangt ohnehin ein einzelnes JSON-Objekt, und
      // parseJson kommt auch mit Text drumherum zurecht.
      if (istFormatFehler(e)) {
        log(`${a.zweck}: strukturierte Ausgabe abgelehnt, zweiter Versuch ohne Schema`)
        return laufeEinmal(a, true)
      }
      throw e
    }
  }

  const laufeEinmal = async (a: Auftrag, ohneFormat: boolean): Promise<Lauf> => {
    const t0 = Date.now()
    let erstesToken = 0
    let runden = 0
    const quellen = new Set<string>()
    const anthropic = await client()
    const tools = await werkzeugdefinitionen()

    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: 'text', text: a.system, cache_control: { type: 'ephemeral' } },
    ]
    const messages: Anthropic.Beta.BetaMessageParam[] = [{
      role: 'user',
      content: [
        { type: 'text', text: a.stabil, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: a.fluechtig },
      ],
    }]

    let text = ''
    let gelesen = 0
    let geschrieben = 0

    for (runden = 1; runden <= a.hops; runden++) {
      if (a.signal?.aborted) throw abbruchFehler('Aufruf verworfen')
      const stream = anthropic.beta.messages.stream(
        {
          model: CONF.model,
          max_tokens: a.maxTokens,
          system,
          messages,
          tools,
          output_config: { effort: a.effort, ...(ohneFormat ? {} : { format: { type: 'json_schema', schema: a.schema } }) },
          // Lehnt das Modell eine Anfrage aus Sicherheitsgründen ab, übernimmt serverseitig ein
          // anderes Modell im selben Aufruf, statt dass der Berater vor einer leeren Karte sitzt.
          // Nur Opus 5 und Fable 5 kennen das; bei einem anderen MODEL bleiben beide Felder
          // undefiniert und fallen damit aus der Anfrage heraus.
          betas: kannAusweichen(CONF.model) ? ['server-side-fallback-2026-07-01'] : undefined,
          fallbacks: kannAusweichen(CONF.model) ? 'default' : undefined,
        },
        { signal: a.signal },
      )
      stream.on('text', () => { if (!erstesToken) erstesToken = Date.now() - t0 })

      const message = await stream.finalMessage()
      gelesen += message.usage.cache_read_input_tokens ?? 0
      geschrieben += message.usage.cache_creation_input_tokens ?? 0

      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content })
        continue
      }
      if (message.stop_reason === 'refusal') throw new Error('Das Modell hat die Antwort abgelehnt')

      if (message.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: message.content })
        const aufrufe = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        // Alle Werkzeuge einer Runde parallel, die Ergebnisse in einer einzigen Nachricht
        // zurück – getrennte Nachrichten gewöhnen dem Modell parallele Aufrufe ab.
        const ergebnisse = await Promise.all(aufrufe.map((b) => fuehreAus(b, quellen, a.clientRef)))
        messages.push({ role: 'user', content: ergebnisse })
        continue
      }

      text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      break
    }

    const gesamt = Date.now() - t0
    log(`${a.zweck}${a.clientRef ? ` ${a.clientRef}` : ''}: erstes Token ${erstesToken || gesamt} ms, gesamt ${gesamt} ms, ${runden} Runde(n), ${quellen.size} Werkzeug(e), Cache gelesen ${gelesen} / geschrieben ${geschrieben}`)
    if (!text.trim()) throw new Error('Leere Antwort des Modells')
    return { daten: parseJson(text), quellen: [...quellen] }
  }

  /** Modellaufruf mit Rückfall: was schiefgeht, landet im Mock-Pfad statt in einer leeren Anzeige. */
  const versuche = async <T>(zweck: Zweck, arbeit: () => Promise<T>, ersatz: () => Promise<T>): Promise<T> => {
    if (mockModus()) return ersatz()
    try {
      return await arbeit()
    } catch (e) {
      if (istAbbruch(e)) throw e
      log(`${zweck} über das Modell fehlgeschlagen, Rückfall auf feste Antworten: ${e instanceof Error ? e.message : String(e)}`)
      return ersatz()
    }
  }

  /** Eigenes Signal je Zweck: ein neuer Aufruf verwirft den laufenden. */
  const signalFuer = (zweck: Zweck, extern?: AbortSignal): AbortSignal => {
    laufend.get(zweck)?.abort(abbruchFehler('Durch einen neueren Aufruf ersetzt'))
    const c = new AbortController()
    laufend.set(zweck, c)
    return extern ? AbortSignal.any([extern, c.signal]) : c.signal
  }

  // -------------------------------------------------------------------------
  // Daten für den Mock-Betrieb: dieselben Werkzeuge, nur ohne Modell dazwischen.
  // -------------------------------------------------------------------------

  const geladen = (clientRef: string): Promise<Geladen> => {
    let vorhanden = daten.get(clientRef)
    if (!vorhanden) {
      vorhanden = ladeAlles(toolboxClient, clientRef)
      daten.set(clientRef, vorhanden)
    }
    return vorhanden
  }

  // -------------------------------------------------------------------------
  // Die drei Aufgaben
  // -------------------------------------------------------------------------

  return {
    async briefing(clientRef, signal) {
      if (signal?.aborted) throw abbruchFehler('Aufruf verworfen')
      return versuche(
        'briefing',
        async () => {
          const { daten: roh, quellen } = await laufe({
            zweck: 'briefing',
            system: SYSTEM_BRIEFING,
            stabil: `Kundennummer: ${clientRef}`,
            fluechtig: briefingUser(clientRef),
            schema: SCHEMA_BRIEFING,
            maxTokens: CONF.maxTokensBriefing,
            effort: CONF.effortBriefing,
            hops: CONF.hopsBriefing,
            clientRef,
            signal,
          })
          const karten = alsBriefing(roh, quellen)
          if (!karten.length) throw new Error('Briefing ohne brauchbare Karten')
          return karten
        },
        async () => mockBriefing(await geladen(clientRef), clientRef),
      )
    },

    async hints(input, signal) {
      // Drosselung: es ist höchstens ein Hinweis-Aufruf unterwegs. Trifft eine neue Aussage
      // ein, wird der laufende verworfen – der frischere Kontext gewinnt, ohne Wartezeit.
      const eigen = signalFuer('hints', signal)
      if (signal?.aborted) throw abbruchFehler('Aufruf verworfen')
      try {
        return await versuche(
          'hints',
          async () => {
            const { stabil, fluechtig } = hintsUser(input, LIMITS.transcriptWindow)
            const { daten: roh, quellen } = await laufe({
              zweck: 'hints',
              system: SYSTEM_HINTS,
              stabil,
              fluechtig,
              schema: SCHEMA_HINTS,
              maxTokens: Math.min(CONF.maxTokens, LIMITS.hintMaxTokens),
              effort: CONF.effort,
              hops: CONF.hopsLive,
              clientRef: input.clientRef,
              signal: eigen,
            })
            return alsSuggestions(roh, input, quellen)
          },
          async () => mockHints(await geladen(input.clientRef), input),
        )
      } catch (e) {
        // Vom Nachfolger verworfen: nichts anzeigen. Von aussen abgebrochen: weiterreichen.
        if (istAbbruch(e) && !signal?.aborted) return []
        throw e
      }
    },

    async ask(input, signal) {
      const eigen = signalFuer('ask', signal)
      if (signal?.aborted) throw abbruchFehler('Aufruf verworfen')
      try {
        return await versuche(
          'ask',
          async () => {
            const { stabil, fluechtig } = askUser(input, LIMITS.transcriptWindow)
            const { daten: roh, quellen } = await laufe({
              zweck: 'ask',
              system: SYSTEM_ASK,
              stabil,
              fluechtig,
              schema: SCHEMA_ANSWER,
              maxTokens: CONF.maxTokens,
              effort: CONF.effort,
              hops: CONF.hopsLive,
              clientRef: input.clientRef,
              signal: eigen,
            })
            return alsAnswer(roh, input, quellen)
          },
          async () => mockAsk(input.clientRef ? await geladen(input.clientRef) : leer(), input),
        )
      } catch (e) {
        if (istAbbruch(e) && !signal?.aborted) {
          return { type: 'answer', callId: input.callId, id: nextId('a'), question: input.question, text: 'Durch eine neuere Frage ersetzt.', supported: false, sources: [] }
        }
        throw e
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Antwort des Modells auf den Ereignisvertrag bringen
// ---------------------------------------------------------------------------

/** Modelle ohne erzwungenes Format umrahmen JSON gelegentlich mit Text. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const ende = text.lastIndexOf('}')
    if (start < 0 || ende <= start) throw new Error('Antwort des Modells enthält kein JSON')
    return JSON.parse(text.slice(start, ende + 1))
  }
}

const SCHWEREN: Severity[] = ['risk', 'warn', 'ok', 'info']
const alsSeverity = (v: unknown, fallback: Severity = 'info'): Severity =>
  SCHWEREN.includes(v as Severity) ? (v as Severity) : fallback

/** Nullwerte aus optionalen Feldern werfen; das Schema verlangt sie, der Vertrag nicht. */
const ohneNull = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T

/**
 * `sources` darf laut Vertrag nie leer sein. Vier Stufen, von der besten Quelle abwärts:
 * vom Modell genannt UND in dieser Runde wirklich aufgerufen, nur vom Modell genannt (dann
 * stammt die Zahl aus dem Briefing, das seinerseits Quellen trägt), sonst die aufgerufenen
 * Werkzeuge, sonst das Briefing selbst. Eine erfundene Quellenangabe fällt dabei weg, weil
 * `istQuelle` nur die vereinbarte Schreibweise durchlässt.
 */
const AUS_BRIEFING = (clientRef: string | null): string => quelle('briefing', clientRef)

const quellenPruefen = (roh: unknown, benutzt: string[], clientRef: string | null): string[] => {
  const vomModell = Array.isArray(roh) ? [...new Set(roh.filter(istQuelle))] : []
  const bestaetigt = vomModell.filter((q) => benutzt.includes(q))
  if (bestaetigt.length) return bestaetigt
  if (vomModell.length) return vomModell
  if (benutzt.length) return benutzt
  return [AUS_BRIEFING(clientRef)]
}

export function alsBriefing(roh: unknown, quellen: string[]): Briefing {
  const karten = (roh as { cards?: unknown[] })?.cards
  if (!Array.isArray(karten)) return []
  const raus: BriefingCard[] = []
  for (const k of karten) {
    const c = k as Record<string, unknown>
    const items = Array.isArray(c.items) ? (c.items as Record<string, unknown>[]) : []
    switch (c.type) {
      case 'headline':
        if (alsText(c.text)) raus.push(ohneNull({ type: 'headline', text: String(c.text), sub: alsText(c.sub) ?? undefined }) as BriefingCard)
        break
      case 'metrics': {
        const m = items.filter((i) => alsText(i.label) && alsText(i.value))
          .map((i) => ohneNull({ label: String(i.label), value: String(i.value), delta: alsText(i.delta) ?? undefined, tone: SCHWEREN.includes(i.tone as Severity) ? (i.tone as Severity) : undefined }))
        if (m.length) raus.push({ type: 'metrics', items: m })
        break
      }
      case 'allocation': {
        const rows = (Array.isArray(c.rows) ? (c.rows as Record<string, unknown>[]) : [])
          .filter((r) => alsText(r.label) && alsZahl(r.actual) !== null)
          .map((r) => ({ label: String(r.label), min: alsZahl(r.min) ?? 0, target: alsZahl(r.target) ?? 0, max: alsZahl(r.max) ?? 0, actual: alsZahl(r.actual) ?? 0 }))
        if (rows.length) raus.push({ type: 'allocation', title: alsText(c.title) ?? 'Soll und Ist', rows })
        break
      }
      case 'flags': {
        const f = items.filter((i) => alsText(i.text))
          .map((i) => ({ severity: alsSeverity(i.severity, 'warn'), text: String(i.text), source: istQuelle(i.source) ? String(i.source) : (quellen[0] ?? AUS_BRIEFING(null)) }))
        if (f.length) raus.push({ type: 'flags', title: alsText(c.title) ?? 'Risiken und Chancen', items: f })
        break
      }
      case 'actions': {
        const a = items.filter((i) => alsText(i.text)).map((i) => ({ text: String(i.text), why: alsText(i.why) ?? '' }))
        if (a.length) raus.push({ type: 'actions', title: alsText(c.title) ?? 'Nächste Schritte', items: a })
        break
      }
      case 'questions': {
        const q = items.filter((i) => alsText(i.q)).map((i) => ({ q: String(i.q), a: alsText(i.a) ?? '' }))
        if (q.length) raus.push({ type: 'questions', title: alsText(c.title) ?? 'Womit der Kunde kommt', items: q })
        break
      }
      default:
        break
    }
  }
  return raus
}

export function alsSuggestions(roh: unknown, input: HintInput, quellen: string[]): Suggestion[] {
  const liste = (roh as { suggestions?: unknown[] })?.suggestions
  if (!Array.isArray(liste)) return []
  const arten = ['say', 'fact', 'next', 'warning'] as const
  return liste
    .map((s) => s as Record<string, unknown>)
    .filter((s) => alsText(s.text))
    .slice(0, 3)
    .map((s) => ({
      type: 'suggestion' as const,
      callId: input.callId,
      id: nextId('s'),
      kind: (arten.includes(s.kind as (typeof arten)[number]) ? s.kind : 'fact') as Suggestion['kind'],
      text: String(s.text).trim(),
      why: alsText(s.why) ?? '',
      sources: quellenPruefen(s.sources, quellen, input.clientRef),
      trigger: input.trigger,
      severity: alsSeverity(s.severity),
    }))
}

export function alsAnswer(roh: unknown, input: AskInput, quellen: string[]): Answer {
  const a = (roh ?? {}) as Record<string, unknown>
  const supported = a.supported === true
  return {
    type: 'answer',
    callId: input.callId,
    id: nextId('a'),
    question: input.question,
    text: alsText(a.text) ?? 'Dazu liegen mir keine Daten vor.',
    supported,
    sources: supported ? quellenPruefen(a.sources, quellen, input.clientRef) : [],
  }
}

// ---------------------------------------------------------------------------
// Mock-Betrieb: feste, plausible Antworten aus den Werkzeugdaten, ohne Modell.
// Damit bleibt die Oberfläche ohne Schlüssel und ohne Netz vorführbar – und jeder
// Modellfehler landet weich hier statt in einer leeren Anzeige.
// ---------------------------------------------------------------------------

type Geladen = {
  clientRef: string
  quellen: string[]
  uebersicht: ToolRow | undefined
  portfolio: ToolRow | undefined
  positionen: ToolRow[]
  saa: ToolRow[]
  vorschlaege: ToolRow[]
  /** Nur echte, offene Verstösse. */
  verstoesse: ToolRow[]
  /** Individuell ausgesetzte Regeln – bewusst vereinbarte Ausnahmen, keine Verstösse. */
  ausnahmen: ToolRow[]
  notizen: ToolRow[]
}

const leer = (): Geladen => ({ clientRef: '', quellen: [], uebersicht: undefined, portfolio: undefined, positionen: [], saa: [], vorschlaege: [], verstoesse: [], ausnahmen: [], notizen: [] })

const HOLEN: ToolName[] = [
  'get_client_overview', 'get_portfolio_summary', 'get_positions_top',
  'get_saa_gap', 'get_open_proposals', 'get_violations', 'get_recent_notes',
]

/** Alle sieben Kundenwerkzeuge parallel. Fehlschläge bleiben leer, statt alles zu kippen. */
async function ladeAlles(toolbox: ToolboxClient, clientRef: string): Promise<Geladen> {
  const quellen: string[] = []
  const rufe = HOLEN.map(async (name) => {
    try {
      const rows = await toolbox.invoke(name, { client_ref: clientRef })
      quellen.push(quelle(name, clientRef))
      return rows
    } catch {
      return [] as ToolRow[]
    }
  })
  const [uebersicht, portfolio, positionen, saa, vorschlaege, regeln, notizen] = await Promise.all(rufe)
  // Eine individuell ausgesetzte Regel (is_override = 1) ist kein offener Verstoss, sondern
  // eine bewusst vereinbarte Ausnahme. Wer beides zusammenzählt, meldet dem Berater einen
  // Verstoss, den es nicht gibt – deshalb hier und nicht erst in der Anzeige getrennt.
  const istAusnahme = (r: ToolRow) => {
    const v = feld(r, 'is_override', 'override', 'is_overridden')
    return v === 1 || v === true || v === '1' || String(v).toLowerCase() === 'true'
  }
  return {
    clientRef,
    quellen,
    uebersicht: uebersicht[0],
    portfolio: portfolio[0],
    positionen: positionen.slice(0, 5),
    saa,
    vorschlaege,
    verstoesse: regeln.filter((r) => !istAusnahme(r)),
    ausnahmen: regeln.filter(istAusnahme),
    notizen: notizen.slice(0, 5),
  }
}

const q = (g: Geladen, name: ToolName): string => quelle(name, g.clientRef)

// Die Entwicklung des Depotwerts stammt aus dem Wertverlauf und enthält Ein- und Auszahlungen.
// Sie ist KEINE Rendite: ein reines Kontoportfolio steigt so zweistellig, ohne dass etwas
// erwirtschaftet wurde. Deshalb steht die Einschränkung fest an jeder Stelle, die die Zahl zeigt,
// und die Wörter Rendite und Performance kommen im ganzen Mock-Pfad nicht vor.
const WERT_LABEL = 'Depotwert seit Jahresbeginn'
const WERT_ZUSATZ = 'inklusive Ein- und Auszahlungen, keine Rendite'
const wertentwicklung = (g: Geladen): number | null =>
  alsZahl(feld(g.portfolio, 'value_change_ytd', 'performance_ytd', 'wertentwicklung_ytd'))
const wertSatz = (ytd: number): string =>
  `Ihr Depotwert hat sich seit Jahresbeginn um ${prozent(ytd)} verändert; darin sind Ein- und Auszahlungen enthalten.`

export function mockBriefing(g: Geladen, clientRef: string): Briefing {
  const karten: Briefing = []
  const name = alsText(feld(g.uebersicht, 'name', 'client_name')) ?? clientRef
  const ccy = alsText(feld(g.uebersicht, 'reporting_ccy', 'currency')) ?? 'CHF'
  const aum = alsZahl(feld(g.uebersicht, 'aum', 'assets_under_management'))
  const profil = alsText(feld(g.uebersicht, 'risk_profile', 'risk_profile_name'))
  const strategie = alsText(feld(g.portfolio, 'strategy_name', 'service_name'))
  const ytd = wertentwicklung(g)

  if (!g.quellen.length) {
    return [{ type: 'headline', text: `Keine Daten zu ${clientRef} erreichbar.`, sub: 'Die Toolbox antwortet nicht – der Copilot läuft im Vorführmodus ohne Kundendaten.' }]
  }

  karten.push({
    type: 'headline',
    text: aum !== null ? `${name}: ${franken(aum, ccy)} unter Verwaltung.` : `${name}: Lage aus den Stammdaten.`,
    // Fehlt eine Angabe, steht das da – ersetzt wird sie nicht.
    sub: [`Risikoprofil ${profil ?? 'nicht hinterlegt'}`, strategie, `Währung ${ccy}`].filter(Boolean).join(' · '),
  })

  const kennzahlen: { label: string; value: string; delta?: string; tone?: Severity }[] = []
  if (ytd !== null) kennzahlen.push({ label: WERT_LABEL, value: prozent(ytd), delta: WERT_ZUSATZ, tone: ytd < 0 ? 'risk' : 'info' })
  const vola = alsZahl(feld(g.portfolio, 'volatility'))
  if (vola !== null) kennzahlen.push({ label: 'Volatilität', value: prozent(vola), tone: 'info' })
  const liquid = alsZahl(feld(g.uebersicht, 'liquidity'))
  if (liquid !== null) kennzahlen.push({ label: 'Liquidität', value: franken(liquid, ccy), tone: 'info' })
  if (g.positionen[0]) {
    const gewicht = alsZahl(feld(g.positionen[0], 'weight'))
    kennzahlen.push({
      label: `Grösste Position: ${alsText(feld(g.positionen[0], 'security_name', 'name')) ?? 'unbekannt'}`,
      value: gewicht !== null ? prozent(gewicht) : franken(alsZahl(feld(g.positionen[0], 'amount')), ccy),
      tone: gewicht !== null && gewicht > 0.1 ? 'warn' : 'info',
    })
  }
  if (kennzahlen.length) karten.push({ type: 'metrics', items: kennzahlen })

  const bandzeilen = g.saa
    .map((r) => ({
      label: alsText(feld(r, 'category', 'saa_asset_class', 'label')) ?? '',
      min: alsZahl(feld(r, 'min_pct', 'min')) ?? 0,
      target: alsZahl(feld(r, 'target_pct', 'target')) ?? 0,
      max: alsZahl(feld(r, 'max_pct', 'max')) ?? 0,
      actual: alsZahl(feld(r, 'actual_pct', 'actual', 'ist')) ?? 0,
    }))
    .filter((r) => r.label)
    .slice(0, 6)
  if (bandzeilen.length) karten.push({ type: 'allocation', title: 'Soll und Ist der Anlagestrategie', rows: bandzeilen })

  const flaggen = [
    ...g.verstoesse.slice(0, 4).map((v) => ({
      severity: (alsText(feld(v, 'severity'))?.toLowerCase().startsWith('h') ? 'risk' : 'warn') as Severity,
      text: alsText(feld(v, 'rule_description', 'rule_code')) ?? 'Verstoss gegen eine Anlagerichtlinie',
      source: q(g, 'get_violations'),
    })),
    ...bandzeilen.filter((r) => r.actual > r.max || r.actual < r.min).slice(0, 2).map((r) => ({
      severity: 'risk' as Severity,
      text: `${r.label} liegt bei ${prozent(r.actual)} und damit ausserhalb der Bandbreite ${prozent(r.min)} bis ${prozent(r.max)}.`,
      source: q(g, 'get_saa_gap'),
    })),
    ...g.vorschlaege.slice(0, 2).map((p) => ({
      severity: 'info' as Severity,
      text: `Offener Vorschlag vom ${alsText(feld(p, 'proposed_at')) ?? 'unbekannten Datum'}: ${alsText(feld(p, 'reason', 'notes', 'advisory_type')) ?? 'ohne Begründung erfasst'}.`,
      source: q(g, 'get_open_proposals'),
    })),
    ...g.ausnahmen.slice(0, 2).map((v) => ({
      severity: 'info' as Severity,
      text: `Bewusst vereinbarte Ausnahme, kein offener Verstoss: ${alsText(feld(v, 'rule_description', 'rule_code')) ?? 'Regel ohne Beschreibung'}.`,
      source: q(g, 'get_violations'),
    })),
  ]
  if (flaggen.length) karten.push({ type: 'flags', title: 'Risiken und Chancen', items: flaggen })

  const fragen = [
    ytd !== null ? { q: 'Wie steht mein Depot dieses Jahr da?', a: `${wertSatz(ytd)} (${q(g, 'get_portfolio_summary')}).` } : null,
    g.verstoesse.length ? { q: 'Ist bei mir alles in Ordnung?', a: `Erfasst sind ${anzahl(g.verstoesse.length, 'offener Regelverstoss', 'offene Regelverstösse')} (${q(g, 'get_violations')}).` } : null,
    g.notizen[0] ? { q: 'Haben Sie meine letzte Anfrage notiert?', a: `Letzte Notiz vom ${alsText(feld(g.notizen[0], 'created_at')) ?? 'unbekannten Datum'}: ${alsText(feld(g.notizen[0], 'text')) ?? 'ohne Text'} (${q(g, 'get_recent_notes')}).` } : null,
  ].filter((x): x is { q: string; a: string } => x !== null)
  if (fragen.length) karten.push({ type: 'questions', title: 'Womit der Kunde kommen dürfte', items: fragen })

  const schritte = [
    g.verstoesse[0] ? { text: `Regelverstoss «${alsText(feld(g.verstoesse[0], 'rule_description', 'rule_code')) ?? 'offen'}» ansprechen und das weitere Vorgehen festhalten.`, why: `${anzahl(g.verstoesse.length, 'offener Verstoss', 'offene Verstösse')} (${q(g, 'get_violations')}).` } : null,
    bandzeilen.find((r) => r.actual > r.max || r.actual < r.min)
      ? { text: 'Rückführung in die Bandbreite vorschlagen und die Wirkung auf das Risikoprofil zeigen.', why: `Abweichung aus ${q(g, 'get_saa_gap')}.` }
      : null,
    g.vorschlaege[0] ? { text: 'Den offenen Anlagevorschlag zur Entscheidung bringen.', why: `${anzahl(g.vorschlaege.length, 'offener Vorschlag', 'offene Vorschläge')} (${q(g, 'get_open_proposals')}).` } : null,
    g.notizen[0] ? { text: 'Die letzte Notiz als Frage stellen, statt sie als Tatsache zu behandeln.', why: `Notiz vom ${alsText(feld(g.notizen[0], 'created_at')) ?? 'unbekannten Datum'} (${q(g, 'get_recent_notes')}).` } : null,
    { text: 'Gesprächsnotiz direkt nach dem Anruf bestätigen.', why: 'Dokumentationspflicht nach FIDLEG.' },
  ].filter((x): x is { text: string; why: string } => x !== null).slice(0, 5)
  karten.push({ type: 'actions', title: 'Nächste Schritte', items: schritte })

  return karten
}

// Alle Muster des Mock-Pfads an einer Stelle und umlautgefaltet: die Spracherkennung
// schreibt mal «Währung», mal «Waehrung», und ein Muster, das nur eine Schreibweise
// trifft, fällt im Betrieb zufällig aus.
// Jedes Muster beginnt mit \b. Ohne diese Grenze steckt «gefallen» in «aufgefallen», und
// der Copilot antwortet auf «mir ist aufgefallen» mit dem Kursverlauf.
const M = {
  /** Begrüssung, Dank, Verabschiedung: dazu gibt es nichts zu sagen. */
  belanglos: fm(/^(?:\s*(?:ja|nein|okay|ok|gut|genau|danke|vielen dank|bitte|hallo|guten (?:tag|morgen|abend)|grüezi|auf wiederhören|tschüss|einen moment|wie geht es ihnen)\b[\s.,!?]*){1,3}$/i),
  wert: fm(/\b(?:verlust|verloren|minus|gefallen|performance|rendite|entwickelt|gewachsen|depotwert)/i),
  waehrung: fm(/\b(?:dollar|währung|usd|euro|fremdwährung|wechselkurs|klumpen)/i),
  waehrungBand: fm(/\b(?:usd|dollar|eur|euro|fremd|währung)/i),
  nachhaltig: fm(/\b(?:nachhaltig|esg|klima|fossil|grün)/i),
  vorschlag: fm(/\b(?:vorschlag|angebot|empfehl|kaufen|verkaufen)/i),
  regel: fm(/\b(?:risiko|regel|vorschrift|erlaubt|mandat)/i),
  frageWert: fm(/\b(?:performance|rendite|jahr|entwickl|depotwert)/i),
  fragePosition: fm(/\b(?:position|aktie|titel|grösste)/i),
  frageRegel: fm(/\b(?:verstoss|verstösse|regel|richtlinie|compliance|ausnahme)/i),
  frageVorschlag: fm(/\b(?:vorschlag|proposal|angebot)/i),
  frageNotiz: fm(/\b(?:notiz|gesagt|gesprochen|letztes mal)/i),
  frageVermoegen: fm(/\b(?:vermögen|aum|gesamt|wie viel)/i),
}

/** Reihenfolge der Dringlichkeit; der Berater liest nur die ersten zwei. */
const RANG: Record<Severity, number> = { risk: 0, warn: 1, ok: 2, info: 3 }

export function mockHints(g: Geladen, input: HintInput): Suggestion[] {
  const t = input.trigger.trim()
  const tf = falten(t)
  if (!t || t.length < 12 || M.belanglos.test(tf)) return []

  const bau = (kind: Suggestion['kind'], text: string, why: string, sources: string[], severity: Severity): Suggestion => ({
    type: 'suggestion', callId: input.callId, id: nextId('s'), kind, text, why, sources, trigger: input.trigger, severity,
  })

  const raus: Suggestion[] = []
  const ytd = wertentwicklung(g)
  const ccy = alsText(feld(g.uebersicht, 'reporting_ccy', 'currency')) ?? 'CHF'

  if (M.wert.test(tf) && ytd !== null) {
    raus.push(bau('say', wertSatz(ytd), `Wertverlauf aus ${q(g, 'get_portfolio_summary')}; ${WERT_ZUSATZ}.`, [q(g, 'get_portfolio_summary')], ytd < 0 ? 'warn' : 'info'))
    if (g.positionen[0]) {
      const n = alsText(feld(g.positionen[0], 'security_name', 'name'))
      const w = alsZahl(feld(g.positionen[0], 'weight'))
      if (n) raus.push(bau('fact', `Grösste Position: ${n}${w !== null ? `, ${prozent(w)} des Portfolios` : ''}.`, `Aus der Positionsliste (${q(g, 'get_positions_top')}).`, [q(g, 'get_positions_top')], 'info'))
    }
  }

  // Ein brauchbarer Hinweis zur Währungsfrage nennt die Grenze, nicht nur die Richtung.
  // Steht in den Daten eine gerissene Bandbreite, kommt sie mit ihren Zahlen in den Satz.
  if (M.waehrung.test(tf)) {
    const band = g.saa
      .map((r) => ({
        label: alsText(feld(r, 'category', 'saa_asset_class', 'label')) ?? '',
        max: alsZahl(feld(r, 'max_pct', 'max')),
        actual: alsZahl(feld(r, 'actual_pct', 'actual', 'ist')),
      }))
      .find((r) => M.waehrungBand.test(falten(r.label)) && r.actual !== null && r.max !== null && r.actual > r.max)
    if (band) {
      raus.push(bau('say', `${band.label} liegt bei ${prozent(band.actual)}, die Grenze liegt bei ${prozent(band.max)}.`, `Soll-Ist aus ${q(g, 'get_saa_gap')}; Referenzwährung ${ccy}.`, [q(g, 'get_saa_gap')], 'risk'))
    } else if (g.saa.length) {
      raus.push(bau('next', 'Die Währungsaufteilung gegen die Bandbreiten zeigen und die Rückführung anbieten.', `Soll-Ist-Daten aus ${q(g, 'get_saa_gap')}; Referenzwährung ${ccy}.`, [q(g, 'get_saa_gap')], 'warn'))
    }
  }

  if (M.nachhaltig.test(tf)) {
    const notiz = g.notizen.find((n) => M.nachhaltig.test(falten(alsText(feld(n, 'text')) ?? '')))
    raus.push(bau('say', notiz ? 'Ihre Anfrage zu nachhaltigen Anlagen ist bei uns erfasst, ich komme gleich darauf zurück.' : 'Zu nachhaltigen Anlagen liegt mir im Moment keine Angabe in Ihrem Dossier vor.', notiz ? `Notiz vom ${alsText(feld(notiz, 'created_at')) ?? 'unbekannten Datum'} (${q(g, 'get_recent_notes')}).` : `Keine passende Notiz in ${q(g, 'get_recent_notes')}.`, [q(g, 'get_recent_notes')], 'info'))
  }

  if (M.vorschlag.test(tf) && g.vorschlaege.length) {
    raus.push(bau('next', 'Den offenen Anlagevorschlag zur Entscheidung bringen.', `${anzahl(g.vorschlaege.length, 'offener Vorschlag', 'offene Vorschläge')} (${q(g, 'get_open_proposals')}).`, [q(g, 'get_open_proposals')], 'info'))
  }

  if (g.verstoesse.length && M.regel.test(tf)) {
    raus.push(bau('warning', 'Keine Zusage zur Bereinigung machen: der Verstoss ist offen erfasst.', `${anzahl(g.verstoesse.length, 'offener Verstoss', 'offene Verstösse')} (${q(g, 'get_violations')}).`, [q(g, 'get_violations')], 'risk'))
  }

  // Erst sortieren, dann abschneiden: sonst verdrängt eine beiläufige Zahl den Hinweis auf
  // eine gerissene Grenze, nur weil sie im Code weiter oben steht.
  return raus.sort((a, b) => RANG[a.severity] - RANG[b.severity]).slice(0, 2)
}

export function mockAsk(g: Geladen, input: AskInput): Answer {
  const frage = falten(input.question)
  const antwort = (text: string, sources: string[]): Answer => ({
    type: 'answer', callId: input.callId, id: nextId('a'), question: input.question, text, supported: true, sources,
  })

  const ytd = wertentwicklung(g)
  const ccy = alsText(feld(g.uebersicht, 'reporting_ccy', 'currency')) ?? 'CHF'

  if (g.quellen.length) {
    if (M.frageWert.test(frage) && ytd !== null) {
      return antwort(`${wertSatz(ytd)} Die Zahl stammt aus dem Wertverlauf, sie ist keine Rendite und lässt sich nicht als Anlageerfolg lesen.`, [q(g, 'get_portfolio_summary')])
    }
    if (M.fragePosition.test(frage) && g.positionen.length) {
      const liste = g.positionen.slice(0, 3).map((p) => `${alsText(feld(p, 'security_name', 'name')) ?? 'unbenannt'} (${prozent(alsZahl(feld(p, 'weight')))})`).join(', ')
      return antwort(`Die grössten Positionen sind ${liste}.`, [q(g, 'get_positions_top')])
    }
    if (M.frageRegel.test(frage)) {
      const zusatz = g.ausnahmen.length
        ? ` Dazu kommen ${anzahl(g.ausnahmen.length, 'bewusst vereinbarte Ausnahme', 'bewusst vereinbarte Ausnahmen')}; das sind keine Verstösse.`
        : ''
      return g.verstoesse.length
        ? antwort(`Erfasst sind ${anzahl(g.verstoesse.length, 'offener Verstoss', 'offene Verstösse')}, zuletzt «${alsText(feld(g.verstoesse[0], 'rule_description', 'rule_code')) ?? 'ohne Beschreibung'}».${zusatz}`, [q(g, 'get_violations')])
        : antwort(`Es sind keine offenen Verstösse gegen Anlagerichtlinien erfasst.${zusatz}`, [q(g, 'get_violations')])
    }
    if (M.frageVorschlag.test(frage)) {
      return antwort(`Erfasst sind ${anzahl(g.vorschlaege.length, 'offener Vorschlag', 'offene Vorschläge')}.`, [q(g, 'get_open_proposals')])
    }
    if (M.frageNotiz.test(frage) && g.notizen.length) {
      return antwort(`Letzte Notiz vom ${alsText(feld(g.notizen[0], 'created_at')) ?? 'unbekannten Datum'}: ${alsText(feld(g.notizen[0], 'text')) ?? 'ohne Text'}.`, [q(g, 'get_recent_notes')])
    }
    if (M.frageVermoegen.test(frage)) {
      return antwort(`Unter Verwaltung liegen ${franken(alsZahl(feld(g.uebersicht, 'aum')), ccy)}.`, [q(g, 'get_client_overview')])
    }
  }

  return {
    type: 'answer',
    callId: input.callId,
    id: nextId('a'),
    question: input.question,
    text: g.quellen.length
      ? 'Dazu liegen mir in den abgefragten Werkzeugdaten keine Angaben vor. Nötig wäre eine Auswertung ausserhalb von Depot, Vorschlägen, Verstössen und Notizen.'
      : 'Dazu liegen mir keine Daten vor: der Kunde ist noch nicht erkannt oder die Toolbox antwortet nicht.',
    supported: false,
    sources: [],
  }
}
