// Demo calls for the live presentation: real clients from clients.json, the conversation scripted.
// Inbound calls come from an unknown number: the caller says their name, the transcript picks it up.
// Every figure the speakers use is taken from that client's data (engine findings as of the case
// data); nothing else is invented. The script plays through the same path as live transcription.

export type DemoLine = { speaker: 'Kunde' | 'Berater'; text: string }
export type DemoCall = { id: string; direction: 'eingehend' | 'ausgehend'; ref: string; label: string; script: DemoLine[] }

export const demoCalls: DemoCall[] = [
  {
    id: 'ein-1', direction: 'eingehend', ref: 'CASE-017', label: 'Wertrückgang im Juli',
    script: [
      { speaker: 'Kunde', text: 'Guten Tag, hier ist Hulk. Ich habe den Auszug gesehen, mein Depot hat im letzten Monat deutlich verloren. Muss ich mir Sorgen machen?' },
      { speaker: 'Berater', text: 'Guten Tag. Es waren minus 5.6 Prozent. Vergleichbare Kunden lagen im Median bei minus 3.9 Prozent, das war also grösstenteils der ganze Markt.' },
      { speaker: 'Kunde', text: 'Und warum hat es mich stärker getroffen als die anderen?' },
      { speaker: 'Berater', text: 'Ihr Aktienanteil ist mit 72.6 Prozent recht hoch. Über zwölf Monate liegen Sie aber immer noch bei plus 24.2 Prozent.' },
      { speaker: 'Kunde', text: 'Damals 2022 war es ja auch schlimm. Wie lange hat das gedauert?' },
      { speaker: 'Berater', text: 'Damals ging es um 29.1 Prozent zurück. Nach 14 Monaten waren Sie wieder auf dem alten Höchststand.' },
      { speaker: 'Kunde', text: 'Sie hatten mir im August einen neuen Vorschlag geschickt, den Wechsel der Anlagestrategie. Was ist damit?' },
      { speaker: 'Berater', text: 'Der Entwurf vom 08.08.2026 enthält dieselben Titel wie der Vorschlag vom Mai, den Sie abgelehnt haben. Ich würde ihn überarbeiten.' },
      { speaker: 'Kunde', text: 'Ja bitte. Und keine direkten Positionen in fossilen Energien, das hatte ich schon gesagt.' },
      { speaker: 'Berater', text: 'Richtig, aktuell halten Sie davon noch 0.9 Prozent direkt. Das nehme ich in den neuen Vorschlag auf.' },
      { speaker: 'Kunde', text: 'Gut. Schicken Sie mir das bitte schriftlich.' },
      { speaker: 'Berater', text: 'Mache ich. Sie erhalten den überarbeiteten Vorschlag bis Ende Woche.' },
    ],
  },
  {
    id: 'ein-2', direction: 'eingehend', ref: 'CASE-012', label: 'Liquidität für die Steuerzahlung',
    script: [
      { speaker: 'Kunde', text: 'Grüezi, hier die Buchhaltung der Company 001 AG. Die Steuerzahlung ist bis zum 20. September fällig. Sind die 15\'000 Franken verfügbar?' },
      { speaker: 'Berater', text: 'Aktuell liegen auf den Konten nur CHF 328. Es fehlen CHF 14\'672.' },
      { speaker: 'Kunde', text: 'Das ist knapp. Was schlagen Sie vor?' },
      { speaker: 'Berater', text: 'Zwei Optionen: einen Teil von Apple verkaufen, mit 17.8 Prozent über der Klumpengrenze, oder einen Teil von Alphabet mit 25.5 Prozent.' },
      { speaker: 'Kunde', text: 'Warum gerade diese beiden?' },
      { speaker: 'Berater', text: 'Beide sind Klumpenrisiken, und der USD-Anteil liegt bei 75.3 Prozent. Die Grenze der Bank ist 35.5 Prozent. Ein Verkauf senkt beides.' },
      { speaker: 'Kunde', text: 'Und wie steht es mit dem Risiko insgesamt?' },
      { speaker: 'Berater', text: 'Die Volatilität liegt bei 18.4 Prozent. Ihr Profil erlaubt maximal 15.0 Prozent.' },
      { speaker: 'Kunde', text: 'Nehmen wir Apple. Aber nur so viel wie nötig.' },
      { speaker: 'Berater', text: 'Einverstanden. Ich bereite den Verkauf für rund CHF 15\'000 vor und schicke Ihnen heute noch die Bestätigung.' },
    ],
  },
]

// Reading pace for the script: a line appears after roughly the time it takes to say the previous one.
export const lineDelay = (line: DemoLine) => 1800 + line.text.split(/\s+/).length * 330
