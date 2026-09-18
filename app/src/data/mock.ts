import type { Card, Client, IncomingCall, NewsItem, Signal } from '../types'

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
      { type: 'drivers', title: 'Treiber der Wertentwicklung', period: 'Laufender Monat', total: '-4.2%', note: 'Drei US-Technologietitel erklären 3.1 der 4.2 Prozentpunkte. Schweizer Titel haben gestützt.', items: [
        { name: 'US-Technologie, Position 1', weight: 13.4, ret: -11.2, contribution: -1.5 },
        { name: 'US-Technologie, Position 2', weight: 8.9, ret: -10.1, contribution: -0.9 },
        { name: 'US-Technologie, Position 3', weight: 7.2, ret: -9.7, contribution: -0.7 },
        { name: 'ETF Aktien Welt', weight: 18.0, ret: -3.9, contribution: -0.7 },
        { name: 'Währungseffekt USD/CHF', weight: 61, ret: -1.1, contribution: -0.7 },
        { name: 'Schweizer Qualitätsaktien', weight: 12.0, ret: 2.5, contribution: 0.3 },
      ] },
      { type: 'proposal', title: 'Anlagevorschlag', status: 'Entwurf', summary: 'Klumpenrisiko abbauen, USD-Anteil ins Band zurückführen und das Interesse an nachhaltigen Anlagen aufnehmen – ohne die Aktienquote zu senken.', trades: [
        { side: 'Verkauf', name: 'US-Technologie, Position 1 (Teilverkauf)', amount: "CHF 67'000", share: '-5.4 Pkt.' },
        { side: 'Kauf', name: 'Nachhaltiger Aktienfonds Welt (Empfehlungsliste)', amount: "CHF 67'000", share: '+5.4 Pkt.' },
        { side: 'Absicherung', name: 'USD/CHF-Termingeschäft auf US-Aktienanteil', amount: "CHF 136'000", share: '11 Pkt.' },
      ], effects: [
        { label: 'Grösste Einzelposition', before: '13.4%', after: '8.0%', ok: true },
        { label: 'USD-Anteil (Band 30–50%)', before: '61%', after: '50%', ok: true },
        { label: 'Aktienquote (Band 65–95%)', before: '88%', after: '88%', ok: true },
        { label: 'Regelverletzungen', before: '2', after: '0', ok: true },
      ], open: 'Kein offener Vorschlag. Letzter Vorschlag vom 19.08.2026 («Marktvolatilität – Nachfassen») wurde abgelehnt.' },
      { type: 'context', title: 'Kundenkontext', facts: [{ label: 'Anlageziel', value: 'Langfristiger Vermögensaufbau' }, { label: 'Anlagehorizont', value: 'Über 10 Jahre' }, { label: 'ESG-Profil', value: 'Ja' }, { label: 'Erreichbarkeit', value: 'Bevorzugt E-Mail' }], changes: ['Portfolio -4.2% im laufenden Monat', 'Neue Regelverletzung: USD-Anteil über Band', 'Zwei Marktsignale betreffen das Portfolio'], notes: [
        { date: '02.09.2026', text: 'Beobachtet die Technologieaktien im Portfolio genau, möchte weiter ausbauen.' },
        { date: '19.08.2026', text: 'Wünscht beim nächsten Rebalancing einen möglichst hohen Anteil nachhaltiger Fonds.' },
        { date: '08.05.2026', text: 'Kommt mit höherer Volatilität zurecht, langer Anlagehorizont.' },
      ] },
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
      { type: 'contradiction', title: 'Wunsch gegen Bestand', wish: { quote: 'Keine Anlagen in fossile Energien.', date: '12.06.2026', source: 'Kundennotiz' }, verdict: 'In der Positionsliste unsichtbar: Der Energieanteil steckt nur in zwei Fonds.', exposure: { label: 'Energie (fossil)', total: 3.4, direct: 0, viaFunds: 3.4 }, source: 'Fonds-Durchsicht', holdings: [
        { name: 'ETF Aktien Welt', weight: 18.0, exposure: 2.2, via: 'Fonds' },
        { name: 'Dividendenfonds Global', weight: 9.0, exposure: 1.2, via: 'Fonds' },
      ], fix: { summary: 'Beide Fonds durch Varianten ohne fossile Energien ersetzen.', source: 'Simulation, Regeln neu geprüft', trades: [
        { side: 'Verkauf', name: 'ETF Aktien Welt', amount: "CHF 223'200", share: '-18.0 Pkt.' },
        { side: 'Kauf', name: 'ETF Aktien Welt ex fossile Energien (Empfehlungsliste)', amount: "CHF 223'200", share: '+18.0 Pkt.' },
        { side: 'Verkauf', name: 'Dividendenfonds Global', amount: "CHF 111'600", share: '-9.0 Pkt.' },
        { side: 'Kauf', name: 'Nachhaltiger Aktienfonds Welt (Empfehlungsliste)', amount: "CHF 111'600", share: '+9.0 Pkt.' },
      ], effects: [
        { label: 'Energie (fossil)', before: '3.4%', after: '0.0%', ok: true },
        { label: 'Aktienquote (Band 65–95%)', before: '88%', after: '88%', ok: true },
        { label: 'Grösste Einzelposition', before: '13.4%', after: '13.4%', ok: false },
        { label: 'USD-Anteil (Band 30–50%)', before: '61%', after: '61%', ok: false },
      ] } },
      { type: 'lookthrough', title: 'Fonds-Durchsicht', dimension: 'Sektor', note: 'Energie ist nur über Fonds gehalten. Technologie liegt mit Fonds bei 34% statt 29.5%.', source: 'Positionen + Fondszusammensetzung', rows: [
        { label: 'Technologie', direct: 29.5, viaFunds: 4.5 },
        { label: 'Konsum', direct: 5.4, viaFunds: 6.0 },
        { label: 'Gesundheit', direct: 6.0, viaFunds: 4.1 },
        { label: 'Finanzwerte', direct: 4.0, viaFunds: 5.2 },
        { label: 'Industrie', direct: 3.1, viaFunds: 4.4 },
        { label: 'Energie', direct: 0, viaFunds: 3.4, flag: 'Widerspricht dem Kundenwunsch «Keine Anlagen in fossile Energien»' },
        { label: 'Übrige Sektoren', direct: 2.0, viaFunds: 10.4 },
      ] },
      { type: 'peers', title: 'Vergleich mit ähnlichen Kunden', profile: 'Dynamisch', n: 11, note: 'Klumpenrisiko höher als bei allen Vergleichskunden, Liquidität am unteren Rand.', source: 'Kundenbestand, Stand heute', metrics: [
        { label: 'Aktienquote', unit: '%', min: 72, median: 84, max: 93, value: 88 },
        { label: 'Liquidität', unit: '%', min: 1, median: 5, max: 12, value: 3 },
        { label: 'Grösste Position', unit: '%', min: 4.1, median: 7.6, max: 11.8, value: 13.4 },
        { label: '12-Monats-Entwicklung', unit: '%', signed: true, min: 3.9, median: 9.6, max: 14.2, value: 8.3 },
      ] },
      { type: 'todos', title: 'Offene Zusagen und Pendenzen', items: [
        { text: 'ESG-Aufteilung des Portfolios zustellen', owner: 'Berater', due: '26.08.2026', done: false, overdue: true, source: 'Gespräch 19.08.2026' },
        { text: 'Zwei nachhaltige Aktienfonds vorschlagen', owner: 'Berater', due: '30.09.2026', done: false, source: 'Gespräch 19.08.2026' },
        { text: 'Entscheid zur USD-Absicherung', owner: 'Kunde', due: '25.09.2026', done: false, source: 'Gespräch 02.09.2026' },
        { text: 'Risikoprofil erneuern', owner: 'Berater', due: '08.05.2026', done: true, source: 'Profiling 08.05.2026' },
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
      { type: 'drivers', title: 'Treiber der Wertentwicklung', period: 'Laufendes Quartal', total: '+0.6%', note: 'Der Rückstand von 1.4 Punkten zur Zielallokation entsteht durch fehlendes Europa-Gewicht und hohe Liquidität, nicht durch die Titelauswahl.', items: [
        { name: 'Schweizer Aktien', weight: 21, ret: 2.4, contribution: 0.5 },
        { name: 'Aktien Nordamerika', weight: 13, ret: 2.3, contribution: 0.3 },
        { name: 'Aktien Europa (Untergewicht)', weight: 6, ret: 4.8, contribution: 0.3 },
        { name: 'Obligationen CHF', weight: 42, ret: 0.2, contribution: 0.1 },
        { name: 'Liquidität', weight: 9, ret: 0.0, contribution: 0.0 },
        { name: 'Übrige Anlagen', weight: 2, ret: -3.0, contribution: -0.1 },
      ] },
      { type: 'proposal', title: 'Anlagevorschlag', status: 'Entwurf', summary: 'Überschüssige Liquidität in europäische Aktien umschichten – im Einklang mit der neuen Hausmeinung und dem Wunsch nach nachhaltigen Anlagen.', trades: [
        { side: 'Kauf', name: 'Nachhaltiger Aktienfonds Europa (Empfehlungsliste)', amount: "CHF 34'000", share: '+5.0 Pkt.' },
      ], effects: [
        { label: 'Aktien Europa (Band 8–18%)', before: '6%', after: '11%', ok: true },
        { label: 'Liquidität (Soll 5%)', before: '9%', after: '4%', ok: true },
        { label: 'Aktienquote (Band 35–55%)', before: '44%', after: '49%', ok: true },
        { label: 'Regelverletzungen', before: '1', after: '0', ok: true },
      ], open: 'Offener Vorschlag vom 10.09.2026 («Periodische Portfolioüberprüfung») ist noch im Entwurf.' },
      { type: 'context', title: 'Kundenkontext', facts: [{ label: 'Anlageziel', value: 'Vermögenserhalt mit Ertrag' }, { label: 'Anlagehorizont', value: '5 bis 10 Jahre' }, { label: 'ESG-Profil', value: 'Nicht erfasst' }, { label: 'Erreichbarkeit', value: 'Nach 18 Uhr' }], changes: ['Hausmeinung für Europa von neutral auf positiv', 'Rückstand zur Zielallokation auf 1.4 Punkte gestiegen'], notes: [
        { date: '10.09.2026', text: 'Wünscht beim nächsten Gespräch einen Vergleich mit der Benchmark.' },
        { date: '25.08.2026', text: 'Hat sich nach nachhaltigen Anlagemöglichkeiten erkundigt.' },
      ] },
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
      { type: 'profile', title: 'Kundenprofil', source: 'Aus 3 Notizen und 7 Vorschlägen abgeleitet', persona: 'Entscheidet nach Zahlen und liest abends nach: schriftlich vorlegen, Benchmark-Vergleich mitbringen.', said: [
        { date: '10.09.2026', text: 'Wünscht schriftliche Zusammenfassung nach jedem Gespräch' },
        { date: '25.08.2026', text: 'Erreichbar nach 18 Uhr' },
        { date: '14.03.2026', text: 'Nur E-Mail, keine Anrufe tagsüber' },
      ], done: [
        { label: 'Vorschläge angenommen', value: '5 von 7', source: 'Vorschlagshistorie' },
        { label: 'Liquidität gehalten', value: '9% · Soll 5%', source: 'Konten, SAA' },
        { label: 'In den 3 schwächsten Monaten', value: 'keine Verkäufe', source: 'Transaktionen' },
      ] },
      { type: 'peers', title: 'Vergleich mit ähnlichen Kunden', profile: 'Ausgeglichen', n: 14, note: 'Liquidität doppelt so hoch wie der Median, Entwicklung darunter.', source: 'Kundenbestand, Stand heute', metrics: [
        { label: 'Aktienquote', unit: '%', min: 38, median: 46, max: 54, value: 44 },
        { label: 'Liquidität', unit: '%', min: 2, median: 4.5, max: 10, value: 9 },
        { label: 'Grösste Position', unit: '%', min: 3.2, median: 5.9, max: 9.5, value: 6.8 },
        { label: '12-Monats-Entwicklung', unit: '%', signed: true, min: 1.8, median: 4.6, max: 7.4, value: 3.1 },
      ] },
      { type: 'callnote', title: 'Gesprächsnotiz bestätigen', source: 'Transkript, 24 Min.', note: { id: 'CN-B-0919', clientRef: 'CASE-B', date: '19.09.2026', confirmed: false, proposed: [
        { findingId: 'allocation.region:CASE-B:europe', text: "CHF 34'000 aus Liquidität in Aktienfonds Europa", reaction: 'accepted' },
        { text: 'Nachhaltige Variante des Europa-Fonds', reaction: 'open', why: 'Will zuerst das Factsheet lesen.' },
        { text: 'Obligationenanteil um 5 Punkte senken', reaction: 'rejected', why: 'Will den laufenden Ertrag behalten.' },
      ], promises: [
        { text: 'Factsheet nachhaltiger Aktienfonds Europa senden', due: '22.09.2026', done: false },
        { text: 'Vergleich zur Zielallokation per E-Mail zustellen', due: '26.09.2026', done: false },
      ], factUpdates: [
        { note: 'Erreichbar nach 18 Uhr', status: 'confirmed' },
        { note: 'ESG-Profil: nicht erfasst', status: 'changed', newValue: 'Interesse bestätigt – Profil nachführen' },
        { note: 'Wünscht Vergleich mit der Benchmark', status: 'outdated', newValue: 'Im Gespräch gezeigt' },
      ] } },
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
      { type: 'drivers', title: 'Treiber der Wertentwicklung', period: 'Seit Jahresbeginn', total: '+1.9%', note: 'Ruhige Entwicklung. Der beanstandete Fonds hat am meisten beigetragen – und trägt das höchste Risiko.', items: [
        { name: 'Beanstandeter Obligationenfonds', weight: 12, ret: 5.8, contribution: 0.7 },
        { name: 'Obligationen CHF Inland', weight: 59, ret: 1.2, contribution: 0.7 },
        { name: 'Schweizer Aktien', weight: 14, ret: 3.6, contribution: 0.5 },
        { name: 'Immobilienfonds', weight: 6, ret: 1.7, contribution: 0.1 },
        { name: 'Übrige Anlagen', weight: 3, ret: -3.3, contribution: -0.1 },
      ] },
      { type: 'proposal', title: 'Anlagevorschlag', status: 'Entwurf', summary: 'Regelverletzung beheben und die Liquidität für den Immobilienkauf innert 12 Monaten bereitstellen.', trades: [
        { side: 'Verkauf', name: 'Beanstandeter Obligationenfonds (ganze Position)', amount: "CHF 50'400", share: '-12.0 Pkt.' },
        { side: 'Kauf', name: 'Geldmarktfonds CHF (Empfehlungsliste)', amount: "CHF 50'400", share: '+12.0 Pkt.' },
      ], effects: [
        { label: 'Produktrisikoklasse im Profil', before: 'verletzt', after: 'eingehalten', ok: true },
        { label: 'Liquidität und Geldmarkt (Band bis 25%)', before: '6%', after: '18%', ok: true },
        { label: 'Obligationen (Band 50–80%)', before: '71%', after: '59%', ok: true },
        { label: 'Betrag für Immobilienkauf gedeckt', before: 'offen', after: 'offen', ok: false },
      ], open: 'Betrag und Zeitpunkt des Immobilienkaufs sind nicht erfasst – im Gespräch klären.' },
      { type: 'context', title: 'Kundenkontext', facts: [{ label: 'Anlageziel', value: 'Kapitalerhalt' }, { label: 'Anlagehorizont', value: 'Unter 3 Jahren für Teilbetrag' }, { label: 'ESG-Profil', value: 'Nein' }, { label: 'Erreichbarkeit', value: 'Telefonisch vormittags' }], changes: ['Obligationenfonds neu eingestuft, Regelverletzung seit gestern', 'Jahresgespräch steht an'], notes: [
        { date: '03.07.2026', text: 'Plant einen Immobilienkauf, möglicher Liquiditätsbedarf innert 12 Monaten.' },
        { date: '23.06.2026', text: 'Seit dem letzten Marktrückgang sehr risikoscheu, bevorzugt defensive Ausrichtung.' },
      ] },
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
      { type: 'stalenote', title: 'Abgelaufene Notiz', note: { quote: 'Plant einen Immobilienkauf, Liquiditätsbedarf innert 12 Monaten.', date: '14.10.2024', source: 'Kundennotiz' }, age: '23 Monate', expired: '14.10.2025', reason: 'Das Zeitfenster ist seit 11 Monaten zu. Am 03.07.2026 unverändert übernommen, nie bestätigt.', question: 'Hat der Immobilienkauf stattgefunden?', followUps: ['Wenn ja: Hypothek und neue Liquiditätsreserve erfassen', 'Wenn nein: neuer Zeitpunkt und Betrag'] },
      { type: 'profile', title: 'Kundenprofil', source: 'Aus 3 Notizen und 5 Vorschlägen abgeleitet', persona: 'Entscheidet langsam und lehnt 4 von 5 Vorschlägen ab: eine defensive Option bringen, Bedenkzeit lassen.', said: [
        { date: '03.07.2026', text: 'Unterlagen per Post, keine Fachbegriffe' },
        { date: '23.06.2026', text: 'Seit dem letzten Rückgang sehr risikoscheu' },
        { date: '23.06.2026', text: 'Telefonisch, vormittags' },
      ], done: [
        { label: 'Vorschläge angenommen', value: '1 von 5', source: 'Vorschlagshistorie' },
        { label: 'Liquidität gehalten', value: '6% · Soll 10%', source: 'Konten, SAA' },
        { label: 'In den 3 schwächsten Monaten', value: '2 Verkäufe', source: 'Transaktionen' },
      ] },
      { type: 'todos', title: 'Offene Zusagen und Pendenzen', items: [
        { text: 'Betrag und Zeitpunkt des Immobilienkaufs klären', owner: 'Berater', due: '03.08.2026', done: false, overdue: true, source: 'Gespräch 03.07.2026' },
        { text: 'Finanzierungsbestätigung der Bank einreichen', owner: 'Kunde', due: '31.07.2026', done: false, overdue: true, source: 'Gespräch 03.07.2026' },
        { text: 'Ersatz für den beanstandeten Obligationenfonds vorschlagen', owner: 'Berater', due: '22.09.2026', done: false, source: 'Regelverletzung' },
        { text: 'Anlageprofil erneuern', owner: 'Berater', due: '23.06.2026', done: true, source: 'Profiling 23.06.2026' },
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

// Meldungen des Tages, neueste zuerst. Nur Einträge mit `affects` haben einen Bezug zu einem Kunden.
export const newsFeed: NewsItem[] = [
  { id: 'N-14', time: '09:42', reach: 'Global', source: 'Marktnachrichten (Beispiel)', title: 'Technologiewerte weiten Verluste aus, Volatilität auf Jahreshoch', affects: { 'CASE-A': { tag: 'US-Tech 34%', position: 'US-Technologie, 34% des Portfolios', meaning: 'Rückgang ist marktweit – Einordnung statt Verkauf.', severity: 'risk' } } },
  { id: 'N-12', time: '09:31', reach: 'Sektor', source: 'Marktnachrichten (Beispiel)', title: 'Europäische Banken legen nach Quartalszahlen zu', affects: { 'CASE-B': { tag: 'Europa 6%', position: 'Aktien Europa 6%, 7 Pkt. unter Soll', meaning: 'Das Untergewicht kostet weiter Rendite.', severity: 'warn' } } },
  { id: 'N-13', time: '09:20', reach: 'Global', source: 'Marktnachrichten (Beispiel)', title: 'Dollar fällt zum Franken den dritten Tag in Folge', affects: { 'CASE-A': { tag: 'USD 61%', position: 'USD-Anteil 61%, 11 Pkt. über Band', meaning: 'Währungsverlust kommt zum Kursrückgang hinzu – Absicherung ansprechen.', severity: 'risk' } } },
  { id: 'N-11', time: '09:05', reach: 'Titel', source: 'Marktnachrichten (Beispiel)', title: 'Nestlé bestätigt Jahresausblick', affects: {  } },
  { id: 'N-10', time: '08:50', reach: 'Hausmeinung', source: 'CIO-Sicht (Beispiel)', title: 'Hausmeinung: Europäische Aktien von neutral auf übergewichten', affects: { 'CASE-B': { tag: 'Europa 6%', position: 'Aktien Europa 6%, Liquidität 9%', meaning: 'Hausmeinung stützt die Umschichtung aus der Liquidität.', severity: 'warn' } } },
  { id: 'N-09', time: '08:41', reach: 'Global', source: 'Marktnachrichten (Beispiel)', title: 'SNB belässt den Leitzins unverändert', affects: { 'CASE-C': { tag: 'Geldmarkt 18%', position: 'Geplanter Geldmarktanteil 18%', meaning: 'Geldmarkt bleibt für 12 Monate eine ruhige Parklösung.', severity: 'info' } } },
  { id: 'N-08', time: '08:30', reach: 'Titel', source: 'Wertschriftenstamm', title: 'Obligationenfonds: Produktrisikoklasse angehoben', affects: { 'CASE-C': { tag: 'Fonds 12%', position: 'Obligationenfonds, 12% Gewicht', meaning: 'Passt nicht mehr zum konservativen Profil – Verkauf empfohlen.', severity: 'risk' } } },
  { id: 'N-07', time: '08:12', reach: 'Sektor', source: 'Marktnachrichten (Beispiel)', title: 'Ölpreis steigt nach Förderkürzung', affects: {  } },
  { id: 'N-06', time: '07:58', reach: 'Titel', source: 'Marktnachrichten (Beispiel)', title: 'Holcim schliesst Übernahme in Nordamerika ab', affects: {  } },
  { id: 'N-05', time: '07:45', reach: 'Global', source: 'Marktnachrichten (Beispiel)', title: 'Asiatische Börsen schliessen uneinheitlich', affects: {  } },
  { id: 'N-04', time: '07:30', reach: 'Sektor', source: 'Marktnachrichten (Beispiel)', title: 'Pharmawerte: Zulassungsentscheid in den USA verschoben', affects: {  } },
  { id: 'N-03', time: '07:15', reach: 'Global', source: 'Marktnachrichten (Beispiel)', title: 'Goldpreis erreicht neues Hoch', affects: {  } },
  { id: 'N-02', time: '07:02', reach: 'Titel', source: 'Marktnachrichten (Beispiel)', title: 'Zurich Insurance kündigt Aktienrückkauf an', affects: {  } },
  { id: 'N-01', time: '06:45', reach: 'Global', source: 'Marktnachrichten (Beispiel)', title: 'US-Futures vorbörslich leicht im Minus', affects: {  } },
]
