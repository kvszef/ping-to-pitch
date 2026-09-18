import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Legt den mithörenden Assistenten bei Vapi an und hängt ihn an die gratis Nummer.
// Nach jedem neuen cloudflared-Tunnel erneut ausführen: die Tunnel-URL steht im Assistenten
// und ändert sich bei jedem Start.
//   npm run setup

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STATE = resolve(ROOT, 'vapi-state.json')

const KEY = (process.env.VAPI_API_KEY ?? '').trim()
const PUBLIC_URL = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '')
const LANGUAGE = (process.env.LANGUAGE ?? 'de').trim()
const GREETING = (process.env.GREETING ?? '').trim()

const abbruch = (text: string): never => { console.error(`\n${text}\n`); process.exit(1) }

if (!KEY) abbruch('VAPI_API_KEY fehlt. Schlüssel im Vapi-Dashboard unter Settings → API Keys holen und in .env eintragen.')
if (!PUBLIC_URL) abbruch('PUBLIC_URL fehlt. Erst `cloudflared tunnel --url http://localhost:3100` starten, die https-URL in .env eintragen, dann erneut versuchen.')
if (!PUBLIC_URL.startsWith('https://')) abbruch(`PUBLIC_URL muss mit https:// beginnen, ist aber «${PUBLIC_URL}». Vapi erreicht http-Adressen nicht.`)

async function vapi<T>(method: string, pfad: string, payload?: unknown): Promise<T> {
  const r = await fetch(`https://api.vapi.ai${pfad}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  })
  const text = await r.text()
  if (!r.ok) abbruch(`Vapi ${method} ${pfad} → ${r.status}\n${text.slice(0, 800)}`)
  return (text ? JSON.parse(text) : {}) as T
}

// Kein echtes Sprachmodell: model.url zeigt auf unseren eigenen Endpunkt, der leer antwortet.
// Dadurch schweigt der Assistent und es fallen keine LLM-Kosten an.
const assistent = {
  name: 'URO Mithörer',
  firstMessage: GREETING,
  firstMessageMode: GREETING ? 'assistant-speaks-first' : 'assistant-waits-for-user',
  transcriber: { provider: 'deepgram', model: 'nova-2', language: LANGUAGE },
  model: { provider: 'custom-llm', url: `${PUBLIC_URL}/llm`, model: 'leer' },
  server: { url: `${PUBLIC_URL}/vapi` },
  serverMessages: ['transcript', 'status-update'],
  // Der Assistent sagt nichts, also darf ihn Stille nicht auflegen lassen.
  silenceTimeoutSeconds: 600,
  maxDurationSeconds: 1800,
  backgroundSound: 'off',
}

type Nummer = { id: string; number?: string; name?: string; assistantId?: string }
type Assistent = { id: string }

const gemerkt = (() => {
  try { return JSON.parse(readFileSync(STATE, 'utf8')) as { assistantId?: string } }
  catch { return {} }
})()

// Bestehenden Assistenten aktualisieren statt bei jedem Lauf einen neuen anzulegen.
let assistantId = gemerkt.assistantId
if (assistantId) {
  const r = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, { headers: { Authorization: `Bearer ${KEY}` } })
  if (!r.ok) {
    console.log(`Gemerkter Assistent ${assistantId} existiert nicht mehr, lege einen neuen an.`)
    assistantId = undefined
  }
}

if (assistantId) {
  await vapi('PATCH', `/assistant/${assistantId}`, assistent)
  console.log(`Assistent aktualisiert: ${assistantId}`)
} else {
  const neu = await vapi<Assistent>('POST', '/assistant', assistent)
  assistantId = neu.id
  writeFileSync(STATE, `${JSON.stringify({ assistantId }, null, 2)}\n`)
  console.log(`Assistent angelegt: ${assistantId}`)
}

let nummern = await vapi<Nummer[]>('GET', '/phone-number')

// Noch keine Nummer im Konto: eine gratis Vapi-Nummer beanspruchen. Die Vorwahl muss frei sein –
// ist sie es nicht, nennt Vapi in der Fehlermeldung verfügbare Alternativen.
if (!nummern.length) {
  const vorwahl = (process.env.VAPI_AREA_CODE ?? '858').trim()
  console.log(`Keine Nummer im Konto. Beanspruche eine gratis Vapi-Nummer mit Vorwahl ${vorwahl} …`)
  const r = await fetch('https://api.vapi.ai/phone-number', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'vapi', numberDesiredAreaCode: vorwahl, name: 'URO Beraterlinie' }),
  })
  const text = await r.text()
  if (!r.ok) abbruch(`Nummer konnte nicht beansprucht werden (${r.status}):\n${text.slice(0, 500)}\n\nAndere Vorwahl versuchen: VAPI_AREA_CODE=<vorwahl> npm run setup`)
  nummern = [JSON.parse(text) as Nummer]
  console.log(`Nummer beansprucht: ${nummern[0].number}`)
}

// Ohne Auswahl die erste Nummer nehmen; bei mehreren entscheidet VAPI_PHONE_NUMBER.
const gewuenscht = (process.env.VAPI_PHONE_NUMBER ?? '').trim()
const nummer = gewuenscht ? nummern.find((n) => n.number === gewuenscht) : nummern[0]
if (!nummer) abbruch(`Nummer ${gewuenscht} nicht im Konto. Vorhanden: ${nummern.map((n) => n.number).join(', ')}`)

await vapi('PATCH', `/phone-number/${nummer.id}`, { assistantId })

console.log(`Nummer verbunden:  ${nummer.number}`)
console.log(`Webhook:           ${PUBLIC_URL}/vapi`)
console.log(`Sprachmodell:      ${PUBLIC_URL}/llm  (antwortet leer, der Assistent schweigt)`)
console.log(`Erkennung:         Deepgram nova-2, Sprache ${LANGUAGE}`)
console.log(`\n☎ Jetzt anrufen: ${nummer.number}`)
