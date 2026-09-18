import type { Card, Client, IncomingCall, Signal } from '../types'

// BEISPIELDATEN — gleiche Form, wie sie die Analyse- und LLM-Schicht später liefert.

const allocation = (rows: [string, number, number, number, number][]): Card => ({
  type: 'allocation',
  title: 'Allokation gegenüber Mandat',
  rows: rows.map(([label, min, target, max, actual]) => ({ label, min, target, max, actual })),
})

export const clients: Client[] = [
  {
    ref: 'CASE-A',
    name: 'Kunde A',
    clientType: 'Natürliche Person',
    profile: 'Dynamisch',
    portfolioNr: '15.02996',
    service: 'Anlageberatung Portfolio',
    strategy: 'Wachstum',
    aum: "CHF 1'240'000.00",
    context: 'Kurzfristiger Anruf',
    birthday: '14.08.1988',
    lastProfiling: '08.05.2026',
    lastConsultation: '19.08.2026',
    errors: 1,
    warnings: 1,
    briefing: [
      { type: 'headline', text: 'Das Portfolio hat diesen Monat 4.2% verloren – getrieben von US-Technologie, und der Rückgang betrifft den ganzen Markt.', sub: 'Mit dem Technologie-Rückgang beginnen, dann das USD-Übergewicht ansprechen. Der Kunde hat nach nachhaltigen Anlagen gefragt.' },
      { type: 'metrics', items: [
        { label: 'Laufender Monat', value: '-4.2%', tone: 'risk' },
        { label: 'Seit Jahresbeginn', value: '+6.1%', tone: 'ok' },
        { label: 'Aktienquote', value: '88%', delta: 'Soll 85%' },
        { label: 'USD-Anteil', value: '61%', delta: '+11 Pkt. über Band', tone: 'risk' },
      ] },
      { type: 'split', title: 'Was ist passiert', left: { title: 'Portfolio', points: [
        { text: 'US-Technologie macht 34% des Portfolios aus, verteilt auf 5 Positionen.', kind: 'fact', source: 'Positionen' },
        { text: 'Die 3 grössten Verlustbringer sind alle US-Technologie und erklären 3.1 der 4.2 Prozentpunkte.', kind: 'fact', source: 'Performancebeitrag' },
        { text: 'Der Rückgang ist eine Folge der Konzentration, nicht einzelner Titel.', kind: 'interpretation' },
      ] }, right: { title: 'Markt', points: [
        { text: 'Die Volatilität im Technologiesektor ist diesen Monat in allen grossen Indizes stark gestiegen.', kind: 'fact', source: 'Marktnachrichten (Beispiel)' },
        { text: 'Hausmeinung: US-Technologie neutral, Qualitätsaktien übergewichten.', kind: 'fact', source: 'CIO-Sicht (Beispiel)' },
        { text: 'Die Bewegung ist global, vergleichbare Portfolios sind ähnlich betroffen.', kind: 'interpretation' },
      ] } },
      allocation([['Liqu. / Geldmarkt', 0, 5, 15, 3], ['Obligationen', 0, 10, 20, 6], ['Aktien', 65, 85, 95, 88], ['Immobilien', 0, 0, 10, 0], ['Übrige Anlagen', 0, 0, 10, 3]]),
      { type: 'flags', title: 'Handlungsbedarf', items: [
        { severity: 'risk', text: 'USD-Anteil liegt 11 Prozentpunkte über dem Mandatsband.', source: 'SAA-Währungsband' },
        { severity: 'warn', text: 'Klumpenrisiko: ein Einzeltitel über 10%.', source: 'Suitability-Regel' },
        { severity: 'info', text: 'Kunde hat Interesse an nachhaltigen Anlagen geäussert.', source: 'Kundennotiz' },
      ] },
      { type: 'actions', title: 'Nächste beste Schritte', items: [
        { text: 'CHF-Absicherung auf dem USD-Aktienanteil vorschlagen.', why: 'Bringt den Währungsanteil ohne Verkäufe zurück ins Band.' },
        { text: 'Grösste Technologieposition auf rund 8% reduzieren.', why: 'Behebt die Verletzung der Klumpenrisiko-Regel.' },
        { text: 'Zwei nachhaltige globale Aktienfonds aus der Empfehlungsliste vorstellen.', why: 'Greift das geäusserte Interesse auf.' },
      ] },
      { type: 'questions', title: 'Wahrscheinliche Fragen', items: [
        { q: 'Soll ich meine Technologieaktien verkaufen?', a: 'Der Rückgang betrifft den ganzen Sektor und liegt innerhalb des Mandats. Reduzieren nur dort, wo Klumpenlimiten verletzt sind.' },
        { q: 'Ist mein Portfolio nachhaltig?', a: 'Teilweise – ESG-Aufteilung zeigen und die zwei Fondsalternativen vorstellen.' },
      ] },
    ],
  },
  {
    ref: 'CASE-B',
    name: 'Kunde B',
    clientType: 'Natürliche Person',
    profile: 'Ausgeglichen',
    portfolioNr: '42.249999',
    service: 'Anlageberatung Portfolio',
    strategy: 'Ausgewogen',
    aum: "CHF 680'000.00",
    context: 'Quartalsgespräch',
    birthday: '22.02.1976',
    lastProfiling: '25.08.2026',
    lastConsultation: '10.09.2026',
    errors: 0,
    warnings: 1,
    briefing: [
      { type: 'headline', text: 'Im letzten Quartal 1.4 Prozentpunkte hinter der Zielallokation – Hauptursache ist das Untergewicht in europäischen Aktien.', sub: 'Die Hausmeinung ist für Europa neu positiv: Das ergibt eine klare Erklärung und eine klare Lösung.' },
      { type: 'metrics', items: [
        { label: 'Laufendes Quartal', value: '+0.6%', delta: 'Zielallokation +2.0%', tone: 'warn' },
        { label: 'Aktienquote', value: '44%', delta: 'Soll 45%' },
        { label: 'Aktien Europa', value: '6%', delta: '-7 Pkt. unter Soll', tone: 'warn' },
        { label: 'Liquidität', value: '9%' },
      ] },
      { type: 'split', title: 'Was ist passiert', left: { title: 'Portfolio', points: [
        { text: 'Europäische Aktien liegen 7 Prozentpunkte unter dem SAA-Sollwert.', kind: 'fact', source: 'SAA-Länderband' },
        { text: 'Die Liquidität von 9% hat in einem steigenden Markt Rendite gekostet.', kind: 'fact', source: 'Positionen' },
      ] }, right: { title: 'Markt', points: [
        { text: 'Der CIO hat einen positiven Ausblick für europäische Aktien publiziert.', kind: 'fact', source: 'CIO-Sicht (Beispiel)' },
        { text: 'Der Rückstand kommt aus der Allokation und lässt sich innerhalb des Mandats beheben.', kind: 'interpretation' },
      ] } },
      allocation([['Liqu. / Geldmarkt', 0, 5, 15, 9], ['Obligationen', 35, 45, 55, 42], ['Aktien', 35, 45, 55, 44], ['Immobilien', 0, 2.5, 10, 3], ['Übrige Anlagen', 0, 2.5, 10, 2]]),
      { type: 'flags', title: 'Handlungsbedarf', items: [
        { severity: 'warn', text: 'Untergewicht in der Aktienregion «Übriges Europa».', source: 'Suitability-Regel' },
        { severity: 'info', text: 'Hat sich früher nach nachhaltigen Anlagemöglichkeiten erkundigt.', source: 'Kundennotiz' },
      ] },
      { type: 'actions', title: 'Nächste beste Schritte', items: [
        { text: '5 Prozentpunkte Liquidität in einen europäischen Aktienfonds investieren.', why: 'Schliesst den grössten Teil des Untergewichts und entspricht der Hausmeinung.' },
        { text: 'Eine nachhaltige Variante für europäische Aktien anbieten.', why: 'Verbindet die Umschichtung mit dem geäusserten Interesse.' },
        { text: 'Nach dem Gespräch den Vergleich zur Zielallokation zustellen.', why: 'Beantwortet die Performancefrage schriftlich.' },
      ] },
      { type: 'questions', title: 'Wahrscheinliche Fragen', items: [
        { q: 'Warum liege ich zurück?', a: 'Allokation, nicht Titelauswahl: zu wenig Europa, zu viel Liquidität.' },
      ] },
    ],
  },
  {
    ref: 'CASE-C',
    name: 'Kunde C',
    clientType: 'Natürliche Person',
    profile: 'Konservativ',
    portfolioNr: '27.131004',
    service: 'Anlageberatung Portfolio',
    strategy: 'Einkommen',
    aum: "CHF 420'000.00",
    context: 'Jahresgespräch',
    birthday: '03.06.1954',
    lastProfiling: '23.06.2026',
    lastConsultation: '03.07.2026',
    errors: 1,
    warnings: 1,
    briefing: [
      { type: 'headline', text: 'Ein Obligationenfonds verletzt die Suitability, und der Kunde braucht innert 12 Monaten Liquidität für einen Immobilienkauf.', sub: 'Beides weist in dieselbe Richtung: Risiko reduzieren und Liquidität aufbauen.' },
      { type: 'metrics', items: [
        { label: 'Seit Jahresbeginn', value: '+1.9%', tone: 'ok' },
        { label: 'Volatilität', value: '4.1%', delta: 'Maximum 5.5%' },
        { label: 'Liquidität', value: '6%', tone: 'warn' },
        { label: 'Beanstandet', value: '1 Pos.', tone: 'risk' },
      ] },
      { type: 'split', title: 'Was ist passiert', left: { title: 'Portfolio', points: [
        { text: 'Ein Obligationenfonds (12% Gewicht) hat eine Produktrisikoklasse über dem Maximum des Profils.', kind: 'fact', source: 'Regelverletzung' },
        { text: 'Die Liquidität beträgt 6% des Vermögens.', kind: 'fact', source: 'Konten' },
      ] }, right: { title: 'Kunde', points: [
        { text: 'Plant einen Immobilienkauf, Liquiditätsbedarf innert 12 Monaten.', kind: 'fact', source: 'Kundennotiz' },
        { text: 'Die heutige Liquidität reicht für eine Anzahlung nicht aus.', kind: 'interpretation' },
      ] } },
      allocation([['Liqu. / Geldmarkt', 0, 10, 25, 6], ['Obligationen', 50, 65, 80, 71], ['Aktien', 5, 15, 25, 14], ['Immobilien', 0, 5, 15, 6], ['Übrige Anlagen', 0, 5, 10, 3]]),
      { type: 'flags', title: 'Handlungsbedarf', items: [
        { severity: 'risk', text: 'Produktrisikoklasse übersteigt das Maximum des Kunden.', source: 'Suitability-Regel' },
        { severity: 'warn', text: 'Der Liquiditätsbedarf ist in der Allokation nicht abgebildet.', source: 'Kundennotiz + Konten' },
      ] },
      { type: 'actions', title: 'Nächste beste Schritte', items: [
        { text: 'Den beanstandeten Obligationenfonds verkaufen.', why: 'Behebt die Regelverletzung.' },
        { text: 'Den Erlös bis zum Kauf im Geldmarkt parkieren.', why: 'Passt zum Horizont von 12 Monaten und erhält das Kapital.' },
        { text: 'Betrag und Zeitpunkt des Immobilienkaufs klären.', why: 'Bestimmt die richtige Höhe der Liquiditätsreserve.' },
      ] },
      { type: 'questions', title: 'Wahrscheinliche Fragen', items: [
        { q: 'Ist mein Geld für den Kauf sicher?', a: 'Noch nicht vollständig – der Plan oben reserviert es dafür.' },
      ] },
    ],
  },
]

export const signals: Signal[] = [
  {
    id: 'S-1', title: 'Technologiesektor: Volatilität stark gestiegen', reach: 'Global', time: 'vor 12 Min.', source: 'Marktnachrichten (Beispiel)',
    detail: 'Alle grossen Indizes betroffen, keine titelspezifische Ursache.',
    affected: [{ ref: 'CASE-A', severity: 'risk', exposure: '34% US-Technologie, 5 Positionen', opener: 'Ihr Portfolio ist vom Rückgang im Technologiesektor betroffen – ich möchte kurz die Einordnung mit Ihnen besprechen.' }],
  },
  {
    id: 'S-2', title: 'Hausmeinung: Europäische Aktien neu positiv', reach: 'Hausmeinung', time: 'vor 1 Std.', source: 'CIO-Sicht (Beispiel)',
    detail: 'Der CIO hebt europäische Aktien von neutral auf übergewichten an.',
    affected: [{ ref: 'CASE-B', severity: 'warn', exposure: 'Europa 7 Pkt. unter Soll, 9% Liquidität', opener: 'Unsere Anlagestrategen sehen Europa neu positiv – bei Ihnen besteht dort ein Untergewicht, das wir mit vorhandener Liquidität schliessen könnten.' }],
  },
  {
    id: 'S-3', title: 'USD/CHF: Dollar schwächt sich weiter ab', reach: 'Global', time: 'vor 2 Std.', source: 'Marktnachrichten (Beispiel)',
    detail: 'Der Dollar verliert gegenüber dem Franken den dritten Tag in Folge.',
    affected: [{ ref: 'CASE-A', severity: 'risk', exposure: 'USD-Anteil 61%, 11 Pkt. über Band', opener: 'Der schwächere Dollar trifft Ihr Portfolio überdurchschnittlich – ich habe einen Vorschlag zur Absicherung.' }],
  },
  {
    id: 'S-4', title: 'Obligationenfonds: Produktrisikoklasse angehoben', reach: 'Titel', time: 'gestern', source: 'Wertschriftenstamm',
    detail: 'Der Fonds liegt neu über dem Maximum konservativer Anlageprofile.',
    affected: [{ ref: 'CASE-C', severity: 'risk', exposure: '12% Gewicht im Portfolio', opener: 'Ein Fonds in Ihrem Depot wurde neu eingestuft und passt nicht mehr zu Ihrem Profil – ich zeige Ihnen eine Alternative.' }],
  },
]

export const sampleCall: IncomingCall = { ref: 'CASE-A', number: '+41 44 555 01 23', reason: 'Vermuteter Anlass: Rückgang im Technologiesektor (Signal S-1)' }
