// The language everything the engine phrases comes out in. English is the app's default; the advisor can
// switch to German. Inside the engine the default stays German ('de' when ctx.lang is absent), so stored
// findings and the existing tests keep their wording. The server passes the advisor's language in.
//
// Numbers, dates and amounts are formatted the same in both languages (Swiss style: 80'000, 23.9%,
// 14.10.2026): the grounding check compares numbers literally, and a client file does not change with the
// display language. Quotes from the data (notes, rule names, security names) are never translated.

export type Lang = 'de' | 'en'

export const langOf = (value: unknown): Lang => (value === 'de' ? 'de' : 'en')

// const t = pick(ctx.lang); t('Klumpenrisiko', 'Cluster risk')
export const pick = (lang: Lang | undefined) => <T>(de: T, en: T): T => (lang === 'en' ? en : de)

type Pair = { de: string; en: string }

// Evidence source names. Code that looks for a kind of evidence uses isSource(), never the literal string,
// so it works in both languages.
export const SOURCES = {
  portfolio: { de: 'Portfolio', en: 'Portfolio' },
  history: { de: 'Wertentwicklung (Monatswerte)', en: 'Performance (monthly values)' },
  position: { de: 'Position', en: 'Position' },
  saa: { de: 'Strategische Asset Allocation', en: 'Strategic asset allocation' },
  riskProfile: { de: 'Risikoprofil', en: 'Risk profile' },
  violation: { de: 'Suitability-Verletzung', en: 'Suitability violation' },
  rule: { de: 'Suitability-Regel', en: 'Suitability rule' },
  ruleException: { de: 'Individuelle Regelausnahme', en: 'Individual rule exception' },
  proposal: { de: 'Anlagevorschlag', en: 'Investment proposal' },
  fix: { de: 'Vorschlag', en: 'Suggested fix' },
  security: { de: 'Wertschriften-Stammdaten', en: 'Security master data' },
  note: { de: 'Kundennotiz', en: 'Client note' },
  clientFile: { de: 'Kundendatei', en: 'Client file' },
  callNote: { de: 'Gesprächsnotiz', en: 'Call note' },
  esg: { de: 'ESG-Profil', en: 'ESG profile' },
  peers: { de: 'Vergleichsgruppe (aggregiert)', en: 'Peer group (aggregated)' },
  exCustody: { de: 'Fremddepot (Auszug)', en: 'External custody account (statement)' },
  accounts: { de: 'Konten', en: 'Accounts' },
  lookThrough: { de: 'Fonds-Durchsicht', en: 'Fund look-through' },
  houseView: { de: 'Hausmeinung (Beispiel)', en: 'House view (example)' },
  recommendations: { de: 'Empfehlungsliste', en: 'Recommendation list' },
  strategy: { de: 'Anlagestrategie', en: 'Investment strategy' },
  clientTrait: { de: 'Kundenmerkmal', en: 'Client attribute' },
} as const satisfies Record<string, Pair>

export type SourceKey = keyof typeof SOURCES
export const sourceName = (key: SourceKey, lang?: Lang): string => SOURCES[key][lang === 'en' ? 'en' : 'de']
export const isSource = (source: string | undefined, key: SourceKey): boolean => source === SOURCES[key].de || source === SOURCES[key].en

// Title prefixes that other code reads (briefing composer, cards, call plan, UI). A check builds its title
// with prefix(), a reader takes it off with stripPrefix(). Both languages are recognised when reading.
export const PREFIXES = {
  contradiction: { de: 'Widerspruch: ', en: 'Contradiction: ' },
  opportunity: { de: 'Chance: ', en: 'Opportunity: ' },
  tone: { de: 'Ton: ', en: 'Tone: ' },
  outdated: { de: 'Veraltet: ', en: 'Outdated: ' },
  promised: { de: 'Zugesagt: ', en: 'Promised: ' },
  openFromCall: { de: 'Offen aus dem letzten Gespräch: ', en: 'Open from the last call: ' },
  wish: { de: 'Wunsch ', en: 'Wish ' },
  interest: { de: 'Interesse ', en: 'Interest ' },
  draft: { de: 'Offener Entwurf: ', en: 'Open draft: ' },
} as const satisfies Record<string, Pair>

export type PrefixKey = keyof typeof PREFIXES
export const prefix = (key: PrefixKey, lang?: Lang): string => PREFIXES[key][lang === 'en' ? 'en' : 'de']
export const hasPrefix = (title: string, key: PrefixKey): boolean => title.startsWith(PREFIXES[key].de) || title.startsWith(PREFIXES[key].en)
export function stripPrefix(title: string, key: PrefixKey): string {
  const { de, en } = PREFIXES[key]
  return title.startsWith(de) ? title.slice(de.length) : title.startsWith(en) ? title.slice(en.length) : title
}

// A rejected proposal's title, read by the briefing composer: 'Abgelehnt vom 20.08.2024: «Reason»' /
// 'Rejected on 20.08.2024: «Reason»'. The date part is optional.
export const rejectedTitle = (date: string | undefined, reason: string, lang?: Lang): string =>
  lang === 'en' ? `Rejected${date ? ` on ${date}` : ''}: «${reason}»` : `Abgelehnt${date ? ` vom ${date}` : ''}: «${reason}»`
export const REJECTED_TITLE = /^(?:Abgelehnt|Rejected)(?: (?:vom|on) (\d{2})\.(\d{2})\.(\d{4}))?: «(.+)»/
