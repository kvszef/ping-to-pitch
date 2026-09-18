// Startet Tunnel (cloudflared) + Server und hinterlegt die Tunnel-URL als Twilio-Webhook.
//   npm run up              → Tunnel + Server
//   npm run tunnel          → nur Tunnel (Server läuft separat mit `npm start`)
import { spawn, type ChildProcess } from 'node:child_process'
import { ROOT, config } from '../src/config.ts'
import { setVoiceWebhook } from './twilio-client.ts'

const withServer = !process.argv.includes('--no-server')
const verbose = process.argv.includes('--verbose')
const children: ChildProcess[] = []
let publicUrl = ''

const shutdown = (code = 0): void => {
  for (const c of children) if (!c.killed) c.kill()
  process.exit(code)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${config.port}`], { cwd: ROOT })
children.push(tunnel)
tunnel.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'ENOENT') {
    console.error('cloudflared ist nicht installiert. Installieren mit:')
    console.error('   winget install --id Cloudflare.cloudflared      (Windows)')
    console.error('   brew install cloudflared                        (macOS)')
    console.error('Danach ein neues Terminal öffnen und `npm run up` erneut starten.')
    console.error('Alternative: ngrok (`ngrok http 3000`) und die URL mit `npm run webhook -- --url https://…` setzen.')
  } else console.error('Tunnel-Fehler', err)
  shutdown(1)
})
tunnel.on('exit', (code) => { console.error(`Tunnel beendet (Code ${code})`); shutdown(code ?? 1) })

const onTunnelOutput = (chunk: Buffer): void => {
  const text = chunk.toString()
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
  if (m && !publicUrl) { publicUrl = m[0]; void announce(publicUrl) }
  else if (verbose) process.stderr.write(text)
}
tunnel.stdout.on('data', onTunnelOutput)
tunnel.stderr.on('data', onTunnelOutput)

async function announce(url: string): Promise<void> {
  console.log('\n──────────────────────────────────────────────')
  console.log(`Öffentliche URL:  ${url}`)
  console.log(`TwiML-Webhook:    ${url}/twiml`)
  if (withServer) {
    const server = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'src/server.ts'], {
      cwd: ROOT, stdio: 'inherit', env: { ...process.env, PUBLIC_URL: url },
    })
    children.push(server)
    server.on('exit', (code) => { console.error(`Server beendet (Code ${code})`); shutdown(code ?? 1) })
  }
  const t = config.twilio
  if (t.accountSid && t.authToken && t.phoneNumber) {
    try {
      const voiceUrl = await setVoiceWebhook(url)
      console.log(`Twilio-Webhook:   gesetzt auf ${voiceUrl}`)
      console.log(`\n☎  Jetzt anrufen: ${t.phoneNumber}`)
    } catch (err) {
      console.error(`Twilio-Webhook konnte nicht gesetzt werden: ${(err as Error).message}`)
      console.error(`Manuell im Twilio-Console bei der Nummer eintragen: ${url}/twiml (HTTP POST)`)
    }
  } else {
    console.log('Twilio-Zugangsdaten oder Nummer fehlen in .env → Webhook manuell bei der Nummer eintragen:')
    console.log(`   Voice → «A call comes in» → Webhook ${url}/twiml (HTTP POST)`)
  }
  console.log('──────────────────────────────────────────────\n')
}
