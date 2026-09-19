// Richtet die Twilio-Seite der Brücke ein: Nummer beschaffen und den Voice-Webhook setzen.
// Nach jedem neuen Tunnel erneut ausführen – die Answer-URL steht bei der Nummer und
// ändert sich mit dem Tunnel.
//   npm run twilio

const SID = (process.env.TWILIO_ACCOUNT_SID ?? '').trim()
const TOKEN = (process.env.TWILIO_AUTH_TOKEN ?? '').trim()
const PUBLIC_URL = (process.env.BRIDGE_PUBLIC_URL ?? '').trim().replace(/\/+$/, '')
const LAND = (process.env.TWILIO_NUMBER_COUNTRY ?? 'US').trim().toUpperCase()

const abbruch = (text: string): never => { console.error(`\n${text}\n`); process.exit(1) }

if (!SID) abbruch('TWILIO_ACCOUNT_SID fehlt in .env. Steht im Twilio-Dashboard auf der Startseite.')
if (!TOKEN) abbruch('TWILIO_AUTH_TOKEN fehlt in .env. Im Dashboard neben der Account SID, Auge-Symbol zum Anzeigen.')
if (!PUBLIC_URL.startsWith('https://')) abbruch('BRIDGE_PUBLIC_URL fehlt oder ist kein https. Erst `cloudflared tunnel --url http://localhost:3200` starten.')

const basis = `https://api.twilio.com/2010-04-01/Accounts/${SID}`
const kopf = { Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}` }

async function twilio<T>(method: 'GET' | 'POST', pfad: string, felder?: Record<string, string>): Promise<T> {
  const r = await fetch(`${basis}${pfad}`, {
    method,
    headers: { ...kopf, ...(felder ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(felder ? { body: new URLSearchParams(felder).toString() } : {}),
  })
  const text = await r.text()
  if (!r.ok) {
    const hinweis = r.status === 401 ? '\n\nDie Zugangsdaten stimmen nicht. Account SID und Auth Token aus dem Dashboard prüfen.' : ''
    abbruch(`Twilio ${method} ${pfad} → ${r.status}\n${text.slice(0, 600)}${hinweis}`)
  }
  return JSON.parse(text) as T
}

type Nummer = { sid: string; phone_number: string; voice_url?: string }
type Frei = { phone_number: string; locality?: string; region?: string }
type CallerIds = { outgoing_caller_ids: { phone_number: string }[] }

const answerUrl = `${PUBLIC_URL}/answer`
const berater = (process.env.ADVISOR_NUMBER ?? '').trim()
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms))
const verifizierte = async () =>
  (await twilio<CallerIds>('GET', '/OutgoingCallerIds.json?PageSize=20')).outgoing_caller_ids.map((v) => v.phone_number)

// Im Trial verlangt Twilio eine verifizierte Nummer, bevor überhaupt eine Nummer gekauft
// werden darf – und ausgehende Beine gehen ohnehin nur auf verifizierte Nummern.
let verifiziert = await verifizierte()
if (!verifiziert.includes(berater)) {
  if (!berater) abbruch('ADVISOR_NUMBER fehlt in .env. Dein Handy in E.164 eintragen, z. B. +41791234567 – Twilio muss es verifizieren, bevor es eine Nummer verkauft.')
  console.log(`${berater} ist noch nicht verifiziert. Versuche es über die API …`)

  const r = await fetch(`${basis}/OutgoingCallerIds.json`, {
    method: 'POST',
    headers: { ...kopf, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ PhoneNumber: berater, FriendlyName: 'Berater' }).toString(),
  })
  const antwort = await r.text()

  if (r.ok) {
    const code = (JSON.parse(antwort) as { validation_code: string }).validation_code
    console.log(`\n  ☎ Twilio ruft ${berater} an. Abheben und diesen Code eintippen:\n\n        ${code}\n`)
  } else {
    // Fehler 10002: Trial-Konten dürfen den Verifizierungsanruf nicht über die API auslösen.
    // Die Konsole benutzt einen anderen Weg und lässt es zu.
    const blockiert = antwort.includes('10002')
    if (!blockiert) abbruch(`Verifizierung fehlgeschlagen (${r.status}):\n${antwort.slice(0, 500)}`)
    console.log(`\n  Twilio erlaubt den Verifizierungsanruf im Trial nicht über die API.`)
    console.log(`  Einmalig in der Konsole erledigen – das Skript wartet so lange:\n`)
    console.log(`    https://console.twilio.com/us1/develop/phone-numbers/manage/verified`)
    console.log(`    → «Add a new Caller ID» → ${berater} → Code eintippen\n`)
  }

  for (let i = 0; i < 60; i++) {
    await warte(3000)
    verifiziert = await verifizierte()
    if (verifiziert.includes(berater)) break
    if (i % 10 === 9) console.log(`  … warte auf die Bestätigung (${(i + 1) * 3}s)`)
  }
  if (!verifiziert.includes(berater)) abbruch('Die Verifizierung kam nicht durch. Nach dem Eintragen in der Konsole einfach `npm run twilio` erneut ausführen.')
  console.log(`✓ ${berater} ist verifiziert.`)
}

const vorhanden = await twilio<{ incoming_phone_numbers: Nummer[] }>('GET', '/IncomingPhoneNumbers.json?PageSize=20')
let nummer = vorhanden.incoming_phone_numbers[0]

if (!nummer) {
  console.log(`Keine Nummer im Konto. Suche eine freie ${LAND}-Nummer mit Sprachfunktion …`)
  const frei = await twilio<{ available_phone_numbers: Frei[] }>('GET', `/AvailablePhoneNumbers/${LAND}/Local.json?VoiceEnabled=true&PageSize=5`)
  if (!frei.available_phone_numbers.length) {
    abbruch(`Keine freien ${LAND}-Nummern mit Sprachfunktion gefunden. Anderes Land versuchen: TWILIO_NUMBER_COUNTRY=GB npm run twilio`)
  }
  const gewaehlt = frei.available_phone_numbers[0]
  console.log(`Kaufe ${gewaehlt.phone_number} (${gewaehlt.locality ?? gewaehlt.region ?? LAND}) …`)
  nummer = await twilio<Nummer>('POST', '/IncomingPhoneNumbers.json', {
    PhoneNumber: gewaehlt.phone_number,
    FriendlyName: 'URO Beraterbruecke',
    VoiceUrl: answerUrl,
    VoiceMethod: 'POST',
  })
} else if (nummer.voice_url !== answerUrl) {
  await twilio<Nummer>('POST', `/IncomingPhoneNumbers/${nummer.sid}.json`, { VoiceUrl: answerUrl, VoiceMethod: 'POST' })
  console.log('Webhook der bestehenden Nummer aktualisiert.')
} else {
  console.log('Nummer und Webhook waren bereits richtig gesetzt.')
}

console.log(`\nNummer:      ${nummer.phone_number}`)
console.log(`Answer-URL:  ${answerUrl}`)
console.log(`Berater:     ${berater} (verifiziert)`)
console.log(`\n☎ Diese Nummer anrufen: ${nummer.phone_number}`)
