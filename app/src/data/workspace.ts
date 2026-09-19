import type { Topic, TranscriptLine } from '../workspace/types'
import type { BriefItem } from '../workspace/brief'

// BEISPIELDATEN — Themenwissen und Gesprächsverlauf, wie sie später das LLM aus der Datenbank ableitet.

const months = ['Okt', 'Nov', 'Dez', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep']
const series = (values: number[]) => values.map((value, i) => ({ label: months[i], value }))

export const topics: Record<string, Topic[]> = {
  'CASE-A': [
    {
      id: 'technologie', label: 'Rückgang Technologie', severity: 'risk',
      keywords: ['technologie', 'tech', 'verlust', 'verloren', 'gefallen', 'rückgang', 'minus', 'kurs', 'nvidia', 'warum'],
      say: 'Der Rückgang kommt fast vollständig aus dem Technologiesektor und betrifft den ganzen Markt – nicht einzelne Titel in Ihrem Depot.',
      why: '3.1 der 4.2 Prozentpunkte stammen aus drei US-Technologietiteln; alle grossen Indizes sind betroffen.',
      next: 'Klumpenrisiko ansprechen: grösste Position von 13.4% auf rund 8% zurücknehmen.',
      insight: {
        kurz: 'Minus 4.2% im Monat, davon 3.1 Punkte aus US-Technologie (34% des Portfolios). Marktweite Bewegung.',
        standard: 'Das Portfolio liegt im laufenden Monat 4.2% im Minus. US-Technologie macht 34% aus und erklärt 3.1 Prozentpunkte des Rückgangs. Die Volatilität ist sektorweit gestiegen, eine titelspezifische Ursache liegt nicht vor. Seit Jahresbeginn steht das Portfolio weiterhin bei +6.1%.',
        detailliert: 'Das Portfolio liegt im laufenden Monat 4.2% im Minus, seit Jahresbeginn bei +6.1%. US-Technologie macht 34% des Portfolios aus (5 Positionen); die drei grössten Verlustbringer gehören alle zu diesem Sektor und erklären 3.1 der 4.2 Prozentpunkte. Die Volatilität ist in allen grossen Indizes gestiegen, die Bewegung ist also marktweit. Die Hausmeinung ist für US-Technologie neutral und empfiehlt Qualitätsaktien. Die Aktienquote von 88% liegt innerhalb des Mandatsbands (65–95%), ein Verkauf ist aus Mandatssicht nicht zwingend. Handlungsbedarf besteht nur beim Klumpenrisiko eines Einzeltitels über 10%.',
      },
      sources: ['Positionen', 'Performancebeitrag', 'Marktnachrichten (Beispiel)', 'CIO-Sicht (Beispiel)'],
      module: { confidence: 91, spec: { type: 'verlauf', title: 'Portfoliowert, letzte 12 Monate', unit: 'TCHF', note: 'Rückgang im September nach elf Monaten Anstieg; Stand weiterhin über Jahresbeginn.', points: series([1118, 1131, 1150, 1169, 1162, 1190, 1214, 1236, 1259, 1281, 1294, 1240]) } },
    },
    {
      id: 'dollar', label: 'USD-Übergewicht', severity: 'risk',
      keywords: ['dollar', 'usd', 'währung', 'franken', 'absicherung', 'absichern', 'wechselkurs'],
      say: 'Ihr Dollar-Anteil liegt über dem, was wir im Mandat vereinbart haben. Ich schlage vor, den US-Aktienanteil in Franken abzusichern – ohne etwas zu verkaufen.',
      why: 'USD-Anteil 61% bei einem Mandatsband bis 50%; der Dollar schwächt sich seit drei Tagen ab.',
      next: 'Absicherungsvorschlag erstellen und Zustimmung für rund 11 Prozentpunkte des US-Aktienanteils einholen.',
      insight: {
        kurz: 'USD 61%, Band 30–50%: 11 Punkte darüber. Absicherung bringt den Anteil zurück ins Band.',
        standard: 'Der USD-Anteil beträgt 61% und liegt 11 Prozentpunkte über dem oberen Mandatsband von 50%. Der Dollar hat sich gegenüber dem Franken drei Tage in Folge abgeschwächt. Eine CHF-Absicherung des US-Aktienanteils bringt die Quote ohne Verkäufe zurück ins Band.',
        detailliert: 'Der USD-Anteil beträgt 61% bei einem Mandatsband von 30–50% (Soll 40%), also 11 Prozentpunkte über dem Maximum. CHF liegt mit 24% unter dem Band von 35–60%, EUR mit 12% innerhalb des Bands. Der Dollar hat sich gegenüber dem Franken drei Tage in Folge abgeschwächt (Marktsignal S-3). Eine CHF-Absicherung auf rund 11 Prozentpunkten des US-Aktienanteils bringt die Quote ohne Verkäufe und ohne Steuerfolgen zurück ins Band. Die Verletzung ist als SAA-Währungsband-Regel erfasst.',
      },
      sources: ['SAA-Währungsband', 'Positionen', 'Marktnachrichten (Beispiel)'],
      module: { confidence: 88, spec: { type: 'balken', title: 'Währungsanteile gegenüber Mandatsband', unit: '%', note: 'USD liegt 11 Punkte über dem Band, CHF entsprechend darunter.', bars: [{ label: 'USD', value: 61, min: 30, max: 50 }, { label: 'CHF', value: 24, min: 35, max: 60 }, { label: 'EUR', value: 12, min: 5, max: 20 }, { label: 'Übrige', value: 3, min: 0, max: 10 }] } },
    },
    {
      id: 'nachhaltig', label: 'Nachhaltige Anlagen', severity: 'info',
      keywords: ['nachhaltig', 'nachhaltige', 'nachhaltigkeit', 'esg', 'grün', 'klima'],
      say: 'Sie hatten nach nachhaltigen Anlagen gefragt. Ich habe zwei globale Aktienfonds aus unserer Empfehlungsliste vorbereitet, die zu Ihrem Mandat passen.',
      why: 'Interesse in der Kundennotiz festgehalten; ESG-Profil «Ja».',
      next: 'Die zwei Fonds der Empfehlungsliste als Anlagevorschlag zustellen und Folgetermin vereinbaren.',
      insight: {
        kurz: 'ESG-Profil «Ja», Interesse notiert. Zwei passende Fonds auf der Empfehlungsliste.',
        standard: 'Der Kunde hat ein ESG-Profil «Ja» und hat Interesse an nachhaltigen Anlagen geäussert (Kundennotiz). Auf der Empfehlungsliste stehen zwei globale Aktienfonds, die die Mindestbewertung erfüllen und die US-Technologie-Konzentration gleichzeitig senken würden.',
        detailliert: 'Der Kunde hat ein ESG-Profil «Ja» (Mindestbewertung 5.7) und hat Interesse an nachhaltigen Anlagen geäussert (Kundennotiz). Auf der Empfehlungsliste stehen zwei globale Aktienfonds, die die Mindestbewertung erfüllen. Ein Tausch gegen die grösste Technologieposition würde zugleich das Klumpenrisiko beheben und den USD-Anteil leicht senken. Zur Nachhaltigkeitsbewertung der einzelnen heutigen Positionen liegen in den Beispieldaten keine Angaben vor.',
      },
      sources: ['Kundennotiz', 'ESG-Profil', 'Empfehlungsliste'],
    },
    {
      id: 'klumpen', label: 'Klumpenrisiko', severity: 'warn',
      keywords: ['klumpen', 'klumpenrisiko', 'einzeltitel', 'konzentration', 'position', 'reduzieren', 'verkaufen'],
      say: 'Eine einzelne Position ist auf über 10% angewachsen. Ich empfehle, sie auf rund 8% zurückzunehmen – das ist eine Regel, kein Urteil über den Titel.',
      why: 'Suitability-Regel «Klumpenrisiko Einzelinstrument» verletzt.',
      next: 'Erlös thematisieren: nachhaltigen globalen Aktienfonds als Ersatz vorschlagen.',
      insight: {
        kurz: 'Grösste Position 13.4%, Limite 10%. Reduktion auf 8% behebt die Verletzung.',
        standard: 'Die grösste Einzelposition macht 13.4% des Portfolios aus, die Limite liegt bei 10%. Eine Reduktion auf rund 8% behebt die Regelverletzung und senkt zugleich die Technologie-Konzentration.',
        detailliert: 'Die grösste Einzelposition macht 13.4% des Portfolios aus, die Limite der Suitability-Regel liegt bei 10%. Die fünf grössten Positionen vereinen 41% des Vermögens, vier davon gehören zu US-Technologie. Eine Reduktion der grössten Position auf rund 8% behebt die Regelverletzung, senkt die Technologie-Konzentration und reduziert den USD-Anteil um etwa 5 Prozentpunkte.',
      },
      sources: ['Regelverletzungen', 'Positionen'],
      module: { confidence: 64, spec: { type: 'balken', title: 'Grösste Positionen, Anteil am Portfolio', unit: '%', note: 'Nur die grösste Position überschreitet die Limite von 10%.', bars: [{ label: 'Position 1', value: 13.4, min: 0, max: 10 }, { label: 'Position 2', value: 8.9, min: 0, max: 10 }, { label: 'Position 3', value: 7.2, min: 0, max: 10 }, { label: 'Position 4', value: 6.1, min: 0, max: 10 }, { label: 'Position 5', value: 5.4, min: 0, max: 10 }] } },
    },
  ],
  'CASE-B': [
    {
      id: 'rueckstand', label: 'Rückstand zur Zielallokation', severity: 'warn',
      keywords: ['rückstand', 'zurück', 'hinter', 'performance', 'rendite', 'schlechter', 'vergleich', 'warum'],
      say: 'Der Rückstand kommt aus der Aufteilung, nicht aus der Titelauswahl: zu wenig Europa und etwas viel Liquidität in einem steigenden Markt.',
      why: 'Aktien Europa 7 Punkte unter Soll, Liquidität 9% statt 5%.',
      next: 'Zur Lösung überleiten: Europa-Untergewicht mit vorhandener Liquidität schliessen.',
      insight: {
        kurz: '+0.6% im Quartal gegenüber +2.0% der Zielallokation. Ursache: Europa-Untergewicht und 9% Liquidität.',
        standard: 'Das Portfolio erzielte im laufenden Quartal +0.6%, die Zielallokation +2.0%. Der Rückstand von 1.4 Prozentpunkten stammt aus dem Untergewicht europäischer Aktien (7 Punkte unter Soll) und der Liquidität von 9%. Die Titelauswahl war neutral.',
        detailliert: 'Das Portfolio erzielte im laufenden Quartal +0.6%, die Zielallokation +2.0%. Der Rückstand von 1.4 Prozentpunkten stammt aus dem Untergewicht europäischer Aktien (6% statt 13%) und der Liquidität von 9% bei einem Soll von 5%. Die Titelauswahl war neutral. In den Daten ist keine Benchmark hinterlegt; der Vergleich erfolgt gegen die strategische Zielallokation des Mandats. Die Hausmeinung ist für Europa neu positiv, das stützt eine Umschichtung.',
      },
      sources: ['Performanceverlauf', 'SAA-Länderband', 'Positionen'],
      module: { confidence: 86, spec: { type: 'verlauf', title: 'Portfoliowert, letzte 12 Monate', unit: 'TCHF', note: 'Seitwärtsbewegung seit Juni, während die Zielallokation zulegte.', points: series([641, 648, 655, 659, 663, 668, 671, 674, 676, 677, 679, 680]) } },
    },
    {
      id: 'europa', label: 'Europäische Aktien', severity: 'warn',
      keywords: ['europa', 'europäisch', 'europäische', 'hausmeinung', 'cio', 'region', 'umschichten'],
      say: 'Unsere Anlagestrategen sehen Europa neu positiv. Bei Ihnen besteht dort ein Untergewicht, das wir mit vorhandener Liquidität schliessen können.',
      why: 'Hausmeinung von neutral auf übergewichten angehoben; Regel «Untergewicht Übriges Europa» aktiv.',
      next: 'Betrag festlegen: 5 Prozentpunkte Liquidität, Anlagevorschlag noch im Gespräch auslösen.',
      insight: {
        kurz: 'Europa 6% statt 13%. Hausmeinung neu positiv. 5 Punkte Liquidität umschichten.',
        standard: 'Europäische Aktien machen 6% aus, das Soll liegt bei 13%. Der CIO hat Europa von neutral auf übergewichten angehoben. Mit 5 Prozentpunkten aus der Liquidität lässt sich der grösste Teil des Untergewichts schliessen.',
        detailliert: 'Europäische Aktien machen 6% des Portfolios aus, das Soll liegt bei 13% (Band 8–18%). Die Suitability-Regel «Untergewicht in der Aktienregion Übriges Europa» ist als Warnung aktiv. Der CIO hat Europa von neutral auf übergewichten angehoben (Marktsignal S-2). Mit 5 Prozentpunkten aus der Liquidität (heute 9%, Soll 5%) steigt Europa auf 11% und liegt damit im Band; die Aktienquote steigt von 44% auf 49% und bleibt im Band von 35–55%.',
      },
      sources: ['SAA-Länderband', 'Regelverletzungen', 'CIO-Sicht (Beispiel)'],
      module: { confidence: 90, spec: { type: 'balken', title: 'Aktienregionen gegenüber Mandatsband', unit: '%', note: 'Nur «Übriges Europa» liegt ausserhalb des Bands.', bars: [{ label: 'Schweiz', value: 21, min: 15, max: 25 }, { label: 'Nordamerika', value: 13, min: 8, max: 18 }, { label: 'Übriges Europa', value: 6, min: 8, max: 18 }, { label: 'Asien/Pazifik', value: 4, min: 0, max: 8 }] } },
    },
    {
      id: 'nachhaltig', label: 'Nachhaltige Anlagen', severity: 'info',
      keywords: ['nachhaltig', 'nachhaltige', 'nachhaltigkeit', 'esg', 'klima'],
      say: 'Für die Umschichtung nach Europa kann ich Ihnen eine nachhaltige Variante anbieten – das verbindet beides.',
      why: 'Frühere Anfrage in der Kundennotiz.',
      next: 'Nachhaltigen Europa-Aktienfonds in den Anlagevorschlag aufnehmen und Vergleich zustellen.',
      insight: {
        kurz: 'Frühere Anfrage notiert. Nachhaltiger Europa-Aktienfonds auf der Empfehlungsliste.',
        standard: 'Der Kunde hat sich früher nach nachhaltigen Anlagemöglichkeiten erkundigt (Kundennotiz). Auf der Empfehlungsliste steht ein nachhaltiger europäischer Aktienfonds, der sich für die Umschichtung eignet.',
        detailliert: 'Der Kunde hat sich früher nach nachhaltigen Anlagemöglichkeiten erkundigt (Kundennotiz). Ein ESG-Profil ist nicht hinterlegt, es besteht also keine Vorgabe, nur ein geäussertes Interesse. Auf der Empfehlungsliste steht ein nachhaltiger europäischer Aktienfonds, der sich für die Umschichtung eignet. Ein Vergleich der Kosten mit der konventionellen Variante liegt in den Beispieldaten nicht vor.',
      },
      sources: ['Kundennotiz', 'Empfehlungsliste'],
    },
  ],
  'CASE-C': [
    {
      id: 'fonds', label: 'Beanstandeter Obligationenfonds', severity: 'risk',
      keywords: ['fonds', 'obligationenfonds', 'obligationen', 'risikoklasse', 'eingestuft', 'brief', 'beanstandet', 'verkaufen'],
      say: 'Ein Fonds in Ihrem Depot wurde neu eingestuft und passt nicht mehr zu Ihrem Profil. Ich empfehle den Verkauf und zeige Ihnen eine ruhigere Alternative.',
      why: 'Produktrisikoklasse über dem Maximum des Anlageprofils; 12% Gewicht.',
      next: 'Verwendung des Erlöses klären: bis zum Immobilienkauf im Geldmarkt parkieren.',
      insight: {
        kurz: 'Fonds mit 12% Gewicht, Risikoklasse über Profilmaximum. Verkauf behebt die Verletzung.',
        standard: 'Der Obligationenfonds macht 12% des Portfolios aus. Seine Produktrisikoklasse wurde angehoben und liegt jetzt über dem Maximum des konservativen Profils. Die Verletzung ist als Fehler erfasst; ein Verkauf behebt sie.',
        detailliert: 'Der Obligationenfonds macht 12% des Portfolios aus (rund CHF 50\'400). Seine Produktrisikoklasse wurde im Wertschriftenstamm angehoben (Marktsignal S-4) und liegt jetzt über dem Maximum des konservativen Profils. Die Verletzung ist als Fehler erfasst, nicht als Warnung. Ein Verkauf behebt sie; die Obligationenquote sinkt von 71% auf 59% und bleibt im Band von 50–80%. Der Erlös deckt zugleich einen Teil des Liquiditätsbedarfs für den Immobilienkauf.',
      },
      sources: ['Regelverletzungen', 'Wertschriftenstamm', 'Positionen'],
      module: { confidence: 82, spec: { type: 'balken', title: 'Allokation gegenüber Mandatsband', unit: '%', note: 'Alle Anlageklassen im Band; die Liquidität liegt am unteren Rand.', bars: [{ label: 'Liquidität', value: 6, min: 0, max: 25 }, { label: 'Obligationen', value: 71, min: 50, max: 80 }, { label: 'Aktien', value: 14, min: 5, max: 25 }, { label: 'Immobilien', value: 6, min: 0, max: 15 }, { label: 'Übrige', value: 3, min: 0, max: 10 }] } },
    },
    {
      id: 'immobilie', label: 'Immobilienkauf', severity: 'warn',
      keywords: ['immobilie', 'immobilienkauf', 'haus', 'wohnung', 'kauf', 'anzahlung', 'liquidität', 'bargeld', 'sicher'],
      say: 'Für Ihren Immobilienkauf sollten wir das Geld jetzt reservieren. Ich schlage vor, den Erlös aus dem Fonds bis zum Kauf im Geldmarkt zu parkieren.',
      why: 'Liquiditätsbedarf innert 12 Monaten notiert; Liquidität nur 6%.',
      next: 'Betrag und Zeitpunkt des Kaufs erfragen und als Kundennotiz festhalten.',
      insight: {
        kurz: 'Liquidität 6% (rund CHF 25\'000). Bedarf innert 12 Monaten, Betrag noch offen.',
        standard: 'Die Liquidität beträgt 6% des Vermögens, rund CHF 25\'000. Laut Kundennotiz ist innert 12 Monaten ein Immobilienkauf geplant. Betrag und Zeitpunkt sind nicht erfasst und müssen im Gespräch geklärt werden.',
        detailliert: 'Die Liquidität beträgt 6% des Vermögens, rund CHF 25\'000. Laut Kundennotiz ist innert 12 Monaten ein Immobilienkauf geplant. Betrag und Zeitpunkt sind nicht erfasst und müssen im Gespräch geklärt werden. Mit dem Verkauf des beanstandeten Fonds steigt die Liquidität auf 18% (rund CHF 75\'600) und bleibt im Band bis 25%. Für einen Horizont von 12 Monaten eignet sich der Geldmarkt; die Volatilität des Portfolios liegt mit 4.1% unter dem Maximum von 5.5%.',
      },
      sources: ['Kundennotiz', 'Konten', 'Risikoprofil'],
      module: { confidence: 58, spec: { type: 'verlauf', title: 'Portfoliowert, letzte 12 Monate', unit: 'TCHF', note: 'Ruhiger Verlauf, passend zum konservativen Profil.', points: series([409, 410, 412, 412, 413, 415, 416, 416, 418, 419, 419, 420]) } },
    },
  ],
}

export const transcripts: Record<string, TranscriptLine[]> = {
  'CASE-A': [
    { speaker: 'Kunde', text: 'Guten Tag, ich habe gesehen, dass mein Depot diesen Monat ziemlich verloren hat. Was ist da los?' },
    { speaker: 'Berater', text: 'Guten Tag. Der Rückgang kommt aus dem Technologiesektor, das betrifft im Moment den ganzen Markt.' },
    { speaker: 'Kunde', text: 'Und der Dollar fällt ja auch noch. Trifft mich das zusätzlich?' },
    { speaker: 'Berater', text: 'Ja, Ihr Dollar-Anteil ist höher als vereinbart. Eine Absicherung in Franken würde das auffangen.' },
    { speaker: 'Kunde', text: 'Ich hatte ausserdem einmal nach nachhaltigen Anlagen gefragt.' },
    { speaker: 'Berater', text: 'Genau, dazu habe ich zwei nachhaltige Fonds für Sie vorbereitet.' },
  ],
  'CASE-B': [
    { speaker: 'Kunde', text: 'Grüezi. Ich habe den Quartalsauszug erhalten. Warum liege ich hinter dem Vergleich zurück?' },
    { speaker: 'Berater', text: 'Grüezi. Der Rückstand kommt aus der Aufteilung, nicht aus der Auswahl der Titel.' },
    { speaker: 'Kunde', text: 'Ich lese überall, dass Europa wieder interessant wird. Bin ich da dabei?' },
    { speaker: 'Berater', text: 'Bei Europa sind Sie untergewichtet, und unsere Hausmeinung ist dort neu positiv.' },
    { speaker: 'Kunde', text: 'Wenn wir etwas ändern, dann bitte möglichst nachhaltig.' },
  ],
  'CASE-C': [
    { speaker: 'Kunde', text: 'Guten Tag. Ich habe einen Brief zu einem meiner Fonds erhalten, das hat mich beunruhigt.' },
    { speaker: 'Berater', text: 'Guten Tag. Der Fonds wurde neu eingestuft und passt nicht mehr zu Ihrem Profil, ich empfehle den Verkauf.' },
    { speaker: 'Kunde', text: 'Ich möchte nächstes Jahr eine Wohnung kaufen. Ist mein Geld dafür sicher?' },
    { speaker: 'Berater', text: 'Für den Immobilienkauf reservieren wir die Liquidität jetzt.' },
  ],
}

// Hand-written 60-second briefs for the sample clients (real client files get theirs from data/facts.ts).
export const briefs: Record<string, BriefItem[]> = {
  'CASE-A': [
    { id: 'a1', topics: ['technologie'], group: 'Anlass', figure: '−4.2%', text: 'diesen Monat. 3.1 Punkte davon aus drei US-Technologietiteln.', source: 'Performancebeitrag', severity: 'risk' },
    { id: 'a2', topics: ['technologie', 'klumpen'], group: 'Positionen', figure: '34%', text: 'US-Technologie in 5 Positionen, grösster Einzeltitel 13.4%.', source: 'Positionen', severity: 'warn' },
    { id: 'a3', topics: ['dollar'], group: 'Positionen', figure: '61%', text: 'USD-Anteil, 11 Punkte über dem Mandatsband.', source: 'SAA-Währungsband', severity: 'risk' },
    { id: 'a4', topics: ['nachhaltig', 'technologie'], group: 'Verlauf', text: 'Will die Technologie ausbauen, wünscht mehr nachhaltige Fonds.', source: 'Kundennotizen 02.09. und 19.08.2026', severity: 'info' },
    { id: 'a5', topics: ['nachhaltig'], group: 'Verlauf', text: 'ESG-Aufteilung zugesagt, seit 26.08.2026 überfällig.', source: 'Gespräch 19.08.2026', severity: 'warn' },
    { id: 'a6', topics: ['technologie'], group: 'Frühere Fälle', figure: '−3.8%', text: 'im Okt. 2023, ebenfalls Technologie. Kunde hielt, nach 4 Monaten wieder auf Vorniveau.', source: 'Eigener Wertverlauf (Beispiel)', severity: 'info' },
    { id: 'a7', topics: ['dollar', 'klumpen'], group: 'Vorschlag', figure: "CHF 136'000", text: 'USD/CHF absichern statt verkaufen: USD-Anteil 61% → 50%.', source: 'Anlagevorschlag (Entwurf)', severity: 'ok' },
  ],
  'CASE-B': [
    { id: 'b1', topics: ['rueckstand'], group: 'Anlass', figure: '−1.4', text: 'Punkte hinter der Zielallokation im letzten Quartal.', source: 'Performancebeitrag', severity: 'warn' },
    { id: 'b2', topics: ['europa', 'rueckstand'], group: 'Positionen', figure: '−7', text: 'Punkte Untergewicht in europäischen Aktien, 9% Liquidität.', source: 'SAA-Länderband', severity: 'warn' },
    { id: 'b3', topics: ['rueckstand'], group: 'Verlauf', text: 'Wartet auf den Benchmark-Vergleich, will alles schriftlich.', source: 'Kundennotiz 10.09.2026', severity: 'info' },
    { id: 'b4', topics: ['rueckstand'], group: 'Frühere Fälle', text: 'Obligationen senken wurde abgelehnt: will den laufenden Ertrag behalten.', source: 'Gesprächsnotiz', severity: 'warn' },
    { id: 'b5', topics: ['europa', 'nachhaltig'], group: 'Vorschlag', figure: '+5', text: 'Punkte Liquidität in einen Europa-Fonds, passt zur Hausmeinung.', source: 'CIO-Sicht (Beispiel)', severity: 'ok' },
  ],
  'CASE-C': [
    { id: 'c1', topics: ['immobilie'], group: 'Anlass', text: 'Plant einen Immobilienkauf, Liquidität innert 12 Monaten nötig.', source: 'Kundennotiz 03.07.2026', severity: 'warn' },
    { id: 'c2', topics: ['fonds'], group: 'Positionen', figure: '12%', text: 'Obligationenfonds über der Risikogrenze des Profils.', source: 'Regelverletzung', severity: 'risk' },
    { id: 'c3', topics: ['immobilie'], group: 'Positionen', figure: '6%', text: 'Liquidität, reicht für eine Anzahlung nicht.', source: 'Konten', severity: 'warn' },
    { id: 'c4', topics: ['fonds', 'immobilie'], group: 'Verlauf', figure: '1/5', text: 'Vorschlägen umgesetzt. Seit dem letzten Rückgang sehr risikoscheu.', source: 'Vorschläge, Notiz 23.06.2026', severity: 'warn' },
    { id: 'c5', topics: ['immobilie'], group: 'Frühere Fälle', text: 'Nach dem Rückgang 2022 verkaufte der Kunde am Tiefpunkt: jetzt Ruhe und Kapitalerhalt betonen.', source: 'Transaktionen (Beispiel)', severity: 'info' },
    { id: 'c6', topics: ['fonds', 'immobilie'], group: 'Vorschlag', text: 'Fonds verkaufen, Erlös im Geldmarkt parkieren bis zum Kauf.', source: 'Nächste Schritte', severity: 'ok' },
  ],
}
