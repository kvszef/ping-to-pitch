// Rollenzuordnung: wer von beiden hat das gesagt?
//
// Warum das überhaupt nötig ist: Kunde und Berater sprechen in dasselbe Handy auf Lautsprecher.
// Vapi transkribiert eine Leitung und liefert deshalb jede Zeile mit derselben Rolle. Die
// Trennung Kunde/Berater passiert hier, am Inhalt.
//
// Warum im Normalfall ohne Modell:
// Diese Funktion läuft bei JEDER Äusserung, also im heissesten Pfad des ganzen Copiloten.
// Ein Modellaufruf kostet dort 300 bis 800 Millisekunden, die dem Hinweis fehlen, den der
// Berater eigentlich lesen will. Zwei billige Signale tragen den Normalfall:
//   1. Merkmale – wer «mein Depot» sagt, ist der Kunde; wer «Ihr Fremdwährungsanteil liegt
//      bei 46 Prozent» sagt, liest aus dem System vor und ist der Berater. Wer nach einem
//      Vorschlag fragt, ist der Kunde; wer einen macht, der Berater.
//   2. Abwechslung – die beiden reden meist abwechselnd.
//
// Die Rangfolge dazwischen ist das Entscheidende, und zwar in dieser Richtung: der Inhalt
// schlägt die Abwechslung. Menschen reden nicht streng abwechselnd; zwei Sätze des Kunden
// hintereinander sind der Normalfall, nicht die Ausnahme. Eine Heuristik, die deshalb auf
// Abwechslung beharrt, verschiebt ab da das ganze Gespräch um eine Rolle. Widersprechen sich
// beide Signale, wird nichts entschieden, sondern gefragt – siehe `entscheide`.
//
// Gefragt wird das kleinste und billigste Modell, Claude Haiku 4.5, ohne Denkmodus und ohne
// Aufwandstufe (Haiku 4.5 kennt `output_config.effort` nicht und weist sie zurück; das ist
// hier zugleich die niedrigste Stufe), mit kurzer Frist und für alle offenen Zeilen in einer
// einzigen Anfrage. Ohne Schlüssel oder ohne Antwort innerhalb der Frist bleibt es bei dem,
// was die Heuristik hatte.
//
// Und im Zweifel `unknown`: die Oberfläche kommt mit einer offenen Zeile klar, mit einer
// falsch zugeordneten nicht.
//
// Gemessen, jede Zeile einzeln und ohne Modell:
//   fixtures/call-case-038.jsonl (echte Rollen im Feld `truth`)  17 von 17, 0 falsch, 1 ms
//   ein Gespräch ohne strikte Abwechslung                         7 von 7,  0 falsch, 6 ms
//   das Beispielgespräch in src/simulate.ts                       6 von 6,  0 falsch

import type { Speaker } from './events.ts'
import type { Line, RoleAssigner } from './types.ts'
import { SCHEMA_ROLES, SYSTEM_ROLES, rolesUser } from './prompts.ts'

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------

const env = (name: string, fallback: string): string => process.env[name]?.trim() || fallback

const CONF = {
  /** Kleinstes und billigstes Modell. Nur für unklare Zeilen. */
  model: env('ROLES_MODEL', 'claude-haiku-4-5'),
  /** Länger als das darf die Rückfrage nicht dauern, sonst ist der Hinweis zu spät. */
  timeoutMs: Number(env('ROLES_TIMEOUT_MS', '1500')),
  /** So viele bereits zugeordnete Zeilen bekommt das Modell als Kontext. */
  kontext: 6,
}

const mockModus = (): boolean => process.env.MOCK_BRAIN === '1' || !process.env.ANTHROPIC_API_KEY

// ---------------------------------------------------------------------------
// Merkmale
// ---------------------------------------------------------------------------

type Merkmal = { muster: RegExp; wer: Exclude<Speaker, 'unknown'>; gewicht: number }

/**
 * Umlaute einebnen, bevor verglichen wird. Die Spracherkennung liefert mal «für», mal «fuer»,
 * mal «Rückgang», mal «Rueckgang» – ein Merkmal, das nur eine der beiden Schreibweisen trifft,
 * ist ein Merkmal, das im Betrieb zufällig ausfällt. Gefaltet wird auf beiden Seiten gleich,
 * Muster wie Text, deshalb spielt es keine Rolle, dass dabei «neue» zu «neu» wird.
 */
export const falten = (s: string): string =>
  s.toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .replace(/ue/g, 'u').replace(/oe/g, 'o').replace(/ae/g, 'a')

/** Dasselbe für den Quelltext eines Musters; Gross- und Kleinschreibung bleibt unberührt. */
const faltenMuster = (s: string): string =>
  s.replace(/[äÄ]/g, 'a').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u').replace(/ß/g, 'ss')
    .replace(/ue/g, 'u').replace(/oe/g, 'o').replace(/ae/g, 'a')

/**
 * Baut aus einem lesbar geschriebenen Muster eines, das gegen gefalteten Text passt.
 * Auch brain.ts prüft damit Auslöser und Fragen, damit «Währung» und «Waehrung» gleich zählen.
 */
export const gefaltetesMuster = (muster: RegExp): RegExp => new RegExp(faltenMuster(muster.source), 'i')

const re = gefaltetesMuster

/**
 * Possessivpronomen plus Nomen, mit zwei Zugeständnissen ans Deutsche:
 * bis zu zwei Wörter dazwischen («Ihr Dollar-Anteil») und ein direkt angewachsenes Bestimmungs-
 * wort («Ihr Fremdwährungsanteil», «Ihre Aktienquote»). Ohne das zweite fällt genau der Satz
 * durch, an dem man den Berater am sichersten erkennt: er liest einen Wert aus dem System vor.
 */
const besitz = (pron: string, nomen: string) =>
  new RegExp(faltenMuster(`\\b(?:${pron})\\s+(?:[a-zäöü]+[\\s-]){0,2}[a-zäöü]*(?:${nomen})`), 'i')

const NOMEN = 'depot|portfolio|anteil|mandat|risikoprofil|profil|vermögen|strategie|allokation|quote|anlagen|anlage|aktien|fonds|geld|konto'

/** Eine Zahl im Satz. «Ihr Anteil liegt bei 46 Prozent» ist Vorlesen aus dem System. */
const ZAHL = /\d/

const MERKMALE: Merkmal[] = [
  // Der Berater spricht vom Besitz des Gegenübers und erklärt, ordnet ein, schlägt vor.
  { muster: besitz('ihr|ihre|ihrem|ihren|ihrer', NOMEN), wer: 'advisor', gewicht: 2 },
  { muster: re(/\b(?:ich habe (?:ihnen|für sie)|für sie (?:vorbereitet|zusammengestellt)|habe ich für sie)\b/i), wer: 'advisor', gewicht: 2 },
  { muster: re(/\b(?:ich (?:schlage|empfehle)|mein vorschlag|ich würde ihnen)\b/i), wer: 'advisor', gewicht: 2 },
  { muster: re(/\bwie (?:vereinbart|besprochen|abgemacht)\b/i), wer: 'advisor', gewicht: 2 },
  { muster: re(/\b(?:das|der rückgang|der verlust|die entwicklung|das kommt)\s?(?:liegt|kommt)?\s?(?:daran|aus dem|aus der|vom|von der)\b/i), wer: 'advisor', gewicht: 2 },
  // «Was kann ich für Sie tun» eröffnet das Gespräch und kommt nie vom Anrufer – darum stark,
  // sonst stünde die erste Zeile ohne Vorgänger und ohne Entscheidung da.
  { muster: re(/\b(?:was kann ich für sie tun|wie kann ich ihnen helfen|schön (?:dass sie anrufen|hören sie sich))\b/i), wer: 'advisor', gewicht: 2 },
  { muster: re(/\b(?:möchten sie|wollen sie|darf ich|soll ich|hätten sie)\b/i), wer: 'advisor', gewicht: 1.5 },
  { muster: re(/\bwir (?:können|haben|würden|schauen|prüfen|machen)\b/i), wer: 'advisor', gewicht: 1 },
  // Bewusst ohne «Benchmark» und «Performance»: solche Wörter benutzen Kundinnen und Kunden
  // genauso, sie trennen also nicht. Hier stehen nur Begriffe aus dem Beratungssystem.
  { muster: re(/\b(?:volatilität|allokation|bandbreite|rebalanc\w*|absicherung|absichern|hedge|umschicht\w*|anlagerichtlinie|zielquote|mandat)\b/i), wer: 'advisor', gewicht: 1 },

  // Der Kunde spricht vom eigenen Geld, schildert und fragt.
  { muster: besitz('mein|meine|meinem|meinen|meiner', NOMEN), wer: 'caller', gewicht: 2 },
  { muster: re(/\bich habe\b.{0,40}\b(?:gesehen|gelesen|gehört|bemerkt|angeschaut)\b|\bmir ist\b.{0,25}\baufgefallen\b/i), wer: 'caller', gewicht: 2 },
  { muster: re(/\b(?:trifft mich|betrifft mich|trifft das mich|für mich bedeutet|was bedeutet das für mich)\b/i), wer: 'caller', gewicht: 2 },
  { muster: re(/\b(?:ich hatte\b.{0,60}|hatte ich\b.{0,40})\b(?:gefragt|gesagt|erwähnt|gebeten|angesprochen)\b/i), wer: 'caller', gewicht: 2 },
  { muster: re(/\b(?:ich (?:verstehe|weiss) (?:das )?nicht|ich mache mir sorgen|das beunruhigt mich|beunruhigt mich)\b/i), wer: 'caller', gewicht: 2 },
  // Eine Erwartung ans eigene Depot: «Ich dachte, da wäre ich breiter aufgestellt.»
  { muster: re(/\b(?:ich dachte|ich ging davon aus|ich hatte angenommen|wichtig ist mir|mir ist wichtig)\b/i), wer: 'caller', gewicht: 2 },
  // Die Frage an das Gegenüber. Der Berater schlägt vor, der Kunde fragt danach.
  { muster: re(/\b(?:was|wie|und)\b.{0,20}\b(?:schlagen sie|empfehlen sie|raten sie|würden sie mir)\b/i), wer: 'caller', gewicht: 2 },
  { muster: re(/\b(?:können sie mir|könnten sie mir|sagen sie mir|erklären sie mir|erklären sie das)\b/i), wer: 'caller', gewicht: 1.5 },
  { muster: re(/\bich (?:möchte|will|wollte|hätte gern|brauche|frage mich)\b/i), wer: 'caller', gewicht: 1 },
  { muster: re(/\b(?:was ist (?:da )?los|warum|wieso|stimmt das|ist das (?:normal|schlimm|üblich))\b/i), wer: 'caller', gewicht: 1 },
]

const BESITZ_BERATER = MERKMALE[0].muster

/** Positiv heisst Berater, negativ heisst Kunde. Null heisst: kein Merkmal gefunden. */
export function merkmalspunkte(text: string): number {
  const gefaltet = falten(text)
  let punkte = 0
  for (const m of MERKMALE) if (m.muster.test(gefaltet)) punkte += m.wer === 'advisor' ? m.gewicht : -m.gewicht
  // «Ihr Fremdwährungsanteil liegt bei rund 46 Prozent»: Sie-Form, Besitz und eine konkrete
  // Zahl zusammen sagt praktisch nur, wer die Zahl vor sich auf dem Bildschirm hat.
  if (punkte > 0 && BESITZ_BERATER.test(gefaltet) && ZAHL.test(gefaltet)) punkte += 1
  return punkte
}

// ---------------------------------------------------------------------------
// Behutsames Glätten ohne Modell
// ---------------------------------------------------------------------------

/** Von der Spracherkennung auseinandergerissene Fachbegriffe. Nur eindeutige Fälle. */
const GETRENNT: [RegExp, string][] = [
  [/\bde\s+pot\b/gi, 'Depot'],
  [/\bport\s+folio\b/gi, 'Portfolio'],
  [/\bvola\s+tilit(?:ä|ae)t\b/gi, 'Volatilität'],
  [/\bfrank\s+en\b/gi, 'Franken'],
  [/\bpro\s+zent\b/gi, 'Prozent'],
]

/** Wörter, die sich im Deutschen zu Recht wiederholen dürfen («die Aktien, die die Bank hält»). */
const DOPPELT_ERLAUBT = /^(?:die|der|das|dass|den|dem|sie|ist|in|so|und|wie|nur|noch)$/i

/**
 * Glättet, ohne etwas hinzuzufügen oder wegzulassen: Leerraum, auseinandergerissene
 * Fachbegriffe, versehentlich verdoppelte Wörter. Das eigentliche Glätten übernimmt das
 * Modell, wenn wir es ohnehin fragen; hier bleiben wir bewusst zurückhaltend.
 */
export function glaetten(roh: string): string {
  let t = (roh ?? '').replace(/\s+/g, ' ').trim()
  for (const [muster, ersatz] of GETRENNT) t = t.replace(muster, ersatz)
  t = t.replace(/\b([a-zäöüß]{4,})\s+\1\b/gi, (treffer, wort: string) => (DOPPELT_ERLAUBT.test(wort) ? treffer : wort))
  return t
}

// ---------------------------------------------------------------------------
// Entscheidung je Zeile
// ---------------------------------------------------------------------------

/**
 * `pruefen` heisst: die Heuristik hat sich nicht festgelegt. Solche Zeilen gehen ans Modell,
 * und ohne Modell bleibt es bei dem, was hier steht – bei `unknown`, wo wirklich nichts
 * spricht, und bei der Abwechslung, wo sie die einzige Spur ist.
 */
type Entscheid = { speaker: Speaker; sicher: boolean; grund: string }

/**
 * Inhalt schlägt Abwechslung, nicht umgekehrt. Fünf Fälle:
 *   1. starkes Merkmal (Betrag >= 2)     -> entscheidet allein, auch gegen die Abwechslung.
 *      Wer «Ihr Fremdwährungsanteil liegt bei 46 Prozent» sagt, ist der Berater, egal wer
 *      vorher dran war – Menschen reden nicht streng abwechselnd.
 *   2. schwaches Merkmal, einig mit der Abwechslung -> entscheiden gemeinsam.
 *   3. schwaches Merkmal GEGEN die Abwechslung      -> Widerspruch, also unklar. Hier lag die
 *      erste Fassung falsch: sie liess die Abwechslung gewinnen und hielt sich für sicher.
 *   4. gar kein Merkmal, aber eine Abwechslung      -> die Abwechslung entscheidet, weil sie
 *      die einzige Spur ist. Das Ergebnis gilt aber als ungeprüft und geht ans Modell.
 *   5. weder noch                                   -> unklar.
 */
export function entscheide(text: string, vorher: Speaker): Entscheid {
  const punkte = merkmalspunkte(text)
  const ausMerkmal: Speaker = punkte > 0 ? 'advisor' : punkte < 0 ? 'caller' : 'unknown'
  const ausWechsel: Speaker = vorher === 'advisor' ? 'caller' : vorher === 'caller' ? 'advisor' : 'unknown'

  if (Math.abs(punkte) >= 2) return { speaker: ausMerkmal, sicher: true, grund: `Merkmal ${punkte}` }
  if (ausMerkmal !== 'unknown' && ausMerkmal === ausWechsel) return { speaker: ausMerkmal, sicher: true, grund: `Merkmal ${punkte} und Wechsel` }
  if (ausMerkmal !== 'unknown') return { speaker: 'unknown', sicher: false, grund: `Merkmal ${punkte} gegen Wechsel` }
  if (ausWechsel !== 'unknown') return { speaker: ausWechsel, sicher: false, grund: 'nur Wechsel' }
  return { speaker: 'unknown', sicher: false, grund: 'nichts' }
}

// ---------------------------------------------------------------------------
// Rückfrage beim kleinen Modell
// ---------------------------------------------------------------------------

type Zuordnung = { lineId: number; speaker: Speaker; text: string }

/**
 * Eine Anfrage für alle unklaren Zeilen zusammen, nicht eine je Zeile. Bewusst ein eigener,
 * winziger Modellaufruf statt der Werkzeugschleife aus brain.ts: diese Datei soll leicht
 * bleiben und keine Kundendaten sehen.
 */
async function frageModell(unklar: Line[], zugeordnet: Line[], signal?: AbortSignal): Promise<Map<number, Zuordnung>> {
  const leer = new Map<number, Zuordnung>()
  if (!unklar.length || mockModus()) return leer

  const frist = AbortSignal.timeout(CONF.timeoutMs)
  const abbruch = signal ? AbortSignal.any([signal, frist]) : frist
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic()
    const antwort = await client.messages.create(
      {
        model: CONF.model,
        max_tokens: 400,
        system: SYSTEM_ROLES,
        messages: [{ role: 'user', content: rolesUser(unklar, zugeordnet.slice(-CONF.kontext)) }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA_ROLES } },
      },
      { signal: abbruch },
    )
    const roh = antwort.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const daten = JSON.parse(roh) as { zuordnung?: Zuordnung[] }
    for (const z of daten.zuordnung ?? []) {
      const quelle = unklar.find((l) => l.lineId === z.lineId)
      if (!quelle) continue
      const speaker: Speaker = z.speaker === 'caller' || z.speaker === 'advisor' ? z.speaker : 'unknown'
      // Das Modell darf glätten, aber nicht umschreiben: wird der Text deutlich kürzer oder
      // länger, nehmen wir das Original.
      const text = typeof z.text === 'string' && z.text.trim() ? z.text.trim() : quelle.text
      const plausibel = Math.abs(text.length - quelle.text.length) <= Math.max(12, quelle.text.length * 0.25)
      leer.set(z.lineId, { lineId: z.lineId, speaker, text: plausibel ? text : quelle.text })
    }
  } catch (e) {
    // Kein Schlüssel, kein Paket, kein Netz, Frist abgelaufen: dann eben `unknown`.
    console.warn(`[rollen] Rückfrage übersprungen: ${e instanceof Error ? e.message : String(e)}`)
  }
  return leer
}

// ---------------------------------------------------------------------------
// Die Umsetzung von RoleAssigner
// ---------------------------------------------------------------------------

export type RoleAssignerOptions = {
  /** Unklare Zeilen zusätzlich vom kleinen Modell prüfen lassen. Vorgabe: ja, sofern ein Schlüssel da ist. */
  modell?: boolean
}

export function createRoleAssigner(opts: RoleAssignerOptions = {}): RoleAssigner {
  const modellErlaubt = opts.modell ?? true

  return async (neu, bisher) => {
    const begonnen = Date.now()
    const ergebnis: Zuordnung[] = []
    const unklar: Line[] = []

    // Die bereits zugeordneten Zeilen liefern den Ausgangspunkt für die Abwechslung.
    let vorher: Speaker = [...bisher].reverse().find((l) => l.speaker !== 'unknown')?.speaker ?? 'unknown'

    const gruende: string[] = []
    for (const line of neu) {
      const text = glaetten(line.text)
      const { speaker, sicher, grund } = entscheide(text, vorher)
      ergebnis.push({ lineId: line.lineId, speaker, text })
      gruende.push(grund)
      if (!sicher) unklar.push({ ...line, text })
      // Die Abwechslung wird von jeder Zuordnung weitergetragen, auch von einer ungeprüften:
      // sonst reisst die Kette bei jeder kurzen Bestätigung ab und die übernächste Zeile hat
      // keinen Anhaltspunkt mehr. Nur `unknown` trägt nichts weiter.
      if (speaker !== 'unknown') vorher = speaker
    }

    if (modellErlaubt && unklar.length) {
      const zugeordnet = [...bisher, ...neu.filter((l) => !unklar.some((u) => u.lineId === l.lineId))]
      const vomModell = await frageModell(unklar, zugeordnet)
      for (const z of ergebnis) {
        const treffer = vomModell.get(z.lineId)
        if (!treffer) continue
        // Sagt das Modell selbst «unknown», behalten wir die Spur aus der Abwechslung:
        // schlechter als ein Anhaltspunkt ist gar keiner.
        if (treffer.speaker !== 'unknown') z.speaker = treffer.speaker
        z.text = treffer.text
      }
    }

    const offen = ergebnis.filter((z) => z.speaker === 'unknown').length
    console.log(`[rollen] ${ergebnis.length} Zeile(n), ${unklar.length} ungeprüft (${gruende.join('; ')}), ${offen} offen, ${Date.now() - begonnen} ms`)
    return ergebnis
  }
}

/** Standardinstanz für den Normalfall. */
export const assignRoles: RoleAssigner = createRoleAssigner()
