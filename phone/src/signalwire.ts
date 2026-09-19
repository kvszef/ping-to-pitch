// Richtet die SignalWire-Seite der Brücke ein: Nummer beschaffen und den Voice-Webhook setzen.
// SignalWires Compatibility-API spricht dasselbe Protokoll wie Twilio, nur unter eigener
// Basis-URL – deshalb trägt derselbe cXML-Antwortbaustein beide Anbieter.
//   npm run signalwire

const SPACE = (process.env.SIGNALWIRE_SPACE ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
const PROJEKT = (process.env.SIGNALWIRE_PROJECT_ID ?? '').trim()
const TOKEN = (process.env.SIGNALWIRE_API_TOKEN ?? '').trim()
const PUBLIC_URL = (process.env.BRIDGE_PUBLIC_URL ?? '').trim().replace(/\/+$/, '')
const LAND = (process.env.SIGNALWIRE_NUMBER_COUNTRY ?? 'US').trim().toUpperCase()

const abbruch = (text: string): never => { console.error(`\n${text}\n`); process.exit(1) }

if (!SPACE) abbruch('SIGNALWIRE_SPACE fehlt in .env, z. B. meinname.signalwire.com (steht in der Adresszeile nach dem Login).')
if (!PROJEKT) abbruch('SIGNALWIRE_PROJECT_ID fehlt in .env. Im Dashboard unter API zu finden.')
if (!TOKEN) abbruch('SIGNALWIRE_API_TOKEN fehlt in .env. Im Dashboard unter API einen Token erstellen.')
if (!PUBLIC_URL.startsWith('https://')) abbruch('BRIDGE_PUBLIC_URL fehlt oder ist kein https. Erst `cloudflared tunnel --url http://localhost:3200` starten.')

const basis = `https://${SPACE}/api/laml/2010-04-01/Accounts/${PROJEKT}`
const kopf = { Authorization: `Basic ${Buffer.from(`${PROJEKT}:${TOKEN}`).toString('base64')}` }

async function sw<T>(method: 'GET' | 'POST', pfad: string, felder?: Record<string, string>): Promise<T> {
  const r = await fetch(`${basis}${pfad}`, {
    method,
    headers: { ...kopf, ...(felder ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(felder ? { body: new URLSearchParams(felder).toString() } : {}),
  })
  const text = await r.text()
  if (!r.ok) {
    const hinweis = r.status === 401 ? '\n\nZugangsdaten stimmen nicht. Project ID und API Token im Dashboard unter API prüfen.'
      : r.status === 404 ? '\n\nPfad nicht gefunden. Stimmt SIGNALWIRE_SPACE? Erwartet wird die nackte Domain, z. B. meinname.signalwire.com'
      : ''
    abbruch(`SignalWire ${method} ${pfad} → ${r.status}\n${text.slice(0, 600)}${hinweis}`)
  }
  return JSON.parse(text) as T
}

type Nummer = { sid: string; phone_number: string; voice_url?: string }
type Frei = { phone_number: string; locality?: string; region?: string }

const answerUrl = `${PUBLIC_URL}/answer`

const vorhanden = await sw<{ incoming_phone_numbers: Nummer[] }>('GET', '/IncomingPhoneNumbers.json?PageSize=20')
let nummer = vorhanden.incoming_phone_numbers[0]

if (!nummer) {
  console.log(`Keine Nummer im Konto. Suche eine freie ${LAND}-Nummer mit Sprachfunktion …`)
  const frei = await sw<{ available_phone_numbers: Frei[] }>('GET', `/AvailablePhoneNumbers/${LAND}/Local.json?VoiceEnabled=true&PageSize=5`)
  if (!frei.available_phone_numbers.length) {
    abbruch(`Keine freien ${LAND}-Nummern gefunden. Anderes Land versuchen: SIGNALWIRE_NUMBER_COUNTRY=GB npm run signalwire`)
  }
  const gewaehlt = frei.available_phone_numbers[0]
  console.log(`Kaufe ${gewaehlt.phone_number} (${gewaehlt.locality ?? gewaehlt.region ?? LAND}) …`)
  nummer = await sw<Nummer>('POST', '/IncomingPhoneNumbers.json', {
    PhoneNumber: gewaehlt.phone_number,
    FriendlyName: 'URO Beraterbruecke',
    VoiceUrl: answerUrl,
    VoiceMethod: 'POST',
  })
} else if (nummer.voice_url !== answerUrl) {
  await sw<Nummer>('POST', `/IncomingPhoneNumbers/${nummer.sid}.json`, { VoiceUrl: answerUrl, VoiceMethod: 'POST' })
  console.log('Webhook der bestehenden Nummer aktualisiert.')
} else {
  console.log('Nummer und Webhook waren bereits richtig gesetzt.')
}

console.log(`\nNummer:      ${nummer.phone_number}`)
console.log(`Answer-URL:  ${answerUrl}`)
console.log(`\n☎ Diese Nummer anrufen: ${nummer.phone_number}`)
