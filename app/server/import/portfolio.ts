// Ex-custody import (N3), step 2: parsed statement → a virtual portfolio shaped like clients.json →
// Portfolios[], flagged `isExCustody: true`. Pure: no I/O, no clock.
//
// Each position is joined to reference.json by ISIN and then by currency (one ISIN can be several
// securities, one per currency; the join key stays SecurityId). A position we cannot join keeps its own
// fields and gets a best-guess classification written onto the position as SAA_* fields, which the engine
// reads for securities reference.json does not know (engine/data.ts ownSecurity). How each position was
// classified is in the report, so the advisor sees what is ours and what is a guess.

import { isIsin, type ParsedPosition, type ParsedStatement } from './statement.ts'

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isObj) : [])
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export const EX_CUSTODY_LABEL = 'Fremddepot (ex-custody)'
const NOT_CLASSIFIED = 'Not classified'

/** How a position got its classification. */
export type MatchedBy =
  | 'reference' // same ISIN and currency in reference.json: the bank's own security record
  | 'isin' // ISIN known in another currency: classification borrowed, no SecurityId join
  | 'issuer' // unknown ISIN, issuer name found among the bank's shares: region and sector borrowed
  | 'statement' // from the statement's section and the position's own name only (best guess)
  | 'account' // cash account

export type ImportRow = {
  name: string; isin?: string; currency: string; quantity: number; value: number; weight: number
  section: string; assetClass: string; securityType?: string; matchedBy: MatchedBy; securityId?: number
  isinCheckDigit?: boolean // false: the ISIN fails its check digit (typo in the statement or a fictitious one)
}

export type ImportReport = {
  bank?: string; currency: string; asOf?: string; mandate?: string
  positions: number; securities: number; accounts: number
  matched: number // joined to reference.json by ISIN and currency
  byMatch: Record<MatchedBy, number>
  total: number // sum of the parsed market values
  statedTotal?: number // total printed on the statement
  difference?: number // total - statedTotal
  weightSum: number
  reconciles: boolean // parsed positions add up to the printed total (rounding tolerance)
  sections: { label: string; value: number; stated: number; ok: boolean }[]
  rows: ImportRow[]
  issues: string[] // German, for the advisor
  unparsed: number // position-like lines the rules could not read
}

export type ExCustodyImport = { portfolio: Raw; report: ImportReport; importId: string }

// ── reference.json by ISIN ───────────────────────────────────────────────────

export type IsinIndex = { byIsin: Map<string, Raw[]>; shares: { key: string; row: Raw }[] }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function indexIsins(reference: unknown): IsinIndex {
  const byIsin = new Map<string, Raw[]>()
  const shares: IsinIndex['shares'] = []
  for (const s of list(isObj(reference) ? reference.Securities : undefined)) {
    const isin = str(s.Isin)
    if (isin) byIsin.set(isin, [...(byIsin.get(isin) ?? []), s])
    if (s.SecurityTypeName === 'Shares' && str(s.Name)) shares.push({ key: ` ${fold(str(s.Name)!).replace(/[^a-z0-9]+/g, ' ')} `, row: s })
  }
  return { byIsin, shares }
}

// ── best-guess classification from the statement ─────────────────────────────

const ISO_GROUP: Record<string, string> = { CHF: 'Swiss francs', USD: 'US-Dollar', EUR: 'Euro' }
const COUNTRY_BY_ISIN: Record<string, string> = {
  CH: 'Switzerland', LI: 'Switzerland', US: 'North America', CA: 'North America', GB: 'Great Britain', JP: 'Japan',
  DE: 'Rest of Europe', FR: 'Rest of Europe', NL: 'Rest of Europe', IT: 'Rest of Europe', ES: 'Rest of Europe', BE: 'Rest of Europe',
  AT: 'Rest of Europe', FI: 'Rest of Europe', DK: 'Rest of Europe', SE: 'Rest of Europe', NO: 'Rest of Europe', PT: 'Rest of Europe',
  AU: 'Asia/Pacific (ex Japan)', HK: 'Asia/Pacific (ex Japan)', SG: 'Asia/Pacific (ex Japan)', NZ: 'Asia/Pacific (ex Japan)',
}
const FUND = /^(Ant|Anteile?)\b|\b(ETF|ETC|Fonds|Fund|UCITS|SICAV|Trust)\b/i
const COUPON = /\d+(?:\.\d+)? ?%/

function fundRegion(name: string): string {
  if (/S&P|Nasdaq|\bUSA?\b|America|Dow Jones/i.test(name)) return 'North America'
  if (/Emerging|EM\b|Schwellen/i.test(name)) return 'Others'
  if (/Japan|Nikkei|Topix/i.test(name)) return 'Japan'
  if (/\bSMI\b|Schweiz|Swiss|Switzerland|SPI\b/i.test(name)) return 'Switzerland'
  if (/Europe|Europa|STOXX|Euro/i.test(name)) return 'Rest of Europe'
  return NOT_CLASSIFIED // world, global: region split unknown without the fund's breakdown
}

function guessAssetClass(p: ParsedPosition): string {
  const n = p.name
  switch (p.sectionClass) {
    case 'Liquidity': return 'Liquidity'
    case 'Bonds': return 'Bonds'
    case 'Shares': return 'Shares'
    case 'Real estate': return 'Real estate'
    case 'Alternative': return /immo|real estate|reit|prime site|property/i.test(n) ? 'Real estate' : 'Specialties andCommodities'
    default:
      if (COUPON.test(n)) return 'Bonds'
      if (/immo|real estate|reit/i.test(n)) return 'Real estate'
      if (/gold|silber|silver|commodit|rohstoff|platin/i.test(n)) return 'Specialties andCommodities'
      if (/\b(N-)?Akt(ie)?\b|\bGS\b|\bPS\b|Shares?\b/i.test(n)) return 'Shares'
      return NOT_CLASSIFIED
  }
}

const securityType = (assetClass: string, name: string) =>
  FUND.test(name) ? 'Investment fund' : assetClass === 'Bonds' || COUPON.test(name) ? 'Bonds, debt register claims' : assetClass === 'Shares' ? 'Shares' : undefined

// Issuer key of a bond or share name: "4.250% Apple Inc. 2023-2029" → "apple", "N-Akt Lonza Group AG" → "lonza".
const STOP = new Set(['akt', 'n', 'gs', 'ps', 'inh', 'namen', 'aktie', 'ag', 'se', 'sa', 'plc', 'inc', 'corp', 'co', 'ltd', 'bv', 'nv', 'group', 'holding', 'finance', 'intl', 'kapitalmarkt', 'cl', 'the', 'and',
  'kanton', 'schweiz', 'eidgenossenschaft', 'treasury', 'notes', 'us', 'pfandbriefzentrale', 'pfandbrief', 'republic', 'bund'])
function issuerKey(name: string): string | undefined {
  const words = fold(name).replace(COUPON, ' ').replace(/\d{4}-\d{2,4}/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w))
  return words[0]
}

// ── building the portfolio ───────────────────────────────────────────────────

// FNV-1a over the positions: the same statement gives the same id, so importing it twice replaces it.
function hashOf(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36)
}

const round2 = (x: number) => Math.round(x * 100) / 100

export function buildExCustody(statement: ParsedStatement, reference: IsinIndex): ExCustodyImport {
  const positions = statement.positions
  const issues: string[] = []
  const importId = `ex-${hashOf(positions.map((p) => `${p.isin ?? p.currency}:${p.value}`).join('|'))}`
  const idBase = -(parseInt(importId.slice(3), 36) % 100_000) * 1000 // unmatched securities get negative ids, unique per import

  const rows: ImportRow[] = []
  const securityPositions: Raw[] = []
  const accountPositions: Raw[] = []

  positions.forEach((p, i) => {
    if (p.kind === 'account') {
      rows.push({ name: p.name, currency: p.currency, quantity: p.quantity, value: p.value, weight: p.weight, section: p.section, assetClass: 'Liquidity', matchedBy: 'account' })
      accountPositions.push({ AccountName: `Konto ${p.currency}`, Currency: p.currency, TotalAmountInPortfolioCurrency: p.value, PortfolioValuePercentage: p.weight })
      return
    }
    const known = p.isin ? reference.byIsin.get(p.isin) ?? [] : []
    const same = known.find((s) => str(s.Currency) === p.currency)
    const base: Raw = {
      Isin: p.isin, SecurityName: p.name, Quantity: p.quantity, PricePerUnit: p.price, Currency: p.currency,
      TotalAmountInPortfolioCurrency: p.value, PortfolioValuePercentage: p.weight,
    }
    const row = { name: p.name, isin: p.isin, currency: p.currency, quantity: p.quantity, value: p.value, weight: p.weight, section: p.section, isinCheckDigit: p.isin ? isIsin(p.isin) : undefined }

    if (same) {
      const id = num(same.Id)
      securityPositions.push({ SecurityId: id, ...base })
      rows.push({ ...row, assetClass: str(same.SAA_AssetClassName) ?? NOT_CLASSIFIED, securityType: str(same.SecurityTypeName), matchedBy: 'reference', securityId: id })
      return
    }

    // Not joinable: classify from what we can see, and say how.
    const id = idBase - i - 1
    const other = known[0]
    let assetClass = guessAssetClass(p)
    let matchedBy: MatchedBy = 'statement'
    let type = securityType(assetClass, p.name)
    let country: string | undefined, industry: string | undefined
    const fund = FUND.test(p.name)
    if (other) {
      matchedBy = 'isin'
      assetClass = str(other.SAA_AssetClassName) ?? assetClass
      type = str(other.SecurityTypeName) ?? type
      country = str(other.SAA_CountryGroupName); industry = str(other.SAA_IndustryName)
    } else if (!fund) {
      const key = issuerKey(p.name)
      const issuer = key ? reference.shares.find((s) => s.key.includes(` ${key} `))?.row : undefined
      if (issuer) { matchedBy = 'issuer'; country = str(issuer.SAA_CountryGroupName); industry = str(issuer.SAA_IndustryName) }
    }
    if (assetClass === 'Shares' && !country) country = fund ? fundRegion(p.name) : (p.isin && COUNTRY_BY_ISIN[p.isin.slice(0, 2)]) || NOT_CLASSIFIED
    securityPositions.push({
      SecurityId: id, ...base,
      SecurityTypeName: type, SAA_AssetClassName: assetClass, SAA_CurrencyGroupName: ISO_GROUP[p.currency] ?? 'Andere',
      SAA_CountryGroupName: country ?? NOT_CLASSIFIED, SAA_IndustryName: industry ?? NOT_CLASSIFIED,
      ClassificationSource: matchedBy,
    })
    rows.push({ ...row, assetClass, securityType: type, matchedBy, securityId: id })
  })

  // ── reconciliation ──
  const total = round2(positions.reduce((a, p) => a + p.value, 0))
  const weightSum = Math.round(positions.reduce((a, p) => a + p.weight, 0) * 10_000) / 10_000
  const tolerance = 0.5 * positions.length + 1 // market values are printed rounded to whole units
  const difference = statement.statedTotal !== undefined ? round2(total - statement.statedTotal) : undefined
  const reconciles = positions.length > 0 && difference !== undefined && Math.abs(difference) <= tolerance && Math.abs(weightSum - 1) <= 0.0001 * positions.length + 0.001
  const sections = statement.sectionTotals.map((t) => {
    const value = round2(positions.filter((p) => p.section.toLowerCase() === t.label.toLowerCase()).reduce((a, p) => a + p.value, 0))
    return { label: t.label, value, stated: t.value, ok: Math.abs(value - t.value) <= tolerance }
  })

  if (!positions.length) issues.push('Keine Positionen erkannt. Ist das ein Vermögensausweis mit Positionsliste?')
  if (statement.statedTotal === undefined && positions.length) issues.push('Kein Gesamtvermögen auf dem Auszug gefunden: die Summe ist nicht gegengeprüft.')
  else if (difference !== undefined && !reconciles && positions.length) issues.push(`Summe der Positionen weicht um ${statement.currency} ${Math.round(difference).toLocaleString('de-CH')} vom ausgewiesenen Gesamtvermögen ab.`)
  for (const s of sections) if (!s.ok) issues.push(`Teilsumme «${s.label}» stimmt nicht: gelesen ${Math.round(s.value)}, ausgewiesen ${Math.round(s.stated)}.`)
  if (statement.unparsed.length) issues.push(`${statement.unparsed.length} Zeile(n) sehen wie Positionen aus, konnten aber nicht gelesen werden.`)
  const badIsins = rows.filter((r) => r.isinCheckDigit === false).length
  if (badIsins) issues.push(`${badIsins} ISIN(s) mit ungültiger Prüfziffer (Tippfehler oder fiktive Daten); Zuordnung nur über die Bank-Stammdaten, sonst geschätzt.`)
  const guessed = rows.filter((r) => r.matchedBy === 'statement' || r.matchedBy === 'issuer').length
  if (guessed) issues.push(`${guessed} Position(en) nicht in den Bank-Stammdaten: Anlageklasse aus dem Auszug geschätzt.`)

  const byMatch = { reference: 0, isin: 0, issuer: 0, statement: 0, account: 0 } as Record<MatchedBy, number>
  for (const r of rows) byMatch[r.matchedBy]++
  const liquidity = round2(positions.filter((p) => p.kind === 'account' || p.sectionClass === 'Liquidity').reduce((a, p) => a + p.value, 0))

  const portfolio: Raw = {
    PortfolioId: 900_000_000 + (parseInt(importId.slice(3), 36) % 1_000_000),
    PortfolioNr: 'Fremddepot',
    Name: `${EX_CUSTODY_LABEL}${statement.bank ? ` · ${statement.bank}` : ''}`,
    PortfolioCurrency: statement.currency, ReferenceCurrency: statement.currency,
    InvestmentServiceName: EX_CUSTODY_LABEL,
    StrategyName: statement.mandate ? `Fremdmandat «${statement.mandate}»` : undefined,
    AssetsUnderManagementInDefaultCurrency: total,
    LiquidityInDefaultCurrency: liquidity,
    FactoryDateUtc: statement.asOf,
    SecurityPositions: securityPositions,
    AccountPositions: accountPositions,
    PerformanceHistory: [], // the statement has yearly figures only; an empty history keeps combined charts honest
    isExCustody: true,
    ExCustody: { importId, bank: statement.bank, asOf: statement.asOf, mandate: statement.mandate, source: 'PDF', reconciles },
  }

  return {
    importId, portfolio,
    report: {
      bank: statement.bank, currency: statement.currency, asOf: statement.asOf, mandate: statement.mandate,
      positions: positions.length, securities: securityPositions.length, accounts: accountPositions.length,
      matched: byMatch.reference, byMatch, total, statedTotal: statement.statedTotal, difference, weightSum, reconciles, sections, rows, issues,
      unparsed: statement.unparsed.length,
    },
  }
}

// ── attaching to a client ────────────────────────────────────────────────────

const exOf = (p: Raw) => p.isExCustody === true
const importIdOf = (p: Raw) => (isObj(p.ExCustody) ? str(p.ExCustody.importId) : undefined)

/**
 * A copy of the client with the ex-custody portfolio added (or replaced, same statement imported twice).
 * Ex-custody portfolios are numbered «Fremddepot 1», «Fremddepot 2», … and the client's totals include them,
 * the same way a client's totals include every portfolio at the bank.
 */
export function attachExCustody(client: Raw, portfolio: Raw): Raw {
  const id = importIdOf(portfolio)
  const kept = list(client.Portfolios).filter((p) => !(exOf(p) && id && importIdOf(p) === id))
  return withTotals(client, [...kept, { ...portfolio }])
}

export function detachExCustody(client: Raw, importId: string): Raw {
  return withTotals(client, list(client.Portfolios).filter((p) => !(exOf(p) && importIdOf(p) === importId)))
}

export function exCustodyOf(client: Raw): Raw[] {
  return list(client.Portfolios).filter(exOf)
}

function withTotals(client: Raw, portfolios: Raw[]): Raw {
  const before = list(client.Portfolios).filter(exOf)
  const sum = (ps: Raw[], f: string) => ps.reduce((a, p) => a + (num(p[f]) ?? 0), 0)
  const after = portfolios.filter(exOf)
  let n = 0
  const numbered = portfolios.map((p) => (exOf(p) ? { ...p, PortfolioNr: `Fremddepot ${++n}` } : p))
  const out: Raw = { ...client, Portfolios: numbered }
  for (const f of ['AssetsUnderManagementInDefaultCurrency', 'LiquidityInDefaultCurrency']) {
    const own = num(client[f])
    if (own !== undefined) out[f] = round2(own - sum(before, f) + sum(after, f))
  }
  return out
}
