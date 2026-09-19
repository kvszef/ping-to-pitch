// Formatting for finding titles (Swiss style in both languages: 80'000, 23.9%, 14.10.2026). Raw numbers go in Finding.numbers.
// Functions that produce words take the language as their last argument; without it they answer in German.
import type { Lang } from './lang.ts'

export const pct = (fraction: number, digits = 1) => `${(fraction * 100).toFixed(digits)}%`
export const pts = (fraction: number, lang?: Lang) => `${fraction >= 0 ? '+' : '−'}${Math.abs(fraction * 100).toFixed(1)} ${lang === 'en' ? 'pp' : 'Pp.'}`
export const signedPct = (fraction: number) => `${fraction >= 0 ? '+' : '−'}${Math.abs(fraction * 100).toFixed(1)}%`
export const chf = (amount: number, currency = 'CHF') => `${currency} ${Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'")}`
export const dateCh = (iso: string | undefined, lang?: Lang) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : lang === 'en' ? 'unknown' : 'unbekannt')

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthCh = (iso: string, lang?: Lang) => `${(lang === 'en' ? MONTHS_EN : MONTHS)[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`.trim()

// SAA category names (English in the data) → German for the advisor.
const CATEGORY: Record<string, string> = {
  Shares: 'Aktien', Bonds: 'Obligationen', Liquidity: 'Liquidität', 'Real estate': 'Immobilien', 'Specialties andCommodities': 'Alternative Anlagen und Rohstoffe',
  'Swiss francs': 'CHF', 'US-Dollar': 'USD', Euro: 'EUR', Andere: 'Andere Währungen',
  Switzerland: 'Schweiz', 'Rest of Europe': 'Übriges Europa', 'Great Britain': 'Grossbritannien', 'North America': 'Nordamerika',
  'Asia/Pacific (ex Japan)': 'Asien/Pazifik (ohne Japan)', Japan: 'Japan', Others: 'Übrige Länder', 'Not classified': 'Nicht klassifiziert',
  Energy: 'Energie', Materials: 'Grundstoffe', Industrials: 'Industrie', 'Consumer Discretionary': 'Nicht-Basiskonsum', 'Consumer Staples': 'Basiskonsum',
  'Health Care': 'Gesundheit', Financials: 'Finanzwesen', 'Information Technology': 'Informationstechnologie',
  'Telecommunication Services': 'Kommunikation', Utilities: 'Versorger', 'Real Estate': 'Immobilien',
}
export const categoryDe = (category: string) => CATEGORY[category] ?? category
// The data's own category names are English already; only the odd ones are tidied for the advisor.
const CATEGORY_EN: Record<string, string> = {
  'Specialties andCommodities': 'Alternatives and commodities', 'Swiss francs': 'CHF', 'US-Dollar': 'USD', Euro: 'EUR', Andere: 'Other currencies',
  Others: 'Other countries', 'Telecommunication Services': 'Communication services',
}
export const categoryName = (category: string, lang?: Lang) => (lang === 'en' ? CATEGORY_EN[category] ?? category : categoryDe(category))

// Security names lead with the share class ("Namen-Aktie UBS Group AG", "Anteile -A- iShares ...").
export const shortName = (name: string) =>
  name.replace(/^(Namen-Aktien?|Inhaber-Aktien?|Aktien?|Anteile|Partizipationsscheine?|Genussscheine?)\s+(-[^-]+-\s+)?/i, '').replace(/\s+/g, ' ').slice(0, 60).trim() || name
