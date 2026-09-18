import type { ServerResponse } from 'node:http'
import type { Briefing, CallEvent, IdentityConfidence, Speaker } from './events.ts'
import type { Line } from './types.ts'

// Der Ereignisbus des Copiloten. Er hält den Zustand des laufenden Gesprächs und verteilt jede
// Änderung an alle offenen Browser.
//
// Warum ein eigener Bus neben live.ts: live.ts bedient die Prüfstand-Seite mit rohen Zeilen und
// soll unverändert weiterlaufen. Der Copilot braucht mehr – erkannter Kunde, Briefing, Vorschläge –
// und schickt das über dieselbe SSE-Verbindung unter eigenen Ereignisnamen. Ein Browser ignoriert
// Namen, die er nicht kennt, deshalb stören sich die beiden Seiten nicht.
//
// Wer später dazukommt, bekommt den bisherigen Verlauf nachgereicht. Das ist wichtig: der Berater
// öffnet die Seite oft erst, wenn das Telefon schon klingelt.

const clients = new Set<ServerResponse>()

/** Alles, was ein neu verbundener Browser braucht, um den aktuellen Stand zu zeigen. */
type CallState = {
  callId: string
  from: string
  startedAt: string
  clientRef: string | null
  clientName?: string
  briefing?: Briefing
  lines: Line[]
  /** Vorschläge und Antworten in Reihenfolge ihres Eintreffens. */
  history: CallEvent[]
  ended: boolean
}

let current: CallState | null = null
let lineCounter = 0

const now = (): string => new Date().toISOString()

const write = (res: ServerResponse, event: string, data: unknown): void => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/** Ein Ereignis an alle offenen Browser schicken. Der Ereignisname ist `event.type`. */
export function publish(event: CallEvent): void {
  if (current && event.type !== 'status') {
    if (event.type === 'suggestion' || event.type === 'answer') current.history.push(event)
  }
  for (const res of clients) write(res, event.type, event)
}

/** Eine SSE-Verbindung aufnehmen und ihr den bisherigen Stand nachreichen. */
export function subscribe(res: ServerResponse): void {
  clients.add(res)
  if (!current) return
  replay(res)
}

export function unsubscribe(res: ServerResponse): void {
  clients.delete(res)
}

/** Den bisherigen Stand an eine einzelne Verbindung schicken, in der Reihenfolge des Vertrags. */
function replay(res: ServerResponse): void {
  const s = current
  if (!s) return
  write(res, 'call.started', { type: 'call.started', callId: s.callId, from: s.from, at: s.startedAt })
  if (s.clientRef !== null || s.briefing) {
    write(res, 'client.identified', {
      type: 'client.identified', callId: s.callId, clientRef: s.clientRef,
      name: s.clientName, confidence: s.clientRef ? 'phone' : 'unknown', briefing: s.briefing,
    })
  }
  for (const line of s.lines) {
    write(res, 'transcript.segment', {
      type: 'transcript.segment', callId: s.callId, lineId: line.lineId,
      speaker: line.speaker, text: line.text, final: line.final, at: s.startedAt,
    })
  }
  for (const event of s.history) write(res, event.type, event)
  if (s.ended) write(res, 'call.ended', { type: 'call.ended', callId: s.callId, at: now() })
}

// ---------------------------------------------------------------- Zustand

/** Beginnt ein neues Gespräch und verwirft das vorige. */
export function startCall(from: string): CallState {
  lineCounter = 0
  current = {
    callId: `call-${Date.now().toString(36)}`,
    from,
    startedAt: now(),
    clientRef: null,
    lines: [],
    history: [],
    ended: false,
  }
  publish({ type: 'call.started', callId: current.callId, from, at: current.startedAt })
  return current
}

export function endCall(reason?: string): void {
  if (!current) return
  current.ended = true
  publish({ type: 'call.ended', callId: current.callId, at: now(), reason })
}

export const activeCall = (): CallState | null => current

/** Den erkannten Kunden festhalten und melden. Wird zweimal aufgerufen: erst ohne, dann mit Briefing. */
export function setClient(clientRef: string | null, name: string | undefined, confidence: IdentityConfidence, briefing?: Briefing): void {
  if (!current) return
  current.clientRef = clientRef
  current.clientName = name
  if (briefing) current.briefing = briefing
  publish({
    type: 'client.identified', callId: current.callId, clientRef,
    name, confidence, briefing: current.briefing,
  })
}

/**
 * Neuer Text eines Sprechers aus dem Vapi-Webhook.
 *
 * Vapi schickt eine Äusserung als wachsende Bruchstücke und zum Schluss einmal endgültig. Die
 * vorläufigen ersetzen einander, deshalb bleibt pro Sprecher genau eine offene Zeile stehen.
 * Zurück kommt die Zeile, damit der Aufrufer bei `final` die Rollenzuordnung anstossen kann.
 */
export function pushLine(speaker: Speaker, text: string, final: boolean): Line | null {
  const s = current
  if (!s) return null
  const trimmed = text.trim()
  if (!trimmed) return null

  const open = s.lines.find((l) => !l.final && l.speaker === speaker)
  const line: Line = open ?? { lineId: ++lineCounter, speaker, text: trimmed, final }
  if (open) {
    open.text = trimmed
    open.final = final
  } else {
    s.lines.push(line)
  }

  publish({
    type: 'transcript.segment', callId: s.callId, lineId: line.lineId,
    speaker: line.speaker, text: line.text, final: line.final, at: now(),
  })
  return line
}

/** Nach der Rollenzuordnung: Sprecher und geglätteten Text einer bestehenden Zeile nachtragen. */
export function updateLine(lineId: number, speaker: Speaker, text?: string): void {
  const s = current
  if (!s) return
  const line = s.lines.find((l) => l.lineId === lineId)
  if (!line) return
  line.speaker = speaker
  if (text && text.trim()) line.text = text.trim()
  publish({
    type: 'transcript.segment', callId: s.callId, lineId: line.lineId,
    speaker: line.speaker, text: line.text, final: line.final, at: now(),
  })
}

/** Die letzten `n` abgeschlossenen Zeilen, älteste zuerst. Kontext für das Copilot-Hirn. */
export function recentLines(n: number): Line[] {
  const s = current
  if (!s) return []
  return s.lines.filter((l) => l.final).slice(-n)
}

export function status(component: 'toolbox' | 'brain' | 'telephony', ok: boolean, detail?: string): void {
  publish({ type: 'status', callId: current?.callId, component, ok, detail })
}
