// The case file names suitability rules in English. For the German interface the finite set of rule
// texts is translated here, deterministically. Unknown texts pass through unchanged, and in English
// the data's own wording is the answer.
import type { Lang } from '../../engine/lang.ts'

const NAMES: Record<string, string> = {
  Energy: 'Energie', Financials: 'Finanzwesen', 'Health Care': 'Gesundheit', Healthcare: 'Gesundheit', Industrials: 'Industrie', Materials: 'Grundstoffe',
  'Information Technology': 'Informationstechnologie', Technology: 'Technologie', 'Consumer Staples': 'Basiskonsum', 'Consumer Discretionary': 'Nicht-Basiskonsum',
  'Communication Services': 'Kommunikation', Utilities: 'Versorger', 'Real Estate': 'Immobilien',
  Switzerland: 'Schweiz', Europe: 'Europa', 'North America': 'Nordamerika', USA: 'USA', Japan: 'Japan', 'Emerging Markets': 'Schwellenländer', 'Asia Pacific': 'Asien-Pazifik', Pacific: 'Pazifik',
}

const FIXED: Record<string, string> = {
  'Cluster risk of a single financial instrument': 'Klumpenrisiko bei einem einzelnen Finanzinstrument',
  'Volatility range undershot (portfolio risk too low)': 'Volatilitätsband unterschritten (Portfoliorisiko zu tief)',
  'Volatility range exceeded (portfolio risk too high)': 'Volatilitätsband überschritten (Portfoliorisiko zu hoch)',
  'Compliance with maximum volatility': 'Maximale Volatilität nicht eingehalten',
  'Share is not part of the investment universe for individual shares and therefore not monitored.': 'Aktie ist nicht Teil des Anlageuniversums für Einzeltitel und wird nicht überwacht',
  'Foreign currency exposure exceeds 50%': 'Fremdwährungsanteil über 50%',
  'Minimum limit shares': 'Mindestquote Aktien unterschritten',
  'Minimum limit fixed income': 'Mindestquote Obligationen unterschritten',
  'Maximum limit liquidity': 'Höchstquote Liquidität überschritten',
  'Knowledge of structured products': 'Kenntnisse zu strukturierten Produkten fehlen',
  'Knowledge of portfolio funds and mixed funds': 'Kenntnisse zu Portfolio- und Mischfonds fehlen',
}

export function ruleText(text: string, lang?: Lang): string {
  if (lang === 'en') return text
  if (FIXED[text]) return FIXED[text]
  const weight = /^(Significant )?(over|under)weight in the equity (sector|region) "(.+)"$/i.exec(text)
  if (weight) return `${weight[1] ? 'Deutliches ' : ''}${weight[2].toLowerCase() === 'over' ? 'Übergewicht' : 'Untergewicht'} ${weight[3].toLowerCase() === 'sector' ? 'im Aktiensektor' : 'in der Aktienregion'} «${NAMES[weight[4]] ?? weight[4]}»`
  const currency = /^Foreign currency cluster risk ([A-Z]{3})$/.exec(text)
  if (currency) return `Klumpenrisiko Fremdwährung ${currency[1]}`
  return text
}
