// Reads the advisor's free-text client notes. The case data uses a fixed set of English sentences,
// so every known one is classified and rendered in German here (and in English: `en`, `avoidEn`, `labelEn`,
// read through noteText/noteAvoid/noteLabel). An unknown note is never dropped and never guessed at: it stays
// `other` and is shown as the original quote.

import type { Lang } from '../../engine/lang.ts'

export type NoteCategory =
  | 'exclusion' // client does not want something in the portfolio
  | 'contact' // how and when to reach the client
  | 'temperament' // how the client thinks and decides
  | 'interest' // something the client would like more of
  | 'plan' // a life event or plan, possibly with a deadline
  | 'request' // something the client asked to get at the next meeting: an open promise
  | 'context' // background worth knowing
  | 'other'

export type Exclusion = 'fossil' | 'fossil-direct' | 'emerging-markets' | 'defense-tobacco' | 'human-rights'

export type NoteRule = {
  re: RegExp
  category: NoteCategory
  de: string // German summary for the advisor, third person
  en?: string // the same in English; absent (plans, unknown notes): the original quote is shown
  avoidEn?: string
  labelEn?: string
  exclusion?: Exclusion
  horizonMonths?: number // the plan runs out this many months after the note was written
  topic?: string
  avoid?: string // what the advisor should not do because of this note
  question?: string // what to ask when the note may be outdated
  label?: string // short name of a plan or request, e.g. 'Pensionierung'
  accusative?: string // the same with its possessive, for a sentence to the client: 'Ihre Pensionierung'
}

export const NOTE_RULES: NoteRule[] = [
  // exclusions
  { re: /no direct positions in fossil fuels/i, category: 'exclusion', exclusion: 'fossil-direct', de: 'Keine direkten Positionen in fossilen Energien', en: 'No direct positions in fossil fuels', topic: 'esg' },
  { re: /avoid any exposure to fossil-fuel/i, category: 'exclusion', exclusion: 'fossil', de: 'Kein Engagement in fossilen Energien', en: 'No exposure to fossil fuels', topic: 'esg' },
  { re: /developed markets only|no emerging markets/i, category: 'exclusion', exclusion: 'emerging-markets', de: 'Nur Industrieländer, keine Schwellenländer', en: 'Developed markets only, no emerging markets', topic: 'region' },
  { re: /no defense or tobacco/i, category: 'exclusion', exclusion: 'defense-tobacco', de: 'ESG-konform, keine Rüstung und kein Tabak', en: 'ESG-compliant, no defence and no tobacco', topic: 'esg' },
  { re: /human-rights controversies/i, category: 'exclusion', exclusion: 'human-rights', de: 'Keine Firmen mit Menschenrechts-Kontroversen', en: 'No companies with human-rights controversies', topic: 'esg' },
  // contact
  { re: /prefers email communication/i, category: 'contact', de: 'Bevorzugt E-Mail, telefonisch schwer erreichbar', en: 'Prefers email, hard to reach by phone', avoid: 'Kein langes Telefonat: kurz halten und die Details per E-Mail nachreichen', avoidEn: 'No long phone call: keep it short and send the details by email afterwards', topic: 'contact' },
  { re: /best contacted after 6pm/i, category: 'contact', de: 'Tagsüber schwer erreichbar, am besten nach 18 Uhr', en: 'Hard to reach during the day, best after 6 pm', topic: 'contact' },
  { re: /not to be contacted during business hours/i, category: 'contact', de: 'Werktags während der Bürozeiten nicht kontaktieren', en: 'Do not contact on weekdays during business hours', topic: 'contact' },
  { re: /semi-annual phone contact/i, category: 'contact', de: 'Telefonkontakt halbjährlich, keine unangemeldeten Besuche', en: 'Phone contact twice a year, no unannounced visits', avoid: 'Keinen Besuch vorschlagen', avoidEn: 'Do not suggest a visit', topic: 'contact' },
  { re: /detailed written summary after every meeting/i, category: 'contact', de: 'Wünscht nach jedem Gespräch eine ausführliche schriftliche Zusammenfassung', en: 'Wants a detailed written summary after every meeting', topic: 'contact' },
  { re: /minimal written correspondence/i, category: 'contact', de: 'Diskret: möglichst wenig Schriftliches zu Portfoliodetails', en: 'Discreet: as little as possible in writing about portfolio details', avoid: 'Keine Portfoliodetails schriftlich zusenden', avoidEn: 'Do not send portfolio details in writing', topic: 'contact' },
  { re: /follow-up call before any changes to the standing order/i, category: 'contact', de: 'Vor jeder Änderung am Dauerauftrag einen Rückruf', en: 'A call back before any change to the standing order', avoid: 'Den Dauerauftrag nicht im selben Gespräch ändern, zuerst Rückruf vereinbaren', avoidEn: 'Do not change the standing order in the same call, agree a call back first', topic: 'contact' },
  // temperament
  { re: /extremely patient investor/i, category: 'temperament', de: 'Sehr geduldig, kurzfristige Schwankungen sind kein Thema', en: 'Very patient, short-term swings are not a concern' },
  { re: /philosophical answers/i, category: 'temperament', de: 'Antwortet bei Risikofragen überlegt, fast philosophisch', en: 'Answers risk questions thoughtfully, almost philosophically' },
  { re: /simple, disciplined strategy/i, category: 'temperament', de: 'Will eine einfache, disziplinierte Strategie statt häufiger Anpassungen', en: 'Wants a simple, disciplined strategy rather than frequent adjustments', avoid: 'Keine kleinteiligen Umschichtungen vorschlagen', avoidEn: 'Do not propose small piecemeal reshuffles' },
  { re: /much to learn, the markets still have/i, category: 'temperament', de: 'Nimmt Marktschwankungen gelassen und mit Humor', en: 'Takes market swings calmly and with humour' },
  { re: /very risk-averse since the last market downturn/i, category: 'temperament', de: 'Seit dem letzten Einbruch sehr risikoscheu, bevorzugt defensive Anlagen', en: 'Very risk-averse since the last downturn, prefers defensive investments', avoid: 'Keine Erhöhung des Aktienanteils vorschlagen', avoidEn: 'Do not propose a higher equity share' },
  { re: /comfortable with higher volatility given a long time horizon/i, category: 'temperament', de: 'Akzeptiert höhere Schwankungen dank langem Anlagehorizont', en: 'Accepts higher swings thanks to a long investment horizon' },
  { re: /comfortable with high concentration risk/i, category: 'temperament', de: 'Akzeptiert hohe Klumpenrisiken und starke Schwankungen, auch bei Digitalwerten', en: 'Accepts high cluster risks and strong swings, including in digital assets' },
  { re: /politely declines most proposals/i, category: 'temperament', de: 'Entscheidet selbst und lehnt die meisten Vorschläge höflich ab', en: 'Decides alone and politely declines most proposals', avoid: 'Keine fertige Empfehlung präsentieren, lieber zwei Optionen zur Wahl', avoidEn: 'Do not present a finished recommendation, rather two options to choose from' },
  { re: /forward-looking, high-conviction/i, category: 'temperament', de: 'Bevorzugt zukunftsgerichtete Überzeugungspositionen statt defensiver Anlagen', en: 'Prefers forward-looking, high-conviction positions over defensive investments' },
  { re: /not concerned by short-term volatility in thematic/i, category: 'temperament', de: 'Langer Horizont, Schwankungen bei Themenanlagen sind kein Thema', en: 'Long horizon, swings in thematic investments are not a concern' },
  { re: /risk profile discussed again after the market downturn/i, category: 'temperament', de: 'Risikoprofil nach dem Einbruch besprochen, Einstufung bleibt', en: 'Risk profile discussed after the downturn, classification stays' },
  { re: /informed of the risks of structured products/i, category: 'context', de: 'Über Risiken strukturierter Produkte informiert und akzeptiert sie', en: 'Informed about the risks of structured products and accepts them' },
  { re: /open to increasing the equity allocation/i, category: 'interest', de: 'Offen für mehr Aktien, wenn die Märkte stabil bleiben', en: 'Open to more equities if markets stay stable', topic: 'allocation' },
  // interests
  { re: /high-dividend stocks/i, category: 'interest', de: 'Wünscht Fokus auf Dividendentitel für laufendes Einkommen', en: 'Wants a focus on dividend stocks for regular income', topic: 'income' },
  { re: /high a weighting of sustainable funds/i, category: 'interest', de: 'Beim nächsten Rebalancing möglichst viele nachhaltige Fonds', en: 'As many sustainable funds as possible at the next rebalancing', topic: 'esg' },
  { re: /swiss small caps/i, category: 'interest', de: 'Will stärker in Schweizer Nebenwerte investieren', en: 'Wants to invest more in Swiss small caps', topic: 'allocation' },
  { re: /chf-hedged investments/i, category: 'interest', de: 'Fremdwährungen bevorzugt CHF-abgesichert', en: 'Prefers foreign currencies hedged into CHF', topic: 'currency' },
  { re: /technology stocks in the portfolio closely/i, category: 'interest', de: 'Beobachtet die Technologietitel genau, möchte ausbauen', en: 'Watches the technology stocks closely, would like to add', topic: 'allocation' },
  { re: /space travel|spaceflight/i, category: 'interest', de: 'Begeistert von privater Raumfahrt, fragt nach mehr Luft- und Raumfahrt', en: 'Enthusiastic about private spaceflight, asks about more aerospace', topic: 'allocation' },
  { re: /structured products, initial consultation/i, category: 'interest', de: 'Interessiert an strukturierten Produkten, Erstgespräch bereits geführt', en: 'Interested in structured products, first conversation already held', topic: 'products' },
  { re: /broader diversification across currencies/i, category: 'interest', de: 'Wünscht breitere Streuung über Währungen', en: 'Wants broader diversification across currencies', topic: 'currency' },
  { re: /consolidating multiple accounts/i, category: 'interest', de: 'Möchte mehrere Konten zusammenlegen', en: 'Would like to consolidate several accounts', topic: 'accounts' },
  { re: /chemistry and the pharmaceutical/i, category: 'context', de: 'Früher Lehrtätigkeit in Chemie, interessiert sich für Chemie und Pharma', en: 'Used to teach chemistry, interested in chemicals and pharma' },
  { re: /car-wash/i, category: 'context', de: 'Führt nebenbei eine Autowaschanlage, fragt gelegentlich nach der Anlage der Erträge', en: 'Runs a car wash on the side, occasionally asks about investing the proceeds' },
  { re: /settle smaller amounts in cash/i, category: 'context', de: 'Begleicht kleinere Beträge gerne bar', en: 'Likes to settle smaller amounts in cash' },
  // plans and life events
  { re: /buy a property, possible liquidity need within the next 12 months/i, label: 'Immobilienkauf', accusative: 'Ihren Immobilienkauf', category: 'plan', horizonMonths: 12, de: 'Plant einen Immobilienkauf, Liquiditätsbedarf innert 12 Monaten', question: 'Ist Ihr Immobilienkauf inzwischen erfolgt, oder ist er noch geplant?', topic: 'liquidity' },
  { re: /retire in the next two years/i, label: 'Pensionierung', accusative: 'Ihre Pensionierung', category: 'plan', horizonMonths: 24, de: 'Pensionierung in den nächsten zwei Jahren, steigender Liquiditätsbedarf', question: 'Steht Ihr Pensionierungsdatum fest, und wie viel Liquidität brauchen Sie dann?', topic: 'liquidity' },
  { re: /CHF 15,000 in liquid funds for the Q1 tax/i, label: 'Steuerzahlung', accusative: 'Ihre Steuerzahlung', category: 'plan', horizonMonths: 6, de: 'Braucht rund CHF 15\'000 flüssig für die Steuerzahlung im ersten Quartal', question: 'Ist die Steuerzahlung erledigt, oder brauchen Sie die CHF 15\'000 noch?', topic: 'liquidity' },
  { re: /change of address next year/i, label: 'Adresswechsel', accusative: 'Ihren Adresswechsel', category: 'plan', horizonMonths: 18, de: 'Möglicher Adresswechsel, Kontoangaben dann bestätigen', question: 'Hat sich Ihre Adresse inzwischen geändert?', topic: 'admin' },
  { re: /expects an inheritance/i, label: 'Erbe', accusative: 'das erwartete Erbe', category: 'plan', de: 'Erwartet ein Erbe, Strategie dann überprüfen', question: 'Gibt es beim erwarteten Erbe etwas Neues?', topic: 'strategy' },
  { re: /charitable donation/i, label: 'Spende', accusative: 'die geplante Spende', category: 'plan', de: 'Erwägt eine Spende aus dem Portfolio, Details offen', question: 'Ist die Spende aus dem Portfolio noch ein Thema für Sie?', topic: 'liquidity' },
  { re: /health concerns .* estate and succession/i, label: 'Nachlassplanung', accusative: 'Ihre Nachlassplanung', category: 'plan', de: 'Gesundheitliche Gründe: Nachlass- und Nachfolgeplanung wird überprüft', question: 'Wie weit ist Ihre Nachlassplanung?', topic: 'estate' },
  { re: /succession planning within the company/i, label: 'Nachfolge im Unternehmen', accusative: 'die Nachfolge im Unternehmen', category: 'plan', de: 'Nachfolgeregelung im Unternehmen läuft, Ansprechperson kann wechseln', question: 'Sind Sie weiterhin unsere Ansprechperson?', topic: 'admin' },
  // requests for the next meeting: open promises
  { re: /comparison against the benchmark at the next review/i, label: 'Vergleich mit der Benchmark', labelEn: 'Comparison with the benchmark', category: 'request', de: 'Wünscht beim nächsten Gespräch einen Vergleich mit der Benchmark', en: 'Wants a comparison with the benchmark at the next meeting', topic: 'performance' },
  { re: /detail on transaction fees at the next meeting/i, label: 'Details zu den Transaktionsgebühren', labelEn: 'Details on the transaction fees', category: 'request', de: 'Wünscht beim nächsten Gespräch Details zu den Transaktionsgebühren', en: 'Wants details on the transaction fees at the next meeting', topic: 'fees' },
  // context
  { re: /power of attorney/i, category: 'context', de: 'Verwaltet mit Vollmacht auch das Portfolio eines Familienmitglieds', en: 'Also manages the portfolio of a family member under a power of attorney' },
  { re: /cash reserve on hand for unexpected medical/i, category: 'context', de: 'Will eine Barreserve für unerwartete Arztkosten halten', en: 'Wants to keep a cash reserve for unexpected medical costs', topic: 'liquidity' },
  { re: /small reserve on hand at all times/i, category: 'context', de: 'Will stets eine kleine Reserve halten, «für alle Fälle»', en: 'Wants to keep a small reserve at all times, «just in case»', topic: 'liquidity' },
  { re: /annual review meeting held, no change/i, category: 'context', de: 'Jahresgespräch geführt, keine Strategieänderung gewünscht', en: 'Annual review held, no change of strategy wanted' },
  { re: /long-time small holder, self-directed/i, category: 'context', de: 'Langjährig und selbstbestimmt, kam nach mehreren Banken hierher', en: 'Long-standing and self-directed, came here after several other banks' },
]

export type ReadNote = NoteRule & { quote: string; date: string }

/** Classifies one note. Unknown notes come back as `other` with the original text. */
export function readNote(quote: string, date: string): ReadNote {
  const rule = NOTE_RULES.find((r) => r.re.test(quote))
  return rule ? { ...rule, quote, date } : { re: /$^/, category: 'other', de: quote, quote, date }
}

/** Adds whole months to an ISO date, UTC. */
export function addMonths(iso: string, months: number): Date {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

/** Full months between two dates, rounded down, never negative. */
export function monthsBetween(from: Date, to: Date): number {
  const m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth() - (to.getUTCDate() < from.getUTCDate() ? 1 : 0)
  return Math.max(0, m)
}

// The advisor-facing texts of a note in the display language (German when absent).
export const noteText = (n: ReadNote, lang?: Lang) => (lang === 'en' ? n.en ?? n.quote : n.de)
export const noteAvoid = (n: ReadNote, lang?: Lang) => (lang === 'en' ? n.avoidEn ?? n.avoid : n.avoid)
export const noteLabel = (n: ReadNote, lang?: Lang) => (lang === 'en' ? n.labelEn ?? n.label : n.label)

// The title of an open client wish (memory.promise), and the prefix its readers take off (briefing composer, todos card).
export const openWishTitle = (date: string, what: string, lang?: Lang) => (lang === 'en' ? `Open wish since ${date}: ${what}` : `Offener Wunsch seit ${date}: ${what}`)
export const OPEN_WISH_PREFIX = /^(?:Offener Wunsch seit|Open wish since) [^:]+: /

/** 'Pensionierung' → 'Ihre Pensionierung', for a sentence to the client. Unknown labels come back unchanged. German grammar only: English says 'your <label>'. */
export const accusativeOf = (label: string) => NOTE_RULES.find((r) => r.label === label)?.accusative ?? label
