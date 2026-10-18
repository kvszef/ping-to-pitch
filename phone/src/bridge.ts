import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { page } from './page.ts'
import { push, reset, status, subscribe } from './live.ts'
import { mulawZuPcm16 } from './bridge/mulaw.ts'
import { oeffneScribe, type Scribe } from './bridge/scribe.ts'
import { antwortXml } from './bridge/cxml.ts'
import { subscribe as copilotSubscribe, unsubscribe as copilotUnsubscribe } from './copilot/bus.ts'
import { ask, callEnded, callStarted, pruefeDienste } from './copilot/session.ts'
import { copilotPage } from './ui/copilot.ts'
import { demoPage } from './ui/demo.ts'
import { simPage } from './ui/sim.ts'

// Die Brücke sitzt zwischen Kunde und Berater:
//
//   Kunde ──PSTN──▶ Nummer ──▶ POST /answer ──▶ <Dial> auf das Handy des Beraters
//                      │                          (beide sprechen miteinander)
//                      └── <Start><Stream> ──▶ wss://…/media ──▶ ElevenLabs ──▶ /events
//
// Die Spur trennt die Sprecher: inbound ist der Anrufer, outbound das, was er hört.
// Funktioniert bei SignalWire wie bei Twilio – beide sprechen dasselbe cXML/TwiML.
// Ausgelegt auf ein Gespräch zur Zeit – für die Demo genug.

const PORT = Number(process.env.BRIDGE_PORT || 3200)
// Nummer, mit der der Sandkasten anruft. Zeigt ueber data/callers.json auf den Testkunden.
const SIM_NUMMER = (process.env.SIM_FROM ?? '+41791234567').trim()
const PUBLIC_URL = (process.env.BRIDGE_PUBLIC_URL ?? '').trim().replace(/\/+$/, '')
const BERATER_NUMMER = (process.env.ADVISOR_NUMBER ?? '').trim()
const ELEVENLABS_KEY = (process.env.ELEVENLABS_API_KEY ?? '').trim()
const SPRACHE = (process.env.LANGUAGE ?? 'de').trim()

const fehlend = [
  !PUBLIC_URL && 'BRIDGE_PUBLIC_URL',
  !BERATER_NUMMER && 'ADVISOR_NUMBER',
  !ELEVENLABS_KEY && 'ELEVENLABS_API_KEY',
].filter(Boolean)

const koerper = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
  const teile: Buffer[] = []
  req.on('data', (c: Buffer) => teile.push(c)).on('end', () => resolve(Buffer.concat(teile).toString('utf8'))).on('error', reject)
})

// SignalWire und Twilio schicken die Anruf-Ereignisse als Formulardaten, nicht als JSON.
function felder(roh: string, contentType: string): Record<string, string> {
  if (contentType.includes('json')) {
    try { return JSON.parse(roh || '{}') } catch { return {} }
  }
  return Object.fromEntries(new URLSearchParams(roh))
}

const spurName = (spur: string) => (spur.startsWith('out') ? 'Berater' : 'Kunde')

// Pro Spur eine ElevenLabs-Sitzung. Erst anlegen, wenn die Spur zum ersten Mal Ton liefert.
const sitzungen = new Map<string, Scribe>()
let mulaw = true

function sitzung(spur: string): Scribe {
  const vorhanden = sitzungen.get(spur)
  if (vorhanden) return vorhanden
  const name = spurName(spur)
  const neu = oeffneScribe({
    key: ELEVENLABS_KEY,
    sprache: SPRACHE,
    onText: (text, endgueltig) => {
      push(name, text, endgueltig)
      if (endgueltig) console.log(`  ${name.padEnd(8)} │ ${text}`)
    },
    onFehler: (meldung) => { console.error(`ElevenLabs (${name}): ${meldung}`); status(`Transkription ${name}: ${meldung}`) },
  })
  sitzungen.set(spur, neu)
  return neu
}

function beende() {
  for (const s of sitzungen.values()) s.schliesse()
  sitzungen.clear()
}

function medien(ws: WebSocket) {
  console.log('\n♪ Der Anbieter hat den Audiostrom geöffnet')
  ws.on('message', (roh) => {
    let m: Record<string, any>
    try { m = JSON.parse(roh.toString()) } catch { return }

    if (m.event === 'start') {
      // Format nicht annehmen, sondern lesen – und das erste Ereignis vollständig loggen,
      // damit sich abweichende Feldnamen sofort erkennen lassen.
      console.log('start:', JSON.stringify(m).slice(0, 500))
      const typ = String(m.start?.mediaFormat?.encoding ?? m.start?.contentType ?? 'audio/x-mulaw')
      mulaw = typ.includes('mulaw')
      return
    }

    if (m.event === 'media') {
      const nutzlast = m.media?.payload ?? m.media?.Payload
      if (!nutzlast) return
      const spur = String(m.media?.track ?? m.media?.Track ?? 'inbound')
      const roh8 = Buffer.from(nutzlast, 'base64')
      sitzung(spur).sende(mulaw ? mulawZuPcm16(roh8) : roh8)
      return
    }

    if (m.event === 'stop') {
      console.log('✓ Audiostrom beendet')
      beende()
    }
  })
  ws.on('close', () => { console.log('✓ Audiostrom getrennt'); beende(); status('Gespräch beendet'); callEnded('Audiostrom getrennt') })
}

const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  try {
    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(copilotPage)
    }
    // Vorfuehrung ohne Telefon: ein aufgezeichneter Anruf im Lesetempo.
    // Sandkasten: Anruf ohne Telefon, beide Rollen von Hand, alles andere echt.
    if (req.method === 'GET' && url === '/sim') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(simPage)
    }
    if (req.method === 'GET' && url === '/demo') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(demoPage)
    }
    if (req.method === 'GET' && url === '/pruefstand') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(page)
    }
    // Beide Ereignisarten in einem Strom: rohe Zeilen für den Prüfstand, Copilot-Ereignisse
    // unter eigenen Namen. Wer einen Namen nicht kennt, überliest ihn.
    if (req.method === 'GET' && url === '/events') {
      subscribe(res)
      copilotSubscribe(res)
      res.on('close', () => copilotUnsubscribe(res))
      return
    }
    // Sandkasten: ein Anruf ohne Telefon, aber mit allem anderen echt. Die Rolle kommt
    // hier vom Absender, es wird also nichts geraten.
    if (req.method === 'POST' && url.startsWith('/api/sim/')) {
      const p = felder(await koerper(req), req.headers['content-type'] ?? '')
      const was = url.slice('/api/sim/'.length)
      res.writeHead(202, { 'Content-Type': 'application/json' })
      if (was === 'start') { reset('Anruf laeuft'); callStarted((p.from ?? '').trim() || SIM_NUMMER); return res.end(JSON.stringify({ gestartet: true })) }
      if (was === 'say') {
        const text = (p.text ?? '').trim()
        if (!text) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Feld text fehlt' })) }
        const rolle = p.speaker === 'advisor' ? 'Berater' : 'Kunde'
        push(rolle, text, true)
        console.log(`  ${rolle.padEnd(8)} | ${text}`)
        return res.end(JSON.stringify({ angenommen: true, rolle }))
      }
      if (was === 'end') { status('Anruf beendet'); callEnded(p.reason ?? 'im Sandkasten beendet'); return res.end(JSON.stringify({ beendet: true })) }
      return res.end(JSON.stringify({ error: 'Unbekannter Sandkasten-Pfad ' + was }))
    }

    if (req.method === 'POST' && url === '/api/ask') {
      const payload = felder(await koerper(req), req.headers['content-type'] ?? '')
      const frage = (payload.question ?? '').trim()
      res.writeHead(frage ? 202 : 400, { 'Content-Type': 'application/json' })
      // Die Antwort kommt über /events zurück, nicht hier: der Berater soll nicht warten.
      if (frage) void ask(frage)
      return res.end(JSON.stringify(frage ? { angenommen: true } : { error: 'Feld question fehlt' }))
    }
    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, bereit: !fehlend.length }))
    }

    if (req.method === 'POST' && url === '/answer') {
      const f = felder(await koerper(req), req.headers['content-type'] ?? '')
      const von = f.From ?? '', an = f.To ?? ''
      console.log(`\n☎ Anruf von ${von} auf ${an} – verbinde mit ${BERATER_NUMMER}`)
      reset(`Anruf von ${von}`)
      // Der Copilot schlägt die Nummer nach und baut das Briefing, während es noch klingelt.
      callStarted(von)
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
      res.end(antwortXml({
        beraterNummer: BERATER_NUMMER,
        anruferId: an || von,
        stromUrl: `${PUBLIC_URL.replace(/^https:/, 'wss:')}/media`,
      }))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `Unbekannter Pfad ${url}` }))
  } catch (e) {
    console.error('Fehler:', e)
    if (!res.headersSent) { res.writeHead(500); res.end() } else res.end()
  }
})

const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  if ((req.url ?? '').split('?')[0] !== '/media') return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => medien(ws))
})

server.listen(PORT, () => {
  console.log(`Prüfstand:   http://localhost:${PORT}`)
  console.log(`Answer-URL:  ${PUBLIC_URL || '(BRIDGE_PUBLIC_URL fehlt)'}/answer`)
  console.log(`Audiostrom:  ${PUBLIC_URL ? PUBLIC_URL.replace(/^https:/, 'wss:') : '(fehlt)'}/media`)
  console.log(`Berater:     ${BERATER_NUMMER || '(ADVISOR_NUMBER fehlt)'}`)
  if (fehlend.length) console.log(`\n⚠ Noch nicht einsatzbereit, es fehlt in .env: ${fehlend.join(', ')}`)
})
