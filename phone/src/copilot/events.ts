// Der Vertrag zwischen allen Teilen des Copiloten. Wer hier etwas ändert, ändert es für alle:
// Vapi-Webhook, Rollenzuordnung, Kundenerkennung, Copilot-Hirn und Oberfläche sprechen
// ausschliesslich über diese Ereignisse. Keine Laufzeit-Abhängigkeit, damit Server und Browser
// dieselbe Datei nutzen können.
//
// Woher die Ereignisse kommen: Vapi transkribiert selbst und schickt fertige Sätze an POST /vapi.
// Damit ist die Telefonie bereits erledigt; ein anderer Anbieter müsste nur dieselben Ereignisse
// erzeugen, dann merkt der Rest des Copiloten keinen Unterschied.

/** Schweregrad, gleiche Werte wie im Workspace-UI (../../app/src/types.ts). */
export type Severity = 'risk' | 'warn' | 'ok' | 'info'

/**
 * Wer spricht. `unknown` ist der Normalfall direkt aus Vapi: Kunde und Berater sprechen in
 * dasselbe Handy auf Lautsprecher, also trägt jede Zeile dieselbe Rolle. Die Zuordnung macht
 * `roles.ts` nachträglich anhand des Inhalts.
 */
export type Speaker = 'caller' | 'advisor' | 'unknown'

/**
 * Briefing-Karten, bewusst deckungsgleich mit `Card` in ../../app/src/types.ts, damit die
 * Ausgabe später ohne Umbau im bestehenden Workspace dargestellt werden kann.
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

/** Ein Anruf beginnt. Aus dem Vapi-Ereignis `status-update` mit `status: "in-progress"`. */
export type CallStarted = {
  type: 'call.started'
  callId: string
  /** Anrufernummer in E.164, z. B. +41791234567. Leerstring, wenn unterdrückt. */
  from: string
  /** ISO-8601 mit Zeitzone. */
  at: string
}

/** Der Kunde hinter der Nummer, samt 60-Sekunden-Briefing. Soll ankommen, solange noch geredet wird. */
export type ClientIdentified = {
  type: 'client.identified'
  callId: string
  /** null = Nummer unbekannt; die Oberfläche bietet dann die manuelle Auswahl an. */
  clientRef: string | null
  name?: string
  confidence: IdentityConfidence
  briefing?: Briefing
}

/**
 * Ein Stück Transkript. `final: false` sind Zwischenergebnisse und ersetzen die offene Zeile
 * desselben Sprechers, statt sich zu stapeln.
 */
export type TranscriptSegment = {
  type: 'transcript.segment'
  callId: string
  /** Fortlaufende Nummer der Zeile, stabil über Zwischenergebnisse hinweg. */
  lineId: number
  speaker: Speaker
  text: string
  final: boolean
  at: string
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
  /** Werkzeugnamen und Zeilenschlüssel, aus denen der Vorschlag stammt. Nie leer. */
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

/** Diagnose für die Oberfläche: Toolbox, Modell, Telefonie. Nie gesprächsrelevant. */
export type StatusEvent = {
  type: 'status'
  callId?: string
  component: 'toolbox' | 'brain' | 'telephony'
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

export const EVENT_TYPES: readonly CallEventType[] = [
  'call.started', 'client.identified', 'transcript.segment',
  'suggestion', 'answer', 'call.ended', 'status',
] as const

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

/**
 * Bringt eine Telefonnummer auf E.164, so gut es ohne Länderkontext geht.
 * `00` wird zu `+`, Trennzeichen fallen weg, eine führende Schweizer `0` wird zu `+41`.
 * Unbekanntes bleibt unverändert, damit nichts stillschweigend falsch zugeordnet wird.
 */
export function toE164(raw: string, defaultCountry = '+41'): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''
  const digits = trimmed.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('00')) return `+${digits.slice(2)}`
  if (digits.startsWith('0')) return `${defaultCountry}${digits.slice(1)}`
  return digits ? `+${digits}` : ''
}

let suggestionCounter = 0
export const nextId = (prefix = 's'): string => `${prefix}${++suggestionCounter}`
