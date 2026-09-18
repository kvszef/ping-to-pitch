// Setzt den Voice-Webhook der Twilio-Nummer auf die öffentliche URL dieses Servers.
//   npm run webhook -- --url https://xxxx.trycloudflare.com
import { parseArgs } from 'node:util'
import { config } from '../src/config.ts'
import { setVoiceWebhook } from './twilio-client.ts'

const { values } = parseArgs({ options: { url: { type: 'string' } } })
const url = values.url ?? config.publicUrl
if (!url) { console.error('Öffentliche URL fehlt: --url https://… oder PUBLIC_URL in .env'); process.exit(1) }
const voiceUrl = await setVoiceWebhook(url)
console.log(`Voice-Webhook von ${config.twilio.phoneNumber} gesetzt auf ${voiceUrl}`)
