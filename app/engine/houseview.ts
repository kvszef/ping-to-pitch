// The bank's investment view (CIO house view) as data the engine can compare portfolios against.
//
// The case data has no house view, so this is an EXAMPLE, labelled as such everywhere it shows. In a bank the
// same shape is filled from the CIO's monthly publication (e.g. read from the house-view PDF with the same
// import path as ex-custody statements) and passed in as ctx.houseView; nothing else changes.
//
// Stances use the SAA taxonomy of reference.json, so they line up with the targets and the fund look-through:
// asset classes of the whole portfolio, regions and sectors within the equity part, currency groups.
import type { Dimension } from './data.ts'

export type Rating = -2 | -1 | 0 | 1 | 2
export type Stance = {
  dimension: Dimension | 'Style' // 'Style' (e.g. quality) is shown, but the data has no factor to measure it
  category: string // SAA category name, e.g. 'Rest of Europe', 'Health Care', 'US-Dollar'
  label: string // German, for the screen
  rating: Rating
  why: string // the CIO's one-line reason, German
  action?: string // what the stance means for a portfolio, German, e.g. 'absichern'
}
export type HouseView = { id: string; title: string; date: string; author: string; example: boolean; summary: string; stances: Stance[] }

export const ratingDe = (r: Rating) => (r >= 2 ? 'stark übergewichten' : r === 1 ? 'übergewichten' : r === 0 ? 'neutral' : r === -1 ? 'untergewichten' : 'stark untergewichten')
export const ratingShort = (r: Rating) => (r > 0 ? `+${r}` : String(r))

// Example view. Written to fit the brief's scenarios: quality overweight, Europe positive, US tech neutral,
// USD sleeve to be hedged. Dated like the case data (the demo date is 19.09.2026).
export const EXAMPLE_HOUSE_VIEW: HouseView = {
  id: 'beispiel-2026-09',
  title: 'Hausmeinung September 2026',
  date: '2026-09-15',
  author: 'CIO-Büro (Beispiel)',
  example: true,
  summary: 'Qualität vor Wachstum: Schweizer und europäische Qualitätsaktien übergewichten, US-Technologie neutral, Dollar-Risiko absichern, Obligationen wieder attraktiv.',
  stances: [
    { dimension: 'Style', category: 'Quality', label: 'Qualitätsaktien', rating: 2, why: 'Stabile Margen und tiefe Verschuldung sind in einem langsameren Wachstum gefragt.' },
    { dimension: 'AssetClass', category: 'Shares', label: 'Aktien', rating: 0, why: 'Gewinne robust, Bewertungen nach der Erholung aber voll.' },
    { dimension: 'AssetClass', category: 'Bonds', label: 'Obligationen', rating: 1, why: 'Renditen nach dem Anstieg wieder attraktiv, Duration schützt bei einer Abkühlung.' },
    { dimension: 'AssetClass', category: 'Liquidity', label: 'Liquidität', rating: -1, why: 'Tiefe Frankenzinsen: überschüssige Liquidität kostet Rendite.', action: 'investieren' },
    { dimension: 'AssetClass', category: 'Real estate', label: 'Immobilien Schweiz', rating: 1, why: 'Zinsniveau und Nachfrage stützen indirekte Schweizer Immobilienanlagen.' },
    { dimension: 'CountryGroup', category: 'Switzerland', label: 'Aktien Schweiz', rating: 1, why: 'Defensive Qualitätstitel, tiefe Bewertungsrisiken, Heimwährung.' },
    { dimension: 'CountryGroup', category: 'Rest of Europe', label: 'Aktien Europa', rating: 1, why: 'Bewertungsabschlag zu den USA bei sich aufhellenden Gewinnaussichten.' },
    { dimension: 'CountryGroup', category: 'North America', label: 'Aktien USA', rating: 0, why: 'Starke Gewinne, aber hohe Bewertung und Konzentration in wenigen Technologietiteln.' },
    { dimension: 'CountryGroup', category: 'Others', label: 'Schwellenländer', rating: -1, why: 'Stärkerer Dollar und schwächerer Welthandel belasten.', action: 'reduzieren' },
    { dimension: 'Industry', category: 'Health Care', label: 'Gesundheit', rating: 1, why: 'Defensive Qualität mit verlässlichen Erträgen, günstig bewertet.' },
    { dimension: 'Industry', category: 'Consumer Staples', label: 'Basiskonsum', rating: 1, why: 'Preissetzungsmacht und stabile Nachfrage in einer Abkühlung.' },
    { dimension: 'Industry', category: 'Information Technology', label: 'Informationstechnologie', rating: 0, why: 'Nach der Rally neutral: Qualität halten, Konzentration abbauen.' },
    { dimension: 'Industry', category: 'Energy', label: 'Energie', rating: -1, why: 'Schwächere Nachfrage und Überangebot drücken auf die Preise.', action: 'reduzieren' },
    { dimension: 'CurrencyGroup', category: 'US-Dollar', label: 'US-Dollar', rating: -1, why: 'Zinsvorteil schrumpft, der Franken bleibt gefragt: Dollar-Anteile über dem Ziel absichern.', action: 'absichern' },
    { dimension: 'CurrencyGroup', category: 'Euro', label: 'Euro', rating: 0, why: 'Seitwärts zum Franken erwartet.' },
  ],
}
