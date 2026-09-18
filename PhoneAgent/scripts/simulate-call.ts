// Simuliert einen Anruf ohne Telefon: spricht das ConversationRelay-Protokoll gegen den lokalen Server.
//   npm run call                                  → interaktiv (Text eingeben = sprechen, /bye = auflegen)
//   npm run call -- --client CASE-004             → Anrufer ist bereits als Kunde identifiziert
//   npm run call -- --say "Ich bin Yoda" --say "Wie steht mein Portfolio?"   → Skript, nicht interaktiv
import readline from 'node:readline'
import { parseArgs } from 'node:util'
import WebSocket from 'ws'
import { config } from '../src/config.ts'

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: '+41790000000' },
    client: { type: 'string' },
    say: { type: 'string', multiple: true },
    port: { type: 'string' },
  },
})
const port = Number(values.port ?? config.port)
const scripted = values.say ?? []
const ws = new WebSocket(`ws://localhost:${port}/ws`)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const send = (obj: unknown): void => ws.send(JSON.stringify(obj))
let idx = 0

const speak = (text: string): void => {
  console.log(`\nAnrufer: ${text}`)
  process.stdout.write('Agent:   ')
  send({ type: 'prompt', voicePrompt: text, lang: config.language, last: true })
}
const next = (): void => {
  if (scripted.length) {
    if (idx < scripted.length) speak(scripted[idx++])
    else { ws.close(); rl.close(); process.exit(0) }
  } else {
    rl.question('\nSie: ', (line) => {
      const text = line.trim()
      if (!text) return next()
      if (text === '/bye') { ws.close(); rl.close(); process.exit(0) }
      if (text.startsWith('/interrupt ')) { send({ type: 'interrupt', utteranceUntilInterrupt: text.slice(11), durationUntilInterruptMs: 1200 }); return next() }
      speak(text)
    })
  }
}

ws.on('open', () => {
  send({
    type: 'setup', sessionId: 'VX-simulation', callSid: `CA-sim-${Date.now()}`, from: values.from, to: config.twilio.phoneNumber || '+41000000000',
    direction: 'inbound', callType: 'PSTN', customParameters: values.client ? { clientRef: values.client } : {},
  })
  console.log(`Verbunden mit ws://localhost:${port}/ws als ${values.from}${values.client ? ` (Kunde ${values.client})` : ''}`)
  next()
})
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString()) as { type: string; token?: string; last?: boolean }
  if (m.type === 'text') {
    process.stdout.write(m.token ?? '')
    if (m.last) { process.stdout.write('\n'); next() }
  } else console.log('\n[server]', m)
})
ws.on('error', (err) => { console.error(`Keine Verbindung zu localhost:${port}. Läuft der Server (npm start)?`, err.message); process.exit(1) })
ws.on('close', () => process.exit(0))
