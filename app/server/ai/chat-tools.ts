// A4 ask-the-data chat: deterministic lookups over one raw client and the engine's reference index.
// The model only picks a tool and phrases the result; every number here is computed, rounded and
// labelled with its source, so the grounding check can verify each figure the model writes.
//
// Pure: no clock, no I/O. Null and absent both occur (list()/num()/str() from engine/data.ts).
// Joins on SecurityId, never ISIN. Unknown securities count as "nicht klassifiziert", never throw.
// Never reads client names, account names, IBANs or portfolio numbers: portfolios are "Portfolio 1..n".
//
// What the data can answer: holdings (direct, and by sector/region/currency through fund look-through),
// transactions (dated via their proposal), portfolio value history, cash and accounts.
// What it cannot: fees and costs (no field), the history of a single position (only portfolio totals),
// single companies inside funds (look-through has categories only), exact trade dates.

import { combinedHistory, isObj, list, num, readClient, str, type Dimension, type NavPoint, type Raw, type ReferenceIndex } from '../../engine/data.ts'
import { pick, type Lang } from '../../engine/lang.ts'

export type ToolName = 'holding' | 'transactions' | 'history' | 'cash'
export type ToolCall = { name: ToolName; args: Record<string, unknown> }
export type ToolResult = { name: ToolName; args: Record<string, unknown>; result: Record<string, unknown>; source: string }

// ── formatting: numbers go out pre-rounded so the model copies them instead of rounding itself ──

const pct = (fraction: number) => { const v = fraction * 100; return Math.abs(v) > 0 && Math.abs(v) < 0.1 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10 }
const money = (v: number) => Math.round(v)
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const tokens = (s: string) => norm(s).split(/[^\p{L}\p{N}&]+/u).filter(Boolean)

// "Anteile -USD- SSgA SPDR ETFs Europe II PLC - SPDR MSCI World Energy UCITS ETF" → "SPDR MSCI World Energy UCITS ETF"
export function shortName(name: string): string {
  const last = name.includes(' - ') ? name.slice(name.lastIndexOf(' - ') + 3) : name
  return last.replace(/^(Namen-Aktien?|Inhaber-Aktien?|Aktien?|Anteile|Partizipationsscheine?|Genussscheine?)\s+(-[^-]+-\s+)?/i, '').replace(/\s{2,}/g, ' ').trim() || name
}

const MONTHS_STOP = ['januar', 'februar', 'marz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember']
const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

// Words that never identify a security on their own.
const STOP = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'und', 'oder', 'von', 'vom', 'im', 'in', 'an', 'am', 'auf', 'aus', 'mit', 'fur', 'zu', 'bei', 'hat', 'haben', 'ist', 'sind', 'wie', 'viel', 'viele', 'welche', 'welcher', 'was', 'wann', 'wo', 'noch', 'uber', 'via',
  'kunde', 'kundin', 'kunden', 'anfang', 'ende', 'seit', 'jahr', 'monat', 'heute', 'zuletzt', ...MONTHS_STOP, 'portfolio', 'portfolios', 'depot', 'anteil', 'anteile', 'position', 'positionen', 'vermogen', 'aktie', 'aktien', 'fonds', 'etf', 'etfs', 'titel', 'bestand', 'wert', 'prozent', 'franken', 'geld', 'gehalten', 'halt', 'besitzt', 'investiert', 'direkt',
  // English question words (the advisor may ask in English)
  'how', 'much', 'many', 'does', 'did', 'do', 'client', 'clients', 'customer', 'hold', 'holds', 'held', 'own', 'owns', 'owned', 'have', 'has', 'had', 'what', 'which', 'when', 'where', 'who', 'and', 'for', 'with', 'from', 'since', 'year', 'month', 'today', 'last', 'latest', 'recently',
  'share', 'shares', 'stock', 'stocks', 'security', 'securities', 'funds', 'value', 'percent', 'money', 'assets', 'wealth', 'invested', 'directly', 'through', 'any', 'there', 'are', 'was', 'were', 'been', 'his', 'her', 'their', 'about', 'into', 'over', 'this', 'that', 'start', 'beginning', 'end', 'cash', 'performance', 'account', 'accounts', ...MONTHS_EN,
  'ag', 'sa', 'plc', 'inc', 'corp', 'corporation', 'holding', 'holdings', 'ltd', 'nv', 'se', 'sicav', 'ucits', 'fund', 'class', 'acc', 'dist', 'namen', 'inhaber', 'chf', 'usd', 'eur', 'the', 'of', 'ii', 'iv', 'vi', 'vii', 'ie', 'lu', 'ch',
])

// Advisor words for the SAA categories the look-through knows. Keys are normalised, matched as word prefixes.
const CATEGORIES: { words: string[]; dimension: Dimension; category: string; label: string; en: string }[] = [
  { words: ['energie', 'energy', 'ol', 'oel', 'erdol', 'erdoel', 'olsektor', 'oil'], dimension: 'Industry', category: 'Energy', label: 'Energie', en: 'Energy' },
  { words: ['technologie', 'tech', 'informationstechnologie', 'it-sektor', 'software', 'technology'], dimension: 'Industry', category: 'Information Technology', label: 'Informationstechnologie', en: 'Information technology' },
  { words: ['gesundheit', 'pharma', 'healthcare', 'gesundheitswesen', 'health'], dimension: 'Industry', category: 'Health Care', label: 'Gesundheit', en: 'Health care' },
  { words: ['finanz', 'finanzen', 'banken', 'finanzsektor', 'financials', 'versicherung', 'financial', 'banks', 'banking', 'insurance'], dimension: 'Industry', category: 'Financials', label: 'Finanzen', en: 'Financials' },
  { words: ['industrie', 'industrials', 'industriewerte', 'industrial'], dimension: 'Industry', category: 'Industrials', label: 'Industrie', en: 'Industrials' },
  { words: ['versorger', 'utilities', 'versorgungswerte'], dimension: 'Industry', category: 'Utilities', label: 'Versorger', en: 'Utilities' },
  { words: ['rohstoffe', 'rohstoff', 'materials', 'chemie', 'grundstoffe', 'chemicals'], dimension: 'Industry', category: 'Materials', label: 'Rohstoffe und Materialien', en: 'Materials' },
  { words: ['basiskonsum', 'nahrungsmittel', 'staples', 'food'], dimension: 'Industry', category: 'Consumer Staples', label: 'Basiskonsumgüter', en: 'Consumer staples' },
  { words: ['zyklischer', 'luxus', 'discretionary', 'konsumguter', 'luxury'], dimension: 'Industry', category: 'Consumer Discretionary', label: 'Zyklischer Konsum', en: 'Consumer discretionary' },
  { words: ['telekom', 'kommunikation', 'telecommunication', 'medien', 'telecom', 'media'], dimension: 'Industry', category: 'Telecommunication Services', label: 'Kommunikation', en: 'Communication services' },
  { words: ['immobiliensektor'], dimension: 'Industry', category: 'Real Estate', label: 'Immobiliensektor', en: 'Real estate sector' },
  { words: ['schweiz', 'schweizer', 'switzerland'], dimension: 'CountryGroup', category: 'Switzerland', label: 'Schweiz', en: 'Switzerland' },
  { words: ['usa', 'us-aktien', 'amerika', 'nordamerika', 'amerikanische', 'america'], dimension: 'CountryGroup', category: 'North America', label: 'Nordamerika', en: 'North America' },
  { words: ['europa', 'europaische', 'eurozone', 'europe', 'european'], dimension: 'CountryGroup', category: 'Rest of Europe', label: 'übriges Europa', en: 'rest of Europe' },
  { words: ['grossbritannien', 'uk', 'england', 'britische', 'britain', 'british'], dimension: 'CountryGroup', category: 'Great Britain', label: 'Grossbritannien', en: 'Great Britain' },
  { words: ['japan', 'japanische', 'japanese'], dimension: 'CountryGroup', category: 'Japan', label: 'Japan', en: 'Japan' },
  { words: ['asien', 'pazifik', 'asia', 'asian'], dimension: 'CountryGroup', category: 'Asia/Pacific (ex Japan)', label: 'Asien/Pazifik (ohne Japan)', en: 'Asia/Pacific (ex Japan)' },
  { words: ['schwellenlander', 'emerging', 'schwellenland'], dimension: 'CountryGroup', category: 'Others', label: 'übrige Länder inkl. Schwellenländer', en: 'other countries incl. emerging markets' },
  { words: ['dollar', 'us-dollar', 'usd'], dimension: 'CurrencyGroup', category: 'US-Dollar', label: 'US-Dollar', en: 'US dollar' },
  { words: ['euro', 'eur', 'euros'], dimension: 'CurrencyGroup', category: 'Euro', label: 'Euro', en: 'Euro' },
  { words: ['franken', 'chf', 'franc', 'francs'], dimension: 'CurrencyGroup', category: 'Swiss francs', label: 'Schweizer Franken', en: 'Swiss francs' },
  { words: ['obligationen', 'anleihen', 'bonds', 'obligation', 'anleihe', 'bond'], dimension: 'AssetClass', category: 'Bonds', label: 'Obligationen', en: 'Bonds' },
  { words: ['immobilien', 'immobilienfonds', 'estate', 'property'], dimension: 'AssetClass', category: 'Real estate', label: 'Immobilien', en: 'Real estate' },
  { words: ['rohstoffanlagen', 'gold', 'edelmetalle', 'alternative', 'commodities', 'commodity', 'metals'], dimension: 'AssetClass', category: 'Specialties andCommodities', label: 'Spezialanlagen und Rohstoffe', en: 'Specialties and commodities' },
]

function categoryFor(query: string) {
  const q = tokens(query)
  return CATEGORIES.find((c) => c.words.some((w) => q.some((t) => t === w || (w.length >= 5 && t.startsWith(w)))))
}

const CURRENCY_GROUP: Record<string, string> = { CHF: 'Swiss francs', USD: 'US-Dollar', EUR: 'Euro' }
const FIAT = new Set(['CHF', 'EUR', 'USD', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'CNY', 'PLN', 'CZK', 'HUF', 'ZAR', 'BRL', 'MXN', 'INR', 'TRY'])

// ── shared reading ───────────────────────────────────────────────────────────

type Pf = { label: string; raw: Raw; value: number; currency: string; strategy?: string }

function portfoliosOf(client: Raw): Pf[] {
  return list(client.Portfolios).map((p, i) => ({
    label: `Portfolio ${i + 1}`, raw: p, value: num(p.AssetsUnderManagementInDefaultCurrency) ?? 0,
    currency: str(p.PortfolioCurrency) ?? str(client.ReportingCurrency) ?? 'CHF', strategy: str(p.StrategyName),
  }))
}

const totalOf = (pfs: Pf[]) => pfs.reduce((a, p) => a + p.value, 0)
const reporting = (client: Raw) => str(client.ReportingCurrency) ?? 'CHF'

// True when every meaningful query token occurs in the name (as a word prefix), or the query is the ISIN.
function nameMatches(query: string, name: string, isin?: string) {
  if (isin && norm(query).replace(/\s/g, '') === norm(isin)) return true
  const q = tokens(query).filter((t) => t.length >= 3 && !STOP.has(t))
  if (!q.length) return false
  const n = tokens(name)
  return q.every((t) => n.some((w) => w.startsWith(t)))
}

// ── holding ──────────────────────────────────────────────────────────────────

/** How much of a security, issuer or category the client holds: direct and via funds, per portfolio and in total. */
export function holding(client: unknown, ref: ReferenceIndex, args: { query?: unknown }, lang?: Lang): ToolResult {
  const c: Raw = isObj(client) ? client : {}
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const pfs = portfoliosOf(c)
  const total = totalOf(pfs)
  const cur = reporting(c)
  const t = pick(lang)
  const source = t('Depotpositionen', 'Portfolio positions')
  if (!query) return { name: 'holding', args, source, result: { gehalten: false, hinweis: t('Keine Suchangabe (Titel, Emittent oder Kategorie) erhalten.', 'No search term (security, issuer or category) given.') } }
  if (!pfs.length) return { name: 'holding', args, source, result: { suche: query, gehalten: false, hinweis: t('Für diesen Kunden liegen keine Portfolios vor.', 'There are no portfolios for this client.') } }
  const cat = categoryFor(query)
  return cat ? byCategory(args, ref, query, cat, pfs, total, cur, lang) : byName(args, ref, query, pfs, total, cur, lang)
}

function byName(args: Record<string, unknown>, ref: ReferenceIndex, query: string, pfs: Pf[], total: number, cur: string, lang?: Lang): ToolResult {
  const t = pick(lang)
  const unclassified = t('nicht klassifiziert', 'not classified')
  const rows: Record<string, unknown>[] = []
  let share = 0, value = 0
  for (const p of pfs) {
    for (const s of list(p.raw.SecurityPositions)) {
      const sec = ref.security(num(s.SecurityId))
      const name = str(s.SecurityName) ?? sec?.name ?? str(s.Isin) ?? ''
      if (!nameMatches(query, `${name} ${sec?.name ?? ''}`, str(s.Isin))) continue
      const w = num(s.PortfolioValuePercentage) ?? 0
      const v = w * p.value
      share += total > 0 ? v / total : 0
      value += v
      rows.push({
        titel: shortName(name), portfolio: p.label, anteilPortfolioProzent: pct(w), wertInReferenzwaehrung: money(v), referenzwaehrung: cur,
        betragInPortfoliowaehrung: money(num(s.TotalAmountInPortfolioCurrency) ?? 0), portfoliowaehrung: p.currency,
        stueck: num(s.Quantity), kurs: num(s.PricePerUnit), titelwaehrung: str(s.Currency),
        anlageklasse: sec?.assetClass ?? unclassified, sektor: sec?.industry || unclassified,
      })
    }
  }
  const funds = pfs.flatMap((p) => list(p.raw.SecurityPositions).filter((s) => ref.security(num(s.SecurityId))?.lookThrough).map((s) => shortName(str(s.SecurityName) ?? '')))
  const viaFonds = funds.length
    ? t(`Nicht bestimmbar: Die Fonds-Durchsicht kennt nur Sektoren, Regionen und Währungen, keine Einzeltitel. Im Depot liegen ${funds.length} durchsichtbare Fonds.`,
      `Through funds: cannot be determined. The fund look-through only knows sectors, regions and currencies, not single securities. The portfolio holds ${funds.length} funds with look-through.`)
    : t('Keine durchsichtbaren Fonds im Depot.', 'No funds with look-through in the portfolio.')
  return {
    name: 'holding', args, source: rows.length ? t('Depotpositionen (Wertschriften)', 'Portfolio positions (securities)') : t('Depotpositionen (Wertschriften), Suche ohne Treffer', 'Portfolio positions (securities), search without a hit'),
    result: rows.length
      ? { suche: query, gehalten: true, direkt: rows, totalAnteilGesamtvermoegenProzent: pct(share), totalWertInReferenzwaehrung: money(value), referenzwaehrung: cur, viaFonds }
      : { suche: query, gehalten: false, hinweis: t(`Keine Position «${query}» im Depot gefunden.`, `No position «${query}» found in the portfolio.`), viaFonds },
  }
}

type Cat = (typeof CATEGORIES)[number]

function byCategory(args: Record<string, unknown>, ref: ReferenceIndex, query: string, cat: Cat, pfs: Pf[], total: number, cur: string, lang?: Lang): ToolResult {
  const t = pick(lang)
  const perPortfolio: Record<string, unknown>[] = []
  const direct: { titel: string; portfolio: string; anteilPortfolioProzent: number }[] = []
  const viaFunds: { fonds: string; portfolio: string; fondsanteilProzent: number; anteilPortfolioProzent: number }[] = []
  let totalShare = 0, totalDirect = 0, totalFunds = 0, unclassified = 0, opaque = 0
  for (const p of pfs) {
    let d = 0, f = 0
    for (const s of list(p.raw.SecurityPositions)) {
      const id = num(s.SecurityId), w = num(s.PortfolioValuePercentage) ?? 0
      const sec = ref.security(id)
      const name = shortName(str(s.SecurityName) ?? sec?.name ?? str(s.Isin) ?? 'Position')
      if (!sec) { unclassified += total > 0 ? (w * p.value) / total : 0; continue }
      const split = cat.dimension !== 'AssetClass' && id !== undefined && sec.lookThrough ? ref.lookThrough(id, cat.dimension) : undefined
      if (split) {
        const frac = split.get(cat.category) ?? 0
        if (frac > 0) { f += w * frac; viaFunds.push({ fonds: name, portfolio: p.label, fondsanteilProzent: pct(frac), anteilPortfolioProzent: pct(w * frac) }) }
        continue
      }
      if (cat.dimension !== 'AssetClass' && /fund|etf/i.test(sec.type ?? '')) opaque += total > 0 ? (w * p.value) / total : 0
      const own = cat.dimension === 'AssetClass' ? sec.assetClass : cat.dimension === 'CurrencyGroup' ? sec.currencyGroup ?? CURRENCY_GROUP[str(s.Currency) ?? ''] : cat.dimension === 'CountryGroup' ? sec.countryGroup : sec.industry
      if (own === cat.category) { d += w; direct.push({ titel: name, portfolio: p.label, anteilPortfolioProzent: pct(w) }) }
    }
    if (cat.dimension === 'CurrencyGroup') for (const a of list(p.raw.AccountPositions)) {
      if (CURRENCY_GROUP[str(a.Currency) ?? ''] !== cat.category) continue
      const w = num(a.PortfolioValuePercentage) ?? 0
      d += w; direct.push({ titel: t(`Konto ${str(a.Currency)}`, `Account ${str(a.Currency)}`), portfolio: p.label, anteilPortfolioProzent: pct(w) })
    }
    const weight = total > 0 ? p.value / total : 0
    totalShare += (d + f) * weight; totalDirect += d * weight; totalFunds += f * weight
    perPortfolio.push({ portfolio: p.label, anteilPortfolioProzent: pct(d + f), direktProzent: pct(d), viaFondsProzent: pct(f), wertInReferenzwaehrung: money((d + f) * p.value) })
  }
  const held = totalShare > 0
  return {
    name: 'holding', args,
    source: cat.dimension === 'AssetClass' ? t('Depotpositionen (Anlageklassen gemäss Referenzdaten)', 'Portfolio positions (asset classes from the reference data)') : t('Depotpositionen und Fonds-Durchsicht (Referenzdaten)', 'Portfolio positions and fund look-through (reference data)'),
    result: {
      suche: query, kategorie: t(cat.label, cat.en), gehalten: held, referenzwaehrung: cur,
      totalAnteilGesamtvermoegenProzent: pct(totalShare), totalWertInReferenzwaehrung: money(totalShare * total),
      direktAnteilProzent: pct(totalDirect), viaFondsAnteilProzent: pct(totalFunds),
      proPortfolio: perPortfolio, direkt: direct.sort((a, b) => b.anteilPortfolioProzent - a.anteilPortfolioProzent).slice(0, 10),
      viaFonds: viaFunds.sort((a, b) => b.anteilPortfolioProzent - a.anteilPortfolioProzent).slice(0, 10),
      ...(opaque > 0 ? { fondsOhneDurchsichtProzent: pct(opaque) } : {}),
      ...(unclassified > 0 ? { nichtKlassifiziertProzent: pct(unclassified) } : {}),
      ...(held ? {} : { hinweis: t(`Weder direkt noch über Fonds in «${cat.label}» investiert.`, `Not invested in «${cat.en}», neither directly nor through funds.`) }),
    },
  }
}

// ── transactions ─────────────────────────────────────────────────────────────

// Proposal status as the data names it. Orders of rejected or draft proposals exist in the data, but
// whether they were executed does not: by default only orders of final proposals count.
const STATUS_EN: Record<string, string> = { abgelehnt: 'rejected', entwurf: 'draft', alle: 'all', andere: 'other', unbekannt: 'unknown' }
const statusKey = (s: string | undefined) => { const n = norm(s ?? ''); return /^(final|umgesetzt|angenommen|accepted)/.test(n) ? 'final' : /^(abgelehnt|rejected)/.test(n) ? 'abgelehnt' : /^(entwurf|draft)/.test(n) ? 'entwurf' : n ? 'andere' : 'unbekannt' }

/** Order records of the client, by security, direction, period and proposal status. Dated through their proposal (no trade date in the data). */
export function transactions(client: unknown, ref: ReferenceIndex, args: { security?: unknown; direction?: unknown; from?: unknown; to?: unknown; status?: unknown }, lang?: Lang): ToolResult {
  const c: Raw = isObj(client) ? client : {}
  const t = pick(lang)
  const source = t('Transaktionen (Datum aus dem zugehörigen Anlagevorschlag)', 'Transactions (dated by their investment proposal)')
  const all = list(c.Transactions)
  if (!all.length) return { name: 'transactions', args, source, result: { anzahl: 0, hinweis: t('Für diesen Kunden sind keine Transaktionen erfasst.', 'No transactions are recorded for this client.') } }
  const proposals = new Map(list(c.Proposals).map((p) => [num(p.ProposalId), p]))
  const dateOf = (x: Raw) => { const p = proposals.get(num(x.ProposalId)); return (str(p?.TransactionsSubmittedDateUTC) ?? str(p?.FinalizedDateUTC) ?? str(p?.ProposedDateUTC))?.slice(0, 10) }
  const security = typeof args.security === 'string' ? args.security.trim() : ''
  const dir = typeof args.direction === 'string' ? norm(args.direction) : ''
  const from = typeof args.from === 'string' ? args.from.slice(0, 10) : '', to = typeof args.to === 'string' ? args.to.slice(0, 10) : ''
  const wanted = typeof args.status === 'string' && args.status ? (/^(alle|all)/.test(norm(args.status)) ? 'alle' : statusKey(args.status)) : 'final'
  const statusOf = (x: Raw) => statusKey(str(proposals.get(num(x.ProposalId))?.ProposalStatusName))
  const excluded: Record<string, number> = {}
  const hits = all.filter((x) => {
    const q = num(x.QuantityForTransaction) ?? num(x.TotalAmount) ?? 0
    if (security && !nameMatches(security, `${str(x.SecurityName) ?? ''} ${ref.security(num(x.SecurityId))?.name ?? ''}`, str(x.Isin))) return false
    if (/^(kauf|buy)/.test(dir) && q <= 0) return false
    if (/^(verkauf|sell)/.test(dir) && q >= 0) return false
    const d = dateOf(x)
    if ((from || to) && !d) return false
    if (from && d! < from) return false
    if (to && d! > to) return false
    const st = statusOf(x)
    if (wanted !== 'alle' && st !== wanted) { const name = str(proposals.get(num(x.ProposalId))?.ProposalStatusName) ?? t('ohne Status', 'no status'); excluded[name] = (excluded[name] ?? 0) + 1; return false }
    return true
  })
  const others = Object.values(excluded).reduce((a, b) => a + b, 0)
  const sums = new Map<string, { kaeufe: number; verkaeufe: number }>()
  for (const x of hits) {
    const cur = str(x.Currency) ?? '?', amount = num(x.TotalAmount) ?? 0
    const s = sums.get(cur) ?? { kaeufe: 0, verkaeufe: 0 }
    if (amount >= 0) s.kaeufe += amount; else s.verkaeufe += -amount
    sums.set(cur, s)
  }
  const rows = hits.map((x) => ({ x, d: dateOf(x) ?? '' })).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 15).map(({ x, d }) => ({
    datum: d || t('unbekannt', 'unknown'), titel: shortName(str(x.SecurityName) ?? str(x.Isin) ?? 'Position'),
    richtung: (num(x.QuantityForTransaction) ?? num(x.TotalAmount) ?? 0) >= 0 ? t('Kauf', 'Buy') : t('Verkauf', 'Sell'),
    stueck: Math.abs(num(x.QuantityForTransaction) ?? 0), betrag: money(Math.abs(num(x.TotalAmount) ?? 0)), waehrung: str(x.Currency),
    vorschlagStatus: str(proposals.get(num(x.ProposalId))?.ProposalStatusName),
  }))
  return {
    name: 'transactions', args, source,
    result: {
      vorschlagsstatus: wanted === 'final' ? t('nur finale Anlagevorschläge', 'final investment proposals only') : t(wanted, STATUS_EN[wanted] ?? wanted), anzahl: hits.length, gezeigt: rows.length, transaktionen: rows,
      summenProWaehrung: [...sums].map(([waehrung, s]) => ({ waehrung, kaeufe: money(s.kaeufe), verkaeufe: money(s.verkaeufe) })),
      ...(others ? { nichtGezaehltNachVorschlagsstatus: excluded, hinweisStatus: t(`${others} weitere Aufträge gehören zu Vorschlägen mit anderem Status (${Object.entries(excluded).map(([k, v]) => `${k}: ${v}`).join(', ')}); ob sie ausgeführt wurden, zeigen die Daten nicht.`, `${others} further orders belong to proposals with another status (${Object.entries(excluded).map(([k, v]) => `${k}: ${v}`).join(', ')}); the data does not show whether they were executed.`) } : {}),
      ...(hits.length ? {} : { hinweis: t(`Keine Transaktion${security ? ` zu «${security}»` : ''} im gewählten Filter.`, `No transaction${security ? ` for «${security}»` : ''} in the chosen filter.`) }),
    },
  }
}

// ── value history ────────────────────────────────────────────────────────────

const monthEnd = (series: NavPoint[], date: string) => [...series].reverse().find((p) => p.date <= date) ?? series.find((p) => p.date >= date)

/** Portfolio value over time (month values). Single positions have no history in the data. */
export function history(client: unknown, ref: ReferenceIndex, args: { portfolio?: unknown; from?: unknown; to?: unknown }, lang?: Lang): ToolResult {
  const c = readClient(client, ref)
  const t = pick(lang)
  const source = t('Wertentwicklung (Monatswerte der Portfolios)', 'Performance (monthly portfolio values)')
  const n = typeof args.portfolio === 'number' ? args.portfolio : Number.parseInt(String(args.portfolio ?? ''), 10)
  const chosen = Number.isInteger(n) && n >= 1 && n <= c.portfolios.length ? [c.portfolios[n - 1]] : c.portfolios
  const series = chosen.length === 1 ? chosen[0].history : combinedHistory(chosen)
  const scope = chosen.length === 1 && c.portfolios.length > 1 ? `Portfolio ${c.portfolios.indexOf(chosen[0]) + 1}` : t('alle Portfolios', 'all portfolios')
  if (series.length < 2) return { name: 'history', args, source, result: { umfang: scope, hinweis: t('Für diesen Kunden liegt keine Wertentwicklung vor.', 'No performance history is available for this client.') } }
  const from = typeof args.from === 'string' && args.from ? monthEnd(series, args.from.slice(0, 10)) : series[0]
  const to = typeof args.to === 'string' && args.to ? monthEnd(series, args.to.slice(0, 10)) : series[series.length - 1]
  const window = series.filter((p) => p.date >= from!.date && p.date <= to!.date)
  const hi = window.reduce((a, b) => (b.value > a.value ? b : a), window[0] ?? from!)
  const lo = window.reduce((a, b) => (b.value < a.value ? b : a), window[0] ?? from!)
  let worst: { von: string; bis: string; veraenderungProzent: number } | undefined
  for (let i = 1; i < window.length; i++) {
    const ch = window[i].value / window[i - 1].value - 1
    if (!worst || ch < worst.veraenderungProzent / 100) worst = { von: window[i - 1].date, bis: window[i].date, veraenderungProzent: pct(ch) }
  }
  return {
    name: 'history', args, source,
    result: {
      umfang: scope, waehrung: c.currency, datenVon: series[0].date, datenBis: series[series.length - 1].date,
      start: { datum: from!.date, wert: money(from!.value) }, ende: { datum: to!.date, wert: money(to!.value) },
      veraenderungProzent: pct(to!.value / from!.value - 1), veraenderungBetrag: money(to!.value - from!.value),
      hoechstwert: { datum: hi.date, wert: money(hi.value) }, tiefstwert: { datum: lo.date, wert: money(lo.value) },
      ...(worst ? { schwaechsterMonat: worst } : {}),
      monatswerte: window.slice(-13).map((p) => ({ datum: p.date, wert: money(p.value) })),
      hinweis: t('Einzelne Positionen haben in den Daten keine eigene Wertentwicklung, nur die Portfolios.', 'Single positions have no performance history of their own in the data, only the portfolios.'),
    },
  }
}

// ── cash and accounts ────────────────────────────────────────────────────────

/** Account balances per portfolio and currency, crypto tickers included. Account names and IBANs are never read. */
export function cash(client: unknown, _ref: ReferenceIndex, args: Record<string, unknown> = {}, lang?: Lang): ToolResult {
  const c: Raw = isObj(client) ? client : {}
  const t = pick(lang)
  const pfs = portfoliosOf(c)
  const total = totalOf(pfs)
  const cur = reporting(c)
  const accounts = pfs.flatMap((p) => list(p.raw.AccountPositions).map((a) => {
    const w = num(a.PortfolioValuePercentage) ?? 0, ccy = str(a.Currency) ?? '?'
    return { portfolio: p.label, waehrung: ccy, art: FIAT.has(ccy) ? t('Konto', 'Account') : t('kein ISO-Währungscode (Krypto-Konto)', 'not an ISO currency code (crypto account)'), betragInPortfoliowaehrung: money(num(a.TotalAmountInPortfolioCurrency) ?? 0), portfoliowaehrung: p.currency, anteilPortfolioProzent: pct(w), share: total > 0 ? (w * p.value) / total : 0 }
  }))
  const liq = num(c.LiquidityInDefaultCurrency)
  const crypto = accounts.filter((a) => !FIAT.has(a.waehrung))
  return {
    name: 'cash', args, source: t('Kontopositionen und Liquidität', 'Account positions and liquidity'),
    result: {
      anzahlKonten: accounts.length, referenzwaehrung: cur,
      konten: accounts.map(({ share: _share, ...a }) => a),
      kontenAnteilGesamtvermoegenProzent: pct(accounts.reduce((a, b) => a + b.share, 0)),
      ...(liq !== undefined ? { liquiditaetInReferenzwaehrung: money(liq) } : {}),
      ...(crypto.length ? { kryptoAnteilGesamtvermoegenProzent: pct(crypto.reduce((a, b) => a + b.share, 0)) } : {}),
      ...(accounts.length ? {} : { hinweis: t('Keine Kontopositionen erfasst.', 'No account positions recorded.') }),
    },
  }
}

// ── registry, model specs, router ────────────────────────────────────────────

const TOOLS = { holding, transactions, history, cash } as const

/** Runs one tool call. Unknown tools and bad arguments come back as a result that says so, never a throw. */
export function runTool(client: unknown, ref: ReferenceIndex, call: ToolCall, lang?: Lang): ToolResult {
  const fn = TOOLS[call.name as ToolName]
  const t = pick(lang)
  if (!fn) return { name: call.name, args: call.args, source: '–', result: { hinweis: t(`Unbekannte Abfrage «${String(call.name)}».`, `Unknown query «${String(call.name)}».`) } }
  try { return fn(client, ref, isObj(call.args) ? call.args : {}, lang) } catch (e) {
    return { name: call.name, args: call.args, source: '–', result: { hinweis: t(`Abfrage fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`, `Query failed: ${e instanceof Error ? e.message : String(e)}`) } }
  }
}

/** OpenAI function-calling definitions. Descriptions are German so the model reuses their wording. */
export const TOOL_SPECS = [
  { type: 'function', function: { name: 'holding', description: 'Wie viel hält der Kunde von einem Titel, Emittenten, Sektor, einer Region, Währung oder Anlageklasse? Direkt und über Fonds (Fonds-Durchsicht), pro Portfolio und total. Meldet ausdrücklich, wenn nichts gehalten wird.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Name, Emittent, ISIN oder Kategorie, z. B. «Nestlé», «Energie», «USD», «Obligationen»' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'transactions', description: 'Aufträge (Käufe und Verkäufe) aus Anlagevorschlägen, gefiltert nach Titel, Richtung, Zeitraum und Vorschlagsstatus, mit Summen pro Währung. Datum = Datum des zugehörigen Anlagevorschlags. Standard: nur finale Vorschläge.', parameters: { type: 'object', properties: { security: { type: 'string', description: 'Titelname oder ISIN, optional' }, direction: { type: 'string', enum: ['kauf', 'verkauf'], description: 'optional' }, from: { type: 'string', description: 'yyyy-mm-dd, optional' }, to: { type: 'string', description: 'yyyy-mm-dd, optional' }, status: { type: 'string', enum: ['final', 'abgelehnt', 'entwurf', 'alle'], description: 'Status des Anlagevorschlags; Standard final' } } } } },
  { type: 'function', function: { name: 'history', description: 'Wertentwicklung der Portfolios (Monatswerte): Stand zu einem Datum, Veränderung über einen Zeitraum, Höchst- und Tiefstwert, schwächster Monat. Einzelpositionen haben keine eigene Historie.', parameters: { type: 'object', properties: { portfolio: { type: 'integer', description: 'Portfolio-Nummer 1..n, weglassen für alle' }, from: { type: 'string', description: 'yyyy-mm-dd, optional' }, to: { type: 'string', description: 'yyyy-mm-dd, optional' } } } } },
  { type: 'function', function: { name: 'cash', description: 'Konten und Liquidität: Kontostände pro Portfolio und Währung, inklusive Krypto-Konten.', parameters: { type: 'object', properties: {} } } },
] as const

// The same tools described in English, so the model reuses English wording when the advisor works in English.
export const TOOL_SPECS_EN = [
  { type: 'function', function: { name: 'holding', description: 'How much does the client hold of a security, issuer, sector, region, currency or asset class? Direct and through funds (fund look-through), per portfolio and in total. Says so explicitly when nothing is held.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Name, issuer, ISIN or category, e.g. «Nestlé», «energy», «USD», «bonds»' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'transactions', description: 'Orders (buys and sells) from investment proposals, filtered by security, direction, period and proposal status, with sums per currency. Date = date of the investment proposal. Default: final proposals only.', parameters: { type: 'object', properties: { security: { type: 'string', description: 'Security name or ISIN, optional' }, direction: { type: 'string', enum: ['buy', 'sell'], description: 'optional' }, from: { type: 'string', description: 'yyyy-mm-dd, optional' }, to: { type: 'string', description: 'yyyy-mm-dd, optional' }, status: { type: 'string', enum: ['final', 'rejected', 'draft', 'all'], description: 'Status of the investment proposal; default final' } } } } },
  { type: 'function', function: { name: 'history', description: 'Performance of the portfolios (monthly values): value at a date, change over a period, peak and low, weakest month. Single positions have no history of their own.', parameters: { type: 'object', properties: { portfolio: { type: 'integer', description: 'Portfolio number 1..n, leave out for all' }, from: { type: 'string', description: 'yyyy-mm-dd, optional' }, to: { type: 'string', description: 'yyyy-mm-dd, optional' } } } } },
  { type: 'function', function: { name: 'cash', description: 'Accounts and liquidity: balances per portfolio and currency, crypto accounts included.', parameters: { type: 'object', properties: {} } } },
] as const

export const toolSpecs = (lang?: Lang) => (lang === 'en' ? TOOL_SPECS_EN : TOOL_SPECS)

const has = (q: string[], re: RegExp) => q.some((t) => re.test(t))

const MONTH_NAMES = ['januar', 'februar', 'marz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember']
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** A period named in the question: "im August 2026", "seit Anfang 2025", "seit 2024", "im Jahr 2025"; "in August 2026", "since the start of 2025". */
export function periodOf(question: string): { from?: string; to?: string } {
  const n = norm(question)
  const m = n.match(new RegExp(String.raw`\b(${[...MONTH_NAMES, ...MONTHS_EN].join('|')})\s+(20\d{2})\b`))
  const since = /\b(seit|since)\b/.test(n)
  if (m) {
    const index = MONTH_NAMES.includes(m[1]) ? MONTH_NAMES.indexOf(m[1]) : MONTHS_EN.indexOf(m[1])
    const mm = String(index + 1).padStart(2, '0')
    return since ? { from: `${m[2]}-${mm}-01` } : { from: `${m[2]}-${mm}-01`, to: `${m[2]}-${mm}-${DAYS[index]}` }
  }
  const y = n.match(/\b(20\d{2})\b/)
  if (!y) return {}
  if (since) return { from: /\b(ende|end(\s+of)?)\s+20/.test(n) ? `${y[1]}-12-01` : `${y[1]}-01-01` }
  return { from: `${y[1]}-01-01`, to: `${y[1]}-12-31` }
}

// Words that look like a name: capitalised in the question, not a stop word, not the first word.
function nameCandidates(question: string) {
  const words = question.split(/[^\p{L}\p{N}&.-]+/u).filter(Boolean)
  return words.filter((w, i) => (i > 0 || words.length === 1) && /^\p{Lu}/u.test(w) && !STOP.has(norm(w)) && norm(w).length >= 3)
}

/** Keyword routing for providers without function calling and for the no-key mode. Returns [] when no tool fits. */
export function routeQuestion(question: string, client: unknown, ref: ReferenceIndex): ToolCall[] {
  const q = tokens(question)
  const calls: ToolCall[] = []
  const c: Raw = isObj(client) ? client : {}
  if (has(q, /^(konto|konten|cash|bargeld|liquiditat|liquid|krypto|bitcoin|btc|eth|kontostand|account|balance|crypto)/)) calls.push({ name: 'cash', args: {} })
  if (has(q, /^(gekauft|verkauft|kauf|kaufe|verkauf|transaktion|trade|gehandelt|umgeschichtet|bought|sold|buy|sell|sale|sales|purchase|transaction|switched)/)) {
    const held = matchedPosition(question, c, ref)
    calls.push({ name: 'transactions', args: { ...(held ? { security: held } : {}), ...(has(q, /^(verkauf|sold|sell|sale|sales)/) ? { direction: 'verkauf' } : has(q, /^(gekauft|kauf|bought|buy|purchase)/) ? { direction: 'kauf' } : {}), ...periodOf(question) } })
  }
  if (has(q, /(entwick|verlauf|performance|rendite|hochststand|tiefststand|historie|verloren|gewonnen|zugelegt|eingebrochen)|^(develop|histor|return|perform|gained|lost|dropped|grown|grew|peak)/)) calls.push({ name: 'history', args: { ...periodOf(question) } })
  if (!calls.some((x) => x.name === 'transactions')) {
    const cat = categoryFor(question)
    const held = matchedPosition(question, c, ref)
    const asksHolding = has(q, /^(viel|halt|halten|besitzt|anteil|investiert|exponiert|position|engagement|gewicht|much|many|hold|own|owns|owned|invested|exposure|exposed|weight|share|stake)/)
    const query = held ?? (cat ? cat.words[0] : undefined) ?? (asksHolding ? nameCandidates(question)[0] : undefined)
    if (query && (held || cat || (asksHolding && !calls.length))) calls.push({ name: 'holding', args: { query } })
  }
  return calls
}

// The client's own position the question names, as the shortest distinctive token string. Undefined if none.
function matchedPosition(question: string, c: Raw, ref: ReferenceIndex): string | undefined {
  const q = new Set(tokens(question).filter((t) => t.length >= 3 && !STOP.has(t)))
  let best: { token: string; score: number } | undefined
  const names = [...list(c.Portfolios).flatMap((p) => list(p.SecurityPositions)), ...list(c.Transactions)]
    .map((s) => shortName(str(s.SecurityName) ?? ref.security(num(s.SecurityId))?.name ?? ''))
  for (const name of names) {
    const hits = tokens(name).filter((t) => t.length >= 3 && !STOP.has(t) && q.has(t))
    if (hits.length && (!best || hits.length > best.score)) best = { token: hits.join(' '), score: hits.length }
  }
  return best?.token
}

// ── deterministic phrasing (no model) ────────────────────────────────────────

const f = (v: unknown) => (typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('de-CH').replace(/[’’]/g, "'") : String(v)) : String(v ?? ''))

/** An answer from tool results alone, for the no-key mode (German unless lang is 'en'; the results must have been run in the same language). Every number is copied from the result. */
export function phrase(results: ToolResult[], lang?: Lang): string {
  const t = pick(lang)
  return results.map(({ name, result: r }) => {
    if (typeof r.hinweis === 'string' && !r.gehalten && name !== 'history' && !(Number(r.anzahl) > 0) && !(Number(r.anzahlKonten) > 0)) return `${r.hinweis}${name === 'holding' && typeof r.viaFonds === 'string' ? ` ${r.viaFonds}` : ''}`
    if (name === 'holding' && r.kategorie) {
      const pp = (r.proPortfolio as Record<string, unknown>[]).length > 1 ? ` ${(r.proPortfolio as Record<string, unknown>[]).map((p) => `${p.portfolio}: ${f(p.anteilPortfolioProzent)}%`).join(', ')}.` : ''
      const top = (r.viaFonds as { fonds: string; portfolio: string; anteilPortfolioProzent: number }[])[0]
      return t(
        `${r.kategorie}: ${f(r.totalAnteilGesamtvermoegenProzent)}% des Vermögens (${r.referenzwaehrung} ${f(r.totalWertInReferenzwaehrung)}), davon ${f(r.direktAnteilProzent)}% direkt und ${f(r.viaFondsAnteilProzent)}% über Fonds.${top ? ` Grösster Fondsbeitrag: ${top.fonds} mit ${f(top.anteilPortfolioProzent)}% von ${top.portfolio}.` : ''}${pp}`,
        `${r.kategorie}: ${f(r.totalAnteilGesamtvermoegenProzent)}% of assets (${r.referenzwaehrung} ${f(r.totalWertInReferenzwaehrung)}), of which ${f(r.direktAnteilProzent)}% direct and ${f(r.viaFondsAnteilProzent)}% through funds.${top ? ` Largest fund contribution: ${top.fonds} with ${f(top.anteilPortfolioProzent)}% of ${top.portfolio}.` : ''}${pp}`,
      )
    }
    if (name === 'holding') {
      const rows = r.direkt as Record<string, unknown>[]
      const held = rows.map((x) => `${x.titel} (${x.portfolio}, ${f(x.anteilPortfolioProzent)}%, ${x.referenzwaehrung} ${f(x.wertInReferenzwaehrung)})`).join('; ')
      return t(`Direkt gehalten: ${held}. Total ${f(r.totalAnteilGesamtvermoegenProzent)}% des Vermögens. ${r.viaFonds}`, `Held directly: ${held}. Total ${f(r.totalAnteilGesamtvermoegenProzent)}% of assets. ${r.viaFonds}`)
    }
    if (name === 'transactions') {
      const rows = r.transaktionen as Record<string, unknown>[]
      const sums = (r.summenProWaehrung as Record<string, unknown>[]).map((s) => [s.kaeufe ? `${t('Käufe', 'Buys')} ${s.waehrung} ${f(s.kaeufe)}` : '', s.verkaeufe ? `${t('Verkäufe', 'Sells')} ${s.waehrung} ${f(s.verkaeufe)}` : ''].filter(Boolean).join(', ')).join('; ')
      return `${f(r.anzahl)} ${t('Aufträge aus finalen Anlagevorschlägen', 'orders from final investment proposals')}. ${sums}. ${t('Zuletzt', 'Latest')}: ${rows.slice(0, 3).map((x) => `${x.datum} ${x.richtung} ${x.titel} (${x.waehrung} ${f(x.betrag)})`).join('; ')}.${r.hinweisStatus ? ` ${r.hinweisStatus}` : ''}`
    }
    if (name === 'history') {
      if (!r.start) return String(r.hinweis ?? '')
      const s = r.start as Record<string, unknown>, e = r.ende as Record<string, unknown>, hi = r.hoechstwert as Record<string, unknown>
      return t(
        `Wert (${r.umfang}) von ${r.waehrung} ${f(s.wert)} am ${s.datum} auf ${r.waehrung} ${f(e.wert)} am ${e.datum}: ${f(r.veraenderungProzent)}%. Höchstwert ${r.waehrung} ${f(hi.wert)} am ${hi.datum}.`,
        `Value (${r.umfang}) from ${r.waehrung} ${f(s.wert)} on ${s.datum} to ${r.waehrung} ${f(e.wert)} on ${e.datum}: ${f(r.veraenderungProzent)}%. Peak ${r.waehrung} ${f(hi.wert)} on ${hi.datum}.`,
      )
    }
    const konten = r.konten as Record<string, unknown>[]
    const accountList = konten.map((k) => `${t('Konto', 'Account')} ${k.waehrung}: ${k.portfoliowaehrung} ${f(k.betragInPortfoliowaehrung)} (${f(k.anteilPortfolioProzent)}%, ${k.portfolio})`).join(', ')
    return t(
      `${f(r.anzahlKonten)} Konten, zusammen ${f(r.kontenAnteilGesamtvermoegenProzent)}% des Vermögens: ${accountList}.${r.kryptoAnteilGesamtvermoegenProzent !== undefined ? ` Davon Krypto: ${f(r.kryptoAnteilGesamtvermoegenProzent)}%.` : ''}`,
      `${f(r.anzahlKonten)} accounts, together ${f(r.kontenAnteilGesamtvermoegenProzent)}% of assets: ${accountList}.${r.kryptoAnteilGesamtvermoegenProzent !== undefined ? ` Of which crypto: ${f(r.kryptoAnteilGesamtvermoegenProzent)}%.` : ''}`,
    )
  }).join('\n')
}

/** Questions the data cannot answer at all, so the chat says so instead of guessing. */
export function unsupportedTopic(question: string, lang?: Lang): string | undefined {
  const q = tokens(question)
  if (has(q, /^(gebuhr|gebuehr|kosten|courtage|kommission|fee|spesen|ter$|verwaltungsgebuhr|cost|commission|charges|expense)/)) return pick(lang)('Gebühren und Kosten sind in den Kundendaten nicht erfasst. Dazu kann ich nichts sagen.', 'Fees and costs are not recorded in the client data. I cannot say anything about them.')
  return undefined
}
