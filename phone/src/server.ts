import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { page } from './page.ts'
import { push, reset, status, subscribe } from './live.ts'
import { subscribe as copilotSubscribe, unsubscribe as copilotUnsubscribe } from './copilot/bus.ts'
import { ask, callEnded, callStarted, pruefeDienste } from './copilot/session.ts'
import { copilotPage } from './ui/copilot.ts'

// Die Routen:
//   POST /vapi       Vapis Server-Webhook mit den Transkript-Ereignissen
//   POST /llm        der Assistent fragt nach einer Antwort und bekommt eine leere – so schweigt er
//   POST /api/ask    Rückfrage des Beraters; die Antwort kommt über /events zurück
//   GET  /events     Server-Sent Events: rohes Transkript und Copilot-Ereignisse in einem Strom
//   GET  /           die Seite des Beraters
//   GET  /pruefstand die schlichte Seite für die Telefonie allein

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
    const text = message.transcript ?? ''
    const final = message.transcriptType === 'final'
    // Nur in live.ts schreiben: von dort holt sich der Copilot die Zeile selbst ab.
    // Vapi kennt keine Sprechertrennung, beide sprechen in dasselbe Handy – die Rolle
    // bestimmt der Copilot deshalb nachträglich aus dem Inhalt.
    push(speaker, text, final)
    if (final) console.log(`  Gehört │ ${text}`)
    return
  }
  if (message.type === 'status-update') {
    if (message.status === 'in-progress') {
      reset('Anruf läuft')
      callStarted(message.call?.customer?.number ?? '')
    }
    if (message.status === 'ended') {
      console.log(`✓ Anruf beendet${message.endedReason ? ` (${message.endedReason})` : ''}`)
      status('Anruf beendet')
      callEnded(message.endedReason)
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
    if (req.method === 'GET' && (url === '/' || url === '/copilot')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(copilotPage)
    }
    if (req.method === 'GET' && url === '/pruefstand') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(page)
    }
    // Ein Strom für beide Seiten: live.ts schreibt die Kopfzeilen und die rohen Zeilen,
    // der Copilot legt seine Ereignisse unter eigenen Namen daneben. Wer einen Namen nicht
    // kennt, überliest ihn.
    if (req.method === 'GET' && url === '/events') {
      subscribe(res)
      copilotSubscribe(res)
      res.on('close', () => copilotUnsubscribe(res))
      return
    }
    if (req.method === 'GET' && url === '/health') return json(res, 200, { ok: true })

    if (req.method === 'POST' && url === '/api/ask') {
      const payload = JSON.parse((await body(req)) || '{}') as { question?: string }
      const frage = (payload.question ?? '').trim()
      if (!frage) return json(res, 400, { error: 'Feld question fehlt' })
      // Die Antwort kommt über /events zurück, nicht hier: der Berater soll nicht warten.
      void ask(frage)
      return json(res, 202, { angenommen: true })
    }

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
  console.log(`Berater:    http://localhost:${PORT}          (Vorführmodus: /?demo=1)`)
  console.log(`Prüfstand:  http://localhost:${PORT}/pruefstand`)
  console.log(`Webhook:    POST /vapi`)
  void pruefeDienste()
  console.log(process.env.PUBLIC_URL
    ? `Öffentlich: ${process.env.PUBLIC_URL}`
    : 'Öffentlich: noch keine PUBLIC_URL – Tunnel starten, dann `npm run setup`')
})
