import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { page } from './page.ts'
import { push, reset, status, subscribe } from './live.ts'

// Vier Routen, keine Abhängigkeiten:
//   POST /vapi  Vapis Server-Webhook mit den Transkript-Ereignissen
//   POST /llm   der Assistent fragt nach einer Antwort und bekommt eine leere – so schweigt er
//   GET  /events  Server-Sent Events mit dem laufenden Transkript
//   GET  /        Prüfstand-Seite

const PORT = Number(process.env.PORT || 3100)

const json = (res: ServerResponse, status: number, data: unknown) => {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

const body = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))).on('error', reject)
})

type VapiMessage = {
  type?: string
  role?: string
  transcript?: string
  transcriptType?: 'partial' | 'final'
  status?: string
  endedReason?: string
  call?: { customer?: { number?: string } }
}

function handleVapi(message: VapiMessage) {
  if (message.type === 'transcript') {
    const speaker = message.role === 'assistant' ? 'assistant' : 'user'
    push(speaker, message.transcript ?? '', message.transcriptType === 'final')
    if (message.transcriptType === 'final') console.log(`  ${speaker === 'assistant' ? 'Assistent' : 'Anrufer '} │ ${message.transcript}`)
    return
  }
  if (message.type === 'status-update') {
    if (message.status === 'in-progress') {
      const from = message.call?.customer?.number
      console.log(`\n☎ Anruf angenommen${from ? ` von ${from}` : ''}`)
      reset('Anruf läuft')
    }
    if (message.status === 'ended') {
      console.log(`✓ Anruf beendet${message.endedReason ? ` (${message.endedReason})` : ''}\n`)
      status('Anruf beendet')
    }
  }
}

// Der Assistent soll nichts sagen. Vapi erwartet hier eine OpenAI-kompatible Antwort;
// leerer Inhalt heisst: nichts zu sprechen. Muss sofort zurückkommen – Vapi bricht nach 7,5 s ab.
function handleLlm(res: ServerResponse, stream: boolean) {
  const base = { id: `leer-${Date.now()}`, created: Math.floor(Date.now() / 1000), model: 'leer' }
  if (!stream) {
    // Vapis eigenes Beispiel liest hier «delta», die OpenAI-Norm «message». Beides mitgeben,
    // dann passt die Antwort unabhängig davon, welche Lesart Vapi gerade verwendet.
    return json(res, 200, {
      ...base,
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, delta: { content: '' }, finish_reason: 'stop' }],
    })
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const chunk = (delta: unknown, finish: string | null) =>
    res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
  chunk({ role: 'assistant', content: '' }, null)
  chunk({}, 'stop')
  res.write('data: [DONE]\n\n')
  res.end()
}

const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  try {
    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(page)
    }
    if (req.method === 'GET' && url === '/events') return subscribe(res)
    if (req.method === 'GET' && url === '/health') return json(res, 200, { ok: true })

    if (req.method === 'POST' && url === '/vapi') {
      const payload = JSON.parse((await body(req)) || '{}') as { message?: VapiMessage }
      if (payload.message) handleVapi(payload.message)
      return json(res, 200, {})
    }

    // Vapi hängt an die konfigurierte custom-llm-URL noch /chat/completions an.
    if (req.method === 'POST' && url.startsWith('/llm')) {
      const payload = JSON.parse((await body(req)) || '{}') as { stream?: boolean }
      return handleLlm(res, payload.stream === true)
    }

    json(res, 404, { error: `Unbekannter Pfad ${url}` })
  } catch (e) {
    console.error('Fehler:', e)
    if (!res.headersSent) json(res, 500, { error: e instanceof Error ? e.message : String(e) })
    else res.end()
  }
})

server.listen(PORT, () => {
  console.log(`Prüfstand:  http://localhost:${PORT}`)
  console.log(`Webhook:    POST /vapi`)
  console.log(process.env.PUBLIC_URL
    ? `Öffentlich: ${process.env.PUBLIC_URL}`
    : 'Öffentlich: noch keine PUBLIC_URL – Tunnel starten, dann `npm run setup`')
})
