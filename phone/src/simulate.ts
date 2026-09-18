// Schickt echte Vapi-Webhook-Nutzlasten gegen den laufenden Dienst, ohne Telefon und ohne Guthaben.
// Damit lässt sich die ganze Kette Webhook → SSE → Anzeige prüfen, bevor ein Anruf Geld kostet.
//   npm run dev        (im ersten Terminal)
//   npm run simulate   (im zweiten)

const PORT = Number(process.env.PORT || 3100)
const URL = `http://localhost:${PORT}/vapi`

// Beide sprechen in dasselbe Handy, deshalb kommt in Wirklichkeit alles als role "user" an –
// genau so simuliert. Die Rollen Kunde/Berater trennt später das Modell in /api/analyse.
const gespraech = [
  'Guten Tag, ich habe gesehen, dass mein Depot diesen Monat ziemlich verloren hat. Was ist da los?',
  'Guten Tag. Der Rückgang kommt aus dem Technologiesektor, das betrifft im Moment den ganzen Markt.',
  'Und der Dollar fällt ja auch noch. Trifft mich das zusätzlich?',
  'Ja, Ihr Dollar-Anteil ist höher als vereinbart. Eine Absicherung in Franken würde das auffangen.',
  'Ich hatte ausserdem einmal nach nachhaltigen Anlagen gefragt.',
  'Genau, dazu habe ich zwei nachhaltige Fonds für Sie vorbereitet.',
]

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function post(message: unknown) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
}

// Vapi schickt eine Äusserung als wachsende Bruchstücke und zum Schluss einmal final.
async function sprich(text: string) {
  const woerter = text.split(' ')
  const schritte = [Math.ceil(woerter.length / 3), Math.ceil((woerter.length * 2) / 3)]
  for (const bis of schritte) {
    await post({ type: 'transcript', role: 'user', transcriptType: 'partial', transcript: woerter.slice(0, bis).join(' ') })
    await warte(450)
  }
  await post({ type: 'transcript', role: 'user', transcriptType: 'final', transcript: text })
  await warte(900)
}

try {
  await post({ type: 'status-update', status: 'in-progress', call: { customer: { number: '+41791234567' } } })
  await warte(600)
  for (const satz of gespraech) await sprich(satz)
  await post({ type: 'status-update', status: 'ended', endedReason: 'customer-ended-call' })
  console.log('Simuliertes Gespräch durchgelaufen. Ergebnis im Browser prüfen.')
} catch (e) {
  console.error(`Fehlgeschlagen: ${e instanceof Error ? e.message : e}`)
  console.error(`Läuft der Dienst? Erwartet unter ${URL} – mit \`npm run dev\` starten.`)
  process.exit(1)
}
