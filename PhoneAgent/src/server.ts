import http from 'node:http'
import fs from 'node:fs'
import twilio from 'twilio'
import { WebSocketServer, type WebSocket } from 'ws'
import { config, hasAnthropicCredentials } from './config.ts'
import { clientName, data } from './data.ts'
import { CallAgent } from './agent.ts'
import { conversationRelayTwiml, hangupTwiml } from './twiml.ts'

type Turn = { role: 'caller' | 'agent'; text: string; at: string }
type Session = {
  callSid: string; from: string; clientRef?: string; startedAt: string; endedAt?: string
  agent: CallAgent; transcript: Turn[]; abort?: AbortController
}

const sessions = new Map<string, Session>()
const recent: Session[] = []
const now = (): string => new Date().toISOString()
const log = (callSid: string, ...rest: unknown[]): void => console.log(`[${now().slice(11, 19)}] [${callSid.slice(-6)}]`, ...rest)

// ---------- Anrufer -> Kunde ----------
const loadCallers = (): Record<string, string> => {
  try { return JSON.parse(fs.readFileSync(config.callersJson, 'utf8')) as Record<string, string> } catch { return {} }
}
const callers = loadCallers()
const resolveClientRef = (from?: string, explicit?: string): string | undefined =>
  explicit || (from ? callers[from] : undefined) || config.defaultClientRef || undefined

// ---------- HTTP ----------
const readBody = (req: http.IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

/** Öffentliche Basis-URL: PUBLIC_URL aus .env, sonst Host-Header (Tunnel reicht ihn durch). */
const publicBase = (req: http.IncomingMessage): string => {
  if (config.publicUrl) return config.publicUrl
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0].trim()
  return `${proto}://${req.headers.host ?? `localhost:${config.port}`}`
}

const twilioSignatureOk = (req: http.IncomingMessage, url: string, params: Record<string, string>): boolean => {
  if (!config.twilio.validate) return true
  if (!config.twilio.authToken) return true
  const signature = req.headers['x-twilio-signature']
  if (typeof signature !== 'string') return false
  return twilio.validateRequest(config.twilio.authToken, signature, url, params)
}

const send = (res: http.ServerResponse, status: number, body: string, type = 'application/json; charset=utf-8'): void => {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const method = req.method ?? 'GET'
  try {
    if (url.pathname === '/' || url.pathname === '/health') {
      return send(res, 200, JSON.stringify({
        ok: true, model: config.mockLlm ? 'mock' : config.model, clients: data.clients.length,
        activeCalls: sessions.size, publicUrl: config.publicUrl || null, phoneNumber: config.twilio.phoneNumber || null,
      }, null, 2))
    }
    if (url.pathname === '/calls') {
      const list = [...sessions.values(), ...recent].map((s) => ({ callSid: s.callSid, from: s.from, clientRef: s.clientRef, startedAt: s.startedAt, endedAt: s.endedAt, transcript: s.transcript }))
      return send(res, 200, JSON.stringify(list, null, 2))
    }
    if (url.pathname === '/twiml' && (method === 'POST' || method === 'GET')) {
      const body = method === 'POST' ? await readBody(req) : ''
      const params = method === 'POST' ? Object.fromEntries(new URLSearchParams(body)) : Object.fromEntries(url.searchParams)
      const base = publicBase(req)
      const fullUrl = `${base}${url.pathname}${method === 'GET' ? url.search : ''}`
      if (!twilioSignatureOk(req, fullUrl, params)) {
        console.warn(`Twilio-Signatur ungültig für ${fullUrl}. PUBLIC_URL muss exakt der bei Twilio hinterlegten URL entsprechen (oder TWILIO_VALIDATE=0 zum Debuggen).`)
        return send(res, 403, 'invalid twilio signature', 'text/plain')
      }
      const from = params.From
      const clientRef = resolveClientRef(from)
      const client = clientRef ? data.find(clientRef) : undefined
      const greeting = client ? config.welcomeGreetingKnown.replace('{name}', clientName(client)) : config.welcomeGreeting
      const twiml = conversationRelayTwiml({
        wsUrl: `${base.replace(/^http/, 'ws')}/ws`,
        actionUrl: `${base}/call-ended`,
        greeting,
        parameters: { clientRef: client?.ClientRef ?? '' },
      })
      log(params.CallSid ?? 'twiml', `Anruf von ${from ?? '?'} → TwiML${client ? ` (Kunde ${client.ClientRef})` : ''}`)
      return send(res, 200, twiml, 'text/xml; charset=utf-8')
    }
    if (url.pathname === '/call-ended') {
      const body = method === 'POST' ? await readBody(req) : ''
      const params = Object.fromEntries(new URLSearchParams(body))
      log(params.CallSid ?? 'end', `Relay beendet${params.HandoffData ? `: ${params.HandoffData}` : ''}`)
      return send(res, 200, hangupTwiml(), 'text/xml; charset=utf-8')
    }
    send(res, 404, 'not found', 'text/plain')
  } catch (err) {
    console.error('HTTP-Fehler', err)
    send(res, 500, 'server error', 'text/plain')
  }
})

// ---------- WebSocket (ConversationRelay) ----------
type RelayMessage =
  | { type: 'setup'; sessionId?: string; callSid?: string; from?: string; to?: string; customParameters?: Record<string, string> }
  | { type: 'prompt'; voicePrompt?: string; lang?: string; last?: boolean }
  | { type: 'interrupt'; utteranceUntilInterrupt?: string; durationUntilInterruptMs?: number }
  | { type: 'dtmf'; digit?: string }
  | { type: 'error'; description?: string }

const wss = new WebSocketServer({ noServer: true })
const wsSend = (ws: WebSocket, obj: unknown): void => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)) }

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  if (pathname !== '/ws') { socket.destroy(); return }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

wss.on('connection', (ws: WebSocket) => {
  let session: Session | undefined

  ws.on('message', async (raw) => {
    let msg: RelayMessage
    try { msg = JSON.parse(raw.toString()) as RelayMessage } catch { return }

    switch (msg.type) {
      case 'setup': {
        const callSid = msg.callSid ?? msg.sessionId ?? `local-${Date.now()}`
        const clientRef = resolveClientRef(msg.from, msg.customParameters?.clientRef)
        session = { callSid, from: msg.from ?? '?', clientRef, startedAt: now(), agent: new CallAgent(callSid, clientRef), transcript: [] }
        sessions.set(callSid, session)
        log(callSid, `Session gestartet · von ${session.from}${clientRef ? ` · Kunde ${clientRef}` : ' · Kunde unbekannt'}`)
        return
      }
      case 'prompt': {
        if (!session || msg.last === false) return
        const text = String(msg.voicePrompt ?? '').trim()
        if (!text) return
        const s = session
        s.transcript.push({ role: 'caller', text, at: now() })
        log(s.callSid, `Anrufer: ${text}`)
        s.abort?.abort()
        const ac = new AbortController()
        s.abort = ac
        let reply = ''
        const t0 = Date.now()
        let firstToken = 0
        try {
          reply = await s.agent.respond(text, (token) => {
            if (ac.signal.aborted) return
            if (!firstToken) firstToken = Date.now() - t0
            wsSend(ws, { type: 'text', token, last: false })
          }, ac.signal)
        } catch (err) {
          if (!ac.signal.aborted) {
            console.error(`[${s.callSid.slice(-6)}] Modellfehler`, err)
            reply = 'Entschuldigung, da ist etwas schiefgelaufen. Können Sie das bitte wiederholen?'
            wsSend(ws, { type: 'text', token: reply, last: false })
          }
        }
        if (!ac.signal.aborted) wsSend(ws, { type: 'text', token: '', last: true })
        if (reply) s.transcript.push({ role: 'agent', text: reply, at: now() })
        log(s.callSid, `Agent${ac.signal.aborted ? ' (unterbrochen)' : ''}: ${reply}  [erstes Token nach ${firstToken} ms, gesamt ${Date.now() - t0} ms]`)
        return
      }
      case 'interrupt': {
        if (!session) return
        session.abort?.abort()
        const heard = msg.utteranceUntilInterrupt ?? ''
        const trimmed = session.agent.truncateAfterInterrupt(heard)
        log(session.callSid, `Unterbrochen nach: «${heard}»${trimmed ? '' : ' (Verlauf unverändert)'}`)
        return
      }
      case 'dtmf':
        if (session) log(session.callSid, `Taste gedrückt: ${msg.digit}`)
        return
      case 'error':
        console.error(`[${session?.callSid.slice(-6) ?? 'ws'}] ConversationRelay-Fehler: ${msg.description}`)
        return
    }
  })

  ws.on('close', () => {
    if (!session) return
    session.abort?.abort()
    session.endedAt = now()
    sessions.delete(session.callSid)
    recent.unshift(session)
    if (recent.length > 20) recent.length = 20
    log(session.callSid, `Session beendet · ${session.transcript.length} Beiträge`)
  })
  ws.on('error', (err) => console.error('WebSocket-Fehler', err))
})

// ---------- Start ----------
const stats = data.load()
console.log(`Daten geladen: ${stats.clients} Kunden, ${stats.securities} Titel (${stats.ms} ms)`)
if (config.mockLlm) console.log('MOCK_LLM=1: Antworten kommen ohne Sprachmodell.')
else if (!hasAnthropicCredentials()) console.warn('Kein ANTHROPIC_API_KEY gesetzt. Läuft nur, wenn ein `ant auth login`-Profil existiert, sonst MOCK_LLM=1 setzen.')
else console.log(`Modell: ${config.model} (effort ${config.effort})`)
if (!config.twilio.authToken) console.warn('TWILIO_AUTH_TOKEN fehlt: Webhook-Signaturen werden nicht geprüft.')
if (Object.keys(callers).length) console.log(`Anruferzuordnung geladen: ${Object.keys(callers).length} Nummern`)

server.listen(config.port, () => {
  console.log(`Telefon-Agent läuft auf http://localhost:${config.port}  (TwiML: /twiml · WebSocket: /ws · Status: /health · Gespräche: /calls)`)
  if (config.publicUrl) console.log(`Öffentlich: ${config.publicUrl}/twiml`)
  else console.log('PUBLIC_URL nicht gesetzt: die Tunnel-URL wird aus dem Host-Header abgeleitet. `npm run up` startet Tunnel + Server zusammen.')
})
