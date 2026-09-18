// Sucht (und kauft optional) eine Nummer bei Twilio.
//   npm run numbers                                   → verfügbare Schweizer Lokalnummern anzeigen
//   npm run numbers -- --area-code 71                 → nur Vorwahl 071 (St. Gallen)
//   npm run numbers -- --country US                   → sofort verfügbare US-Nummer (kein Bundle nötig)
//   npm run numbers -- --bundles                      → eigene Regulatory Bundles und Adressen (SIDs für .env)
//   npm run numbers -- --buy [--number +41715000000]  → kauft die angegebene bzw. erste gefundene Nummer
import { parseArgs } from 'node:util'
import { config } from '../src/config.ts'
import { twilioClient } from './twilio-client.ts'

const { values } = parseArgs({
  options: {
    country: { type: 'string', default: 'CH' },
    type: { type: 'string', default: 'local' },
    'area-code': { type: 'string' },
    contains: { type: 'string' },
    limit: { type: 'string', default: '10' },
    buy: { type: 'boolean', default: false },
    number: { type: 'string' },
    bundles: { type: 'boolean', default: false },
  },
})

const client = twilioClient()
const country = (values.country ?? 'CH').toUpperCase()

if (values.bundles) {
  const bundles = await client.numbers.v2.regulatoryCompliance.bundles.list({ isoCountry: country, limit: 50 })
  console.log(`Regulatory Bundles (${country}):`)
  if (!bundles.length) console.log('  keine – im Twilio-Console unter Phone Numbers → Regulatory Compliance → Bundles anlegen')
  for (const b of bundles) console.log(`  ${b.sid}  ${String(b.status).padEnd(18)} ${b.friendlyName}${b.regulationSid ? `  (Regulation ${b.regulationSid})` : ''}`)
  const addresses = await client.addresses.list({ limit: 50 })
  console.log('Adressen:')
  if (!addresses.length) console.log('  keine – im Twilio-Console unter Phone Numbers → Regulatory Compliance → Addresses anlegen')
  for (const a of addresses) console.log(`  ${a.sid}  ${a.isoCountry}  ${a.customerName}, ${a.street}, ${a.postalCode} ${a.city}${a.validated ? '  (validiert)' : ''}`)
  process.exit(0)
}

const type = values.type ?? 'local'
const searchOptions = {
  voiceEnabled: true,
  limit: Number(values.limit),
  ...(values['area-code'] ? { areaCode: Number(values['area-code']) } : {}),
  ...(values.contains ? { contains: values.contains } : {}),
}
const numbers = client.availablePhoneNumbers(country)
const available =
  type === 'local' ? await numbers.local.list(searchOptions)
  : type === 'mobile' ? await numbers.mobile.list(searchOptions)
  : type === 'tollFree' ? await numbers.tollFree.list(searchOptions)
  : undefined
if (!available) { console.error(`Unbekannter Typ ${type}; erlaubt: local, mobile, tollFree`); process.exit(1) }
if (!available.length) {
  console.log(`Keine ${type}-Nummern mit Sprachfunktion in ${country} gefunden. Für die Schweiz braucht der Kauf ein genehmigtes Regulatory Bundle (siehe README).`)
  process.exit(values.buy ? 1 : 0)
}
console.log(`Verfügbare ${type}-Nummern in ${country}:`)
for (const n of available) {
  const caps = [n.capabilities?.voice ? 'voice' : '', n.capabilities?.sms ? 'sms' : ''].filter(Boolean).join('+')
  console.log(`  ${n.phoneNumber}  ${(n.locality ?? n.region ?? '').padEnd(20)} ${caps}`)
}

if (!values.buy) { console.log('\nKaufen mit:  npm run numbers -- --buy --number <Nummer>'); process.exit(0) }

const phoneNumber = values.number ?? available[0].phoneNumber
const needsBundle = country === 'CH'
if (needsBundle && (!config.twilio.bundleSid || !config.twilio.addressSid)) {
  console.error('Für eine Schweizer Nummer müssen TWILIO_BUNDLE_SID (genehmigtes Bundle) und TWILIO_ADDRESS_SID in .env stehen. SIDs anzeigen: npm run numbers -- --bundles')
  process.exit(1)
}
const bought = await client.incomingPhoneNumbers.create({
  phoneNumber,
  friendlyName: 'PhoneAgent',
  voiceMethod: 'POST',
  ...(config.publicUrl ? { voiceUrl: `${config.publicUrl}/twiml` } : {}),
  ...(config.twilio.bundleSid ? { bundleSid: config.twilio.bundleSid } : {}),
  ...(config.twilio.addressSid ? { addressSid: config.twilio.addressSid } : {}),
})
console.log(`\nGekauft: ${bought.phoneNumber} (SID ${bought.sid})`)
console.log(`Jetzt in .env eintragen:  TWILIO_PHONE_NUMBER=${bought.phoneNumber}`)
if (!config.publicUrl) console.log('Danach `npm run up` starten; das setzt den Webhook automatisch.')
