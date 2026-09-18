// Der Vertrag zwischen allen Teilen des Copiloten. Wer hier etwas ändert, ändert es für alle:
// Telefonie-Adapter, STT-Schicht, Copilot-Hirn, Oberfläche und Simulator sprechen ausschliesslich
// über diese Ereignisse. Keine Laufzeit-Abhängigkeit, damit Server und Browser die Datei teilen können.

/** Schweregrad, gleiche Werte wie im Workspace-UI (app/src/types.ts). */
export type Severity = 'risk' | 'warn' | 'ok' | 'info'

/** Wer spricht. Die beiden Audiospuren sind getrennt, es wird nie diarisiert. */
export type Speaker = 'caller' | 'advisor'

/**
 * Briefing-Karten. Bewusst deckungsgleich mit `Card` in app/src/types.ts, damit die Ausgabe
 * später ohne Umbau im bestehenden Workspace dargestellt werden kann.
 */
export type BriefingCard =
  | { type: 'headline'; text: string; sub?: string }
  | { type: 'metrics'; items: { label: string; value: string; delta?: string; tone?: Severity }[] }
  | { type: 'allocation'; title: string; rows: { label: string; min: number; target: number; max: number; actual: number }[] }
  | { type: 'flags'; title: string; items: { severity: Severity; text: string; source: string }[] }
  | { type: 'actions'; title: string; items: { text: string; why: string }[] }
  | { type: 'questions'; title: string; items: { q: string; a: string }[] }

export type Briefing = BriefingCard[]

/** Wie sicher der Kunde erkannt wurde. `phone` = über die Anrufernummer, der Normalfall. */
export type IdentityConfidence = 'phone' | 'name' | 'manual' | 'unknown'

/** Ein Anruf beginnt. Kommt vom Telefonie-Adapter, sobald es klingelt – nicht erst beim Annehmen. */
export type CallStarted = {
  type: 'call.started'
  callId: string
  /** Anrufernummer in E.164, z. B. +41791234567. Leerstring, wenn unterdrückt. */
  from: string
  /** Die angerufene Nummer in E.164. */
  to: string
  /** ISO-8601 mit Zeitzone. */
  at: string
  /** Welcher Adapter das Ereignis erzeugt hat. Frei erweiterbar. */
  transport: 'livekit' | 'twilio' | 'sim' | (string & {})
}

/** Der Kunde hinter der Nummer, samt 60-Sekunden-Briefing. Soll ankommen, während es noch klingelt. */
export type ClientIdentified = {
  type: 'client.identified'
  callId: string
  /** null = Nummer unbekannt; die Oberfläche bietet dann die manuelle Auswahl an. */
  clientRef: string | null
  name?: string
  confidence: IdentityConfidence
  briefing?: Briefing
}

/** Ein Stück Transkript. `final: false` sind Zwischenergebnisse und dürfen überschrieben werden. */
export type TranscriptSegment = {
  type: 'transcript.segment'
  callId: string
  speaker: Speaker
  text: string
  final: boolean
  /** Millisekunden seit Anrufbeginn. */
  startMs: number
  endMs: number
  confidence?: number
}

/** Was der Copilot dem Berater anbietet. `say` ist wörtlich sprechbar, der Rest ist Hintergrund. */
export type Suggestion = {
  type: 'suggestion'
  callId: string
  id: string
  kind: 'say' | 'fact' | 'next' | 'warning'
  /** Bei `say`: ein Satz in Sie-Form, den der Berater wörtlich sagen kann. */
  text: string
  /** Begründung mit Zahlen, für den Berater, nicht für den Kunden. */
  why: string
  /** Werkzeugnamen und Zeilenschlüssel, aus denen der Vorschlag stammt. Nie leer bei `supported`. */
  sources: string[]
  /** Die Aussage, die den Vorschlag ausgelöst hat. */
  trigger: string
  severity: Severity
}

/** Antwort auf eine getippte Rückfrage des Beraters. */
export type Answer = {
  type: 'answer'
  callId: string
  id: string
  question: string
  text: string
  /** false = die Daten decken die Frage nicht; `text` erklärt dann kurz, was fehlt. */
  supported: boolean
  sources: string[]
}

export type CallEnded = {
  type: 'call.ended'
  callId: string
  at: string
  reason?: string
}

/** Diagnose für die Oberfläche: STT-Verbindung, Toolbox, Modell. Nie gesprächsrelevant. */
export type StatusEvent = {
  type: 'status'
  callId?: string
  component: 'stt' | 'toolbox' | 'brain' | 'telephony'
  ok: boolean
  detail?: string
}

export type CallEvent =
  | CallStarted
  | ClientIdentified
  | TranscriptSegment
  | Suggestion
  | Answer
  | CallEnded
  | StatusEvent

export type CallEventType = CallEvent['type']

// ---------------------------------------------------------------------------
// Prüfungen für Fremddaten. Andockpunkt C (POST /call) nimmt Ereignisse von
// aussen entgegen; alles, was hier durchfällt, wird verworfen statt geraten.
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export const EVENT_TYPES: readonly CallEventType[] = [
  'call.started', 'client.identified', 'transcript.segment',
  'suggestion', 'answer', 'call.ended', 'status',
] as const

/** Grobprüfung: richtiger Typ, callId vorhanden, Pflichtfelder gesetzt. */
export function isCallEvent(value: unknown): value is CallEvent {
  if (!isObject(value) || !isStr(value.type)) return false
  if (!EVENT_TYPES.includes(value.type as CallEventType)) return false
  if (value.type !== 'status' && !isStr(value.callId)) return false
  switch (value.type) {
    case 'call.started':
      return isStr(value.from) && isStr(value.to) && isStr(value.at) && isStr(value.transport)
    case 'client.identified':
      return (value.clientRef === null || isStr(value.clientRef)) && isStr(value.confidence)
    case 'transcript.segment':
      return isStr(value.text) && typeof value.final === 'boolean'
        && (value.speaker === 'caller' || value.speaker === 'advisor')
        && isNum(value.startMs) && isNum(value.endMs)
    case 'suggestion':
      return isStr(value.id) && isStr(value.text) && isStr(value.kind) && Array.isArray(value.sources)
    case 'answer':
      return isStr(value.id) && isStr(value.text) && typeof value.supported === 'boolean'
    case 'call.ended':
      return isStr(value.at)
    case 'status':
      return isStr(value.component) && typeof value.ok === 'boolean'
  }
}

/**
 * Bringt eine Telefonnummer auf E.164, so gut es ohne Länderkontext geht.
 * `00` wird zu `+`, Trennzeichen fallen weg, eine führende Schweizer `0` wird zu `+41`.
 * Unbekanntes bleibt unverändert, damit nichts stillschweigend falsch zugeordnet wird.
 */
export function toE164(raw: string, defaultCountry = '+41'): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const digits = trimmed.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('00')) return `+${digits.slice(2)}`
  if (digits.startsWith('0')) return `${defaultCountry}${digits.slice(1)}`
  return digits ? `+${digits}` : ''
}
