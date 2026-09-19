import type { ServerResponse } from 'node:http'

// Hält das laufende Transkript und verteilt jede Änderung an alle offenen Browser.
// Vapi schickt pro Äusserung viele «partial» und zum Schluss ein «final»; die vorläufigen
// ersetzen einander, statt sich zu stapeln – deshalb pro Sprecher eine offene Zeile.

export type Line = { id: number; speaker: string; text: string; final: boolean }

const clients = new Set<ServerResponse>()
const open = new Map<string, Line>()
let lines: Line[] = []
let counter = 0

// Hier laufen alle Transkriptzeilen zusammen, egal über welchen Weg sie hereinkommen:
// über Vapi in server.ts oder über die Sprechbrücke in bridge.ts. Deshalb ist das die
// richtige Stelle, um den Copiloten anzuhängen – er bekommt jede Zeile, ohne dass ein
// neuer Telefonieweg etwas davon wissen muss.
type Beobachter = (speaker: string, text: string, final: boolean) => void
const beobachter: Beobachter[] = []

export function beobachte(handler: Beobachter): void {
  beobachter.push(handler)
}

const send = (res: ServerResponse, event: string, data: unknown) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

const broadcast = (event: string, data: unknown) => {
  for (const res of clients) send(res, event, data)
}

export function subscribe(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Damit Proxys und Tunnel den Strom nicht puffern.
    'X-Accel-Buffering': 'no',
  })
  clients.add(res)
  // Wer später dazukommt, sieht das bisherige Gespräch.
  for (const line of lines) send(res, 'line', line)
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000)
  res.on('close', () => { clearInterval(keepAlive); clients.delete(res) })
}

/** Neuer Text eines Sprechers. `final` schliesst die offene Zeile ab. */
export function push(speaker: string, text: string, final: boolean) {
  const trimmed = text.trim()
  if (!trimmed) return
  let line = open.get(speaker)
  if (!line) {
    line = { id: ++counter, speaker, text: trimmed, final }
    lines.push(line)
    open.set(speaker, line)
  } else {
    line.text = trimmed
    line.final = final
  }
  if (final) open.delete(speaker)
  broadcast('line', line)
  // Ein Beobachter darf die Telefonie nie aufhalten oder umwerfen.
  for (const b of beobachter) {
    try { b(speaker, trimmed, final) } catch (e) { console.error('Beobachter-Fehler:', e) }
  }
}

/** Beginnt ein neues Gespräch: der Browser leert die Anzeige. */
export function reset(note: string) {
  lines = []
  open.clear()
  broadcast('reset', { note })
}

export function status(note: string) {
  broadcast('status', { note })
}
