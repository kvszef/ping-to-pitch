import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as bus from './bus.ts'
import { beobachte } from '../live.ts'
import { createBrain } from './brain.ts'
import { identifyByName, identifyByPhone, maskPhone } from './identify.ts'
import { assignRoles } from './roles.ts'
import { toolbox } from './toolbox.ts'
import type { Briefing, Speaker } from './events.ts'
import type { Brain, Line } from './types.ts'
import { LIMITS } from './types.ts'

// Der Ablauf eines Anrufs, von der ersten Klingel bis zum Auflegen. Diese Datei ist die einzige
// Stelle, an der die Bausteine zusammenkommen; server.ts ruft nur noch die vier Funktionen unten auf.
//
// Der Zeitplan ist der eigentliche Entwurf:
//   klingelt  -> Nummer nachschlagen      (schnell, damit der Name da ist, bevor jemand spricht)
//             -> Briefing im Hintergrund  (darf ein paar Sekunden dauern, laeuft parallel zum Gruss)
//   spricht   -> Rollen zuordnen          (jede abgeschlossene Zeile)
//             -> Hinweise, gedrosselt     (nur nach Kundenaussagen, hoechstens alle zwei Sekunden)
//
// Zwei Regeln halten das Gespraech fluessig: nichts blockiert den Webhook, und eine laufende
// Modellanfrage wird verworfen, sobald der Kunde etwas Neues sagt. Ein veralteter Vorschlag ist
// schlimmer als gar keiner.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const brain: Brain = createBrain(toolbox, { log: (zeile) => console.log(`  ${zeile}`) })

type State = {
  briefing: Briefing
  /** Laufende Hinweis-Anfrage, damit sie bei einer neuen Aussage abgebrochen werden kann. */
  laufend: AbortController | null
  /** Zeitpunkt des letzten Modellaufrufs, fuer die Drosselung. */
  zuletzt: number
  /** Eine Aussage, die waehrend der Drosselung eintraf und danach drankommt. */
  wartend: string | null
  timer: ReturnType<typeof setTimeout> | null
  /** Wurde schon versucht, den Kunden ueber einen genannten Namen zu finden? */
  namensucheLaeuft: boolean
}

let state: State = leererZustand()

function leererZustand(): State {
  return { briefing: [], laufend: null, zuletzt: 0, wartend: null, timer: null, namensucheLaeuft: false }
}

// ------------------------------------------------------------------ Anruf beginnt

/**
 * Vapi meldet, dass der Anruf steht. Gibt sofort zurueck; Nachschlagen und Briefing laufen im
 * Hintergrund, damit der Webhook nicht wartet.
 */
export function callStarted(rawFrom: string): void {
  abbrechen()
  state = leererZustand()
  const call = bus.startCall(rawFrom)
  console.log(`\nAnruf von ${maskPhone(rawFrom)} · ${call.callId}`)
  void erkennen(rawFrom)
}

async function erkennen(rawFrom: string): Promise<void> {
  const t0 = Date.now()
  const identity = await identifyByPhone(toolbox, rawFrom)
  bus.setClient(identity.clientRef, identity.name, identity.confidence)
  console.log(`  Kunde: ${identity.clientRef ?? 'unbekannt'}${identity.name ? ` (${identity.name})` : ''} · ${identity.via} · ${Date.now() - t0} ms`)

  const erreichbar = await toolbox.health()
  bus.status('toolbox', erreichbar, erreichbar ? undefined : 'Toolbox nicht erreichbar, npm run toolbox starten')
  if (!identity.clientRef) return
  await briefingHolen(identity.clientRef, identity.name, identity.confidence)
}

async function briefingHolen(clientRef: string, name: string | undefined, confidence: 'phone' | 'name' | 'manual' | 'unknown'): Promise<void> {
  const t0 = Date.now()
  try {
    const briefing = await brain.briefing(clientRef)
    state.briefing = briefing
    bus.setClient(clientRef, name, confidence, briefing)
    bus.status('brain', true, `Briefing in ${Date.now() - t0} ms`)
    console.log(`  Briefing: ${briefing.length} Karten · ${Date.now() - t0} ms`)
  } catch (e) {
    const grund = e instanceof Error ? e.message : String(e)
    bus.status('brain', false, `Briefing fehlgeschlagen: ${grund}`)
    console.error(`  Briefing fehlgeschlagen: ${grund}`)
  }
}

// ------------------------------------------------------------------ Waehrend des Gespraechs

/**
 * Uebersetzt den Sprechernamen des Telefonieweges in eine Rolle.
 *
 * Die Sprechbruecke trennt die Spuren und weiss deshalb wirklich, wer spricht -- da wird nichts
 * geraten. Vapi dagegen liefert alles als `user`, weil beide Personen in dasselbe Handy sprechen;
 * dort bleibt die Rolle offen und wird nachtraeglich aus dem Inhalt bestimmt.
 */
function spurRolle(name: string): Speaker {
  const n = name.trim().toLowerCase()
  if (n === 'kunde' || n === 'anrufer' || n === 'caller' || n === 'inbound') return 'caller'
  if (n === 'berater' || n === 'advisor' || n === 'outbound') return 'advisor'
  return 'unknown'
}

/** Eine Transkriptzeile, gleich von welchem Telefonieweg. Wird ueber live.ts angemeldet. */
export function transcript(speakerName: string, text: string, final: boolean): void {
  const rolle = spurRolle(speakerName)
  const line = bus.pushLine(rolle, text, final)
  if (!line || !final) return
  void zuordnenUndReagieren(line, rolle !== 'unknown')
}

async function zuordnenUndReagieren(line: Line, rolleSteht: boolean): Promise<void> {
  let sprecher = line.speaker
  if (!rolleSteht) {
    const bisher = bus.recentLines(LIMITS.transcriptWindow).filter((l) => l.lineId !== line.lineId)
    try {
      const [zuordnung] = await assignRoles([line], bisher)
      if (zuordnung) {
        sprecher = zuordnung.speaker
        bus.updateLine(line.lineId, zuordnung.speaker, zuordnung.text)
      }
    } catch (e) {
      console.error(`  Rollenzuordnung fehlgeschlagen: ${e instanceof Error ? e.message : e}`)
    }
  }

  const call = bus.activeCall()
  if (!call) return

  // Ist der Kunde noch unbekannt, kann er sich im Gespraech vorstellen.
  if (!call.clientRef && sprecher !== 'advisor' && !state.namensucheLaeuft) {
    state.namensucheLaeuft = true
    void ueberNamenSuchen(line.text).finally(() => { state.namensucheLaeuft = false })
  }

  // Hinweise nach Kundenaussagen. Auf eigene Saetze des Beraters zu antworten, waere Laerm --
  // bei unklarer Rolle wird dagegen geholfen: ein ueberfluessiger Vorschlag kostet einen Blick,
  // ein ausgelassener kostet die Antwort, auf die der Kunde gerade wartet.
  if (sprecher === 'advisor') return
  anstossen(line.text)
}

async function ueberNamenSuchen(text: string): Promise<void> {
  const identity = await identifyByName(toolbox, text)
  if (!identity?.clientRef) return
  bus.setClient(identity.clientRef, identity.name, identity.confidence)
  console.log(`  Kunde im Gespraech erkannt: ${identity.clientRef} (${identity.name}) · ${identity.via}`)
  await briefingHolen(identity.clientRef, identity.name, identity.confidence)
}

/**
 * Drosselung: hoechstens ein Modellaufruf je `hintIntervalMs`. Trifft waehrenddessen eine neue
 * Aussage ein, ersetzt sie die wartende - es zaehlt immer die juengste, nie eine Warteschlange.
 */
function anstossen(trigger: string): void {
  state.wartend = trigger
  if (state.timer) return
  const wartezeit = Math.max(0, state.zuletzt + LIMITS.hintIntervalMs - Date.now())
  state.timer = setTimeout(() => {
    state.timer = null
    const naechster = state.wartend
    state.wartend = null
    if (naechster) void hinweiseHolen(naechster)
  }, wartezeit)
}

async function hinweiseHolen(trigger: string): Promise<void> {
  const call = bus.activeCall()
  if (!call?.clientRef || call.ended) return

  state.laufend?.abort()
  const ac = new AbortController()
  state.laufend = ac
  state.zuletzt = Date.now()

  const t0 = Date.now()
  try {
    const vorschlaege = await brain.hints({
      callId: call.callId,
      clientRef: call.clientRef,
      briefing: state.briefing,
      transcript: bus.recentLines(LIMITS.transcriptWindow),
      trigger,
    }, ac.signal)
    if (ac.signal.aborted) return
    for (const v of vorschlaege) bus.publish(v)
    console.log(`  Hinweise: ${vorschlaege.length} · ${Date.now() - t0} ms`)
    if (vorschlaege.length) bus.status('brain', true, `Hinweis in ${Date.now() - t0} ms`)
  } catch (e) {
    if (ac.signal.aborted) return
    const grund = e instanceof Error ? e.message : String(e)
    bus.status('brain', false, grund)
    console.error(`  Hinweise fehlgeschlagen: ${grund}`)
  } finally {
    if (state.laufend === ac) state.laufend = null
  }
}

// ------------------------------------------------------------------ Rueckfrage des Beraters

/** Der Berater tippt eine Frage. Die Antwort kommt ueber den Bus zurueck, nicht als HTTP-Antwort. */
export async function ask(question: string): Promise<void> {
  const call = bus.activeCall()
  const frage = question.trim()
  if (!frage) return
  if (!call) {
    console.log(`  Rueckfrage ohne laufendes Gespraech verworfen: ${frage}`)
    return
  }
  const t0 = Date.now()
  try {
    const antwort = await brain.ask({
      callId: call.callId,
      clientRef: call.clientRef,
      briefing: state.briefing,
      transcript: bus.recentLines(LIMITS.transcriptWindow),
      question: frage,
    })
    bus.publish(antwort)
    console.log(`  Antwort auf «${frage}» · ${antwort.supported ? 'gedeckt' : 'nicht gedeckt'} · ${Date.now() - t0} ms`)
  } catch (e) {
    const grund = e instanceof Error ? e.message : String(e)
    bus.publish({
      type: 'answer', callId: call.callId, id: `a-${Date.now().toString(36)}`, question: frage,
      text: `Die Anfrage ist fehlgeschlagen: ${grund}`, supported: false, sources: [],
    })
    console.error(`  Rueckfrage fehlgeschlagen: ${grund}`)
  }
}

// ------------------------------------------------------------------ Anruf endet

export function callEnded(reason?: string): void {
  abbrechen()
  const call = bus.activeCall()
  bus.endCall(reason)
  if (!call) return
  mitschnittSchreiben(call.callId)
  // Das Gespraechsgedaechtnis: eine kurze Zusammenfassung wandert in den Freitext des
  // Kunden und steht beim naechsten Anruf im Briefing. Laeuft im Hintergrund, damit das
  // Auflegen nicht darauf wartet.
  void zusammenfassungSchreiben(call.callId, call.clientRef)
}

async function zusammenfassungSchreiben(callId: string, clientRef: string | null): Promise<void> {
  if (!clientRef) return
  const zeilen = bus.recentLines(200)
  const vorschlaege = bus.activeCall()?.history.filter((e) => e.type === 'suggestion') ?? []
  const t0 = Date.now()
  try {
    const text = await brain.summary({ callId, clientRef, transcript: zeilen, suggestions: vorschlaege as never[] })
    if (!text.trim()) {
      console.log('  Keine Zusammenfassung: im Gespraech kam nichts Festhaltenswertes vor')
      return
    }
    await toolbox.invoke('append_call_summary', {
      datum: new Date().toISOString().slice(0, 10),
      zusammenfassung: text.trim(),
      client_ref: clientRef,
    })
    console.log(`  Dossier ergaenzt (${clientRef}) nach ${Date.now() - t0} ms: ${text.trim().slice(0, 90)}`)
    bus.status('toolbox', true, 'Gespraechsnotiz im Dossier abgelegt')
  } catch (e) {
    const grund = e instanceof Error ? e.message : String(e)
    bus.status('toolbox', false, `Gespraechsnotiz nicht abgelegt: ${grund}`)
    console.error(`  Zusammenfassung nicht abgelegt: ${grund}`)
  }
}

function abbrechen(): void {
  state.laufend?.abort()
  state.laufend = null
  if (state.timer) clearTimeout(state.timer)
  state.timer = null
  state.wartend = null
}

/** Transkript und Vorschlaege als JSONL ablegen. Dient zugleich als naechste Testfixture. */
function mitschnittSchreiben(callId: string): void {
  const call = bus.activeCall()
  if (!call) return
  try {
    const ordner = resolve(ROOT, 'data', 'calls')
    mkdirSync(ordner, { recursive: true })
    const zeilen = [
      JSON.stringify({ meta: { callId, from: call.from, clientRef: call.clientRef, name: call.clientName, startedAt: call.startedAt } }),
      ...call.lines.map((l) => JSON.stringify({ lineId: l.lineId, speaker: l.speaker, text: l.text })),
      ...call.history.map((e) => JSON.stringify(e)),
    ]
    writeFileSync(resolve(ordner, `${callId}.jsonl`), `${zeilen.join('\n')}\n`, 'utf8')
    console.log(`  Mitschnitt: data/calls/${callId}.jsonl (${call.lines.length} Zeilen, ${call.history.length} Vorschlaege)`)
  } catch (e) {
    console.error(`  Mitschnitt konnte nicht geschrieben werden: ${e instanceof Error ? e.message : e}`)
  }
}

// Einmal beim Laden: jede Transkriptzeile aus live.ts erreicht den Copiloten, gleich ob sie
// ueber Vapi oder ueber die Sprechbruecke hereinkam. Ein neuer Telefonieweg muss dafuer nichts tun.
beobachte((speaker, text, final) => transcript(speaker, text, final))

/** Einmalig beim Start: meldet der Oberflaeche, ob Toolbox und Modell bereitstehen. */
export async function pruefeDienste(): Promise<void> {
  const erreichbar = await toolbox.health()
  bus.status('toolbox', erreichbar, erreichbar ? 'bereit' : 'nicht erreichbar, npm run toolbox starten')
  const mock = (process.env.MOCK_BRAIN ?? '').trim() === '1'
  const schluessel = Boolean((process.env.ANTHROPIC_API_KEY ?? '').trim())
  bus.status('brain', mock || schluessel, mock ? 'Mock-Betrieb' : schluessel ? `Modell ${process.env.MODEL ?? 'claude-opus-5'}` : 'kein ANTHROPIC_API_KEY, MOCK_BRAIN=1 setzen')
}
