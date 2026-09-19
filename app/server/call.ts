import type { IncomingMessage, ServerResponse } from 'node:http'

// Relay for the internet call between the client's phone (call.html) and the advisor's desk (the app).
// It only passes small JSON messages (call setup, captions); the audio itself flows directly between
// the two browsers over WebRTC. One call at a time is enough for the demo.
//
//   GET  /api/call/events?role=desk|phone   server-sent events, one JSON message per event
//   POST /api/call/send  { to: 'desk' | 'phone', msg: CallMessage }
//
// A ring that arrives before the desk is listening is kept and delivered when the desk connects.

export type Role = 'desk' | 'phone'

const listeners: Record<Role, Set<ServerResponse>> = { desk: new Set(), phone: new Set() }
let pendingRing: unknown = null

function push(to: Role, msg: unknown) {
  const line = `data: ${JSON.stringify(msg)}\n\n`
  for (const res of listeners[to]) res.write(line)
}

const readBody = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
  let data = ''
  req.on('data', (c: Buffer) => { data += c.toString('utf8') }).on('end', () => resolve(data)).on('error', reject)
})

export async function callRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://local')
  if (url.pathname === '/api/call/events' && req.method === 'GET') {
    const role: Role = url.searchParams.get('role') === 'phone' ? 'phone' : 'desk'
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.write(': connected\n\n')
    listeners[role].add(res)
    if (role === 'desk' && pendingRing) res.write(`data: ${JSON.stringify(pendingRing)}\n\n`)
    // Keeps tunnels and proxies from closing an idle stream.
    const ping = setInterval(() => res.write(': ping\n\n'), 15000)
    req.on('close', () => { clearInterval(ping); listeners[role].delete(res) })
    return true
  }
  if (url.pathname === '/api/call/send' && req.method === 'POST') {
    const { to, msg } = JSON.parse(await readBody(req)) as { to: Role; msg: { type?: string } }
    if (to !== 'desk' && to !== 'phone') { res.statusCode = 400; res.end('{"error":"to must be desk or phone"}'); return true }
    if (msg?.type === 'ring') pendingRing = msg
    if (msg?.type === 'answer' || msg?.type === 'hangup' || msg?.type === 'decline') pendingRing = null
    push(to, msg)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ ok: true, listeners: listeners[to].size }))
    return true
  }
  return false
}
