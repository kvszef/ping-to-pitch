// Smallest fix for a broken exclusion wish, and the re-check that the fix breaks nothing else (E2).
//
// measureExclusion(): how much of the client's wealth sits in what the client excluded, over all portfolios
// weighted by value, with fund look-through. Sectors use exposure() (equity part, like the bank's sector rules);
// emerging markets are read per position, because exposure()'s "Others" region also holds global funds.
// smallestFix(): the one sale that cuts the excluded share most (tie: the smaller position), applied to a copy
// of the raw client (the money goes to the CHF account, so weights still sum to 1). The position-based
// portfolio checks then run on the copy; any risk or warning that was not there before is reported.
import { exposure, readClient, type Client, type Portfolio, type ReferenceIndex } from './data.ts'
import { chf, shortName } from './format.ts'
import { allocation } from './checks/portfolio-allocation.ts'
import { concentration } from './checks/portfolio-concentration.ts'
import { risk } from './checks/portfolio-risk.ts'
import type { CheckContext, DraftProposal, Finding, RawClient } from './types.ts'
import type { Wish } from './wishes.ts'

export type ExclusionWish = Extract<Wish, { type: 'exclude-sector' | 'exclude-emerging-markets' }>

export type Holding = {
  portfolioNr: string; portfolioId?: number; securityId?: number; isin?: string
  name: string // short, for the advisor: "SPDR MSCI World Energy UCITS ETF"
  share: number // of the client's wealth, 0–1
  fraction: number // part of the position that is excluded, 0–1
  exposure: number // share × fraction
  via: 'direkt' | 'Fonds'
  value: number; currency: string // position value in portfolio currency
}
export type ExclusionMeasure = { total: number; direct: number; viaFunds: number; unclassified: number; holdings: Holding[] }

const EM = /emerging|schwellenl|\bEmMa\b|\bEM\b/i

/** "Anteile -USD- SSgA SPDR ETFs Europe II PLC - SPDR MSCI World Energy UCITS ETF" → "SPDR MSCI World Energy UCITS ETF" */
export const fundName = (name: string) => {
  const parts = name.split(/\s+-\s+/)
  return shortName(parts.length > 1 ? parts[parts.length - 1] : name)
}

const weightOf = (client: Client) => {
  const total = client.portfolios.reduce((a, p) => a + p.value, 0)
  return (p: Portfolio) => (total > 0 ? p.value / total : client.portfolios.length === 1 ? 1 : 0)
}

export function measureExclusion(client: Client, wish: ExclusionWish, ref: ReferenceIndex): ExclusionMeasure {
  const out: ExclusionMeasure = { total: 0, direct: 0, viaFunds: 0, unclassified: 0, holdings: [] }
  const pw = weightOf(client)
  for (const p of client.portfolios) {
    const w = pw(p)
    if (w <= 0) continue
    const found = new Map<number | string, { fraction: number; exposure: number; viaFund: boolean }>()
    if (wish.type === 'exclude-sector') {
      const e = exposure(p, 'Industry', ref)
      for (const c of e.contributors.get(wish.sector) ?? []) {
        const key = c.securityId ?? c.name
        const hit = found.get(key) ?? { fraction: 0, exposure: 0, viaFund: c.viaFund }
        hit.exposure += c.share * e.baseWeight * w
        found.set(key, hit)
      }
    } else {
      for (const x of p.positions) {
        if (x.kind !== 'security' || !x.security) continue
        const split = x.securityId !== undefined && x.security.lookThrough ? ref.lookThrough(x.securityId, 'CountryGroup') : undefined
        // In the look-through data only 'Equities EmMa' maps to 'Others'.
        const fraction = split ? split.get('Others') ?? 0 : EM.test(`${x.security.assetClassDetail ?? ''} ${x.name}`) ? 1 : 0
        if (fraction <= 0) continue
        const key = x.securityId ?? x.name
        const hit = found.get(key) ?? { fraction: 0, exposure: 0, viaFund: !!split }
        hit.exposure += x.weight * fraction * w
        found.set(key, hit)
      }
    }
    for (const x of p.positions) if (x.kind === 'security' && !x.security) out.unclassified += x.weight * w
    for (const [key, hit] of found) {
      const positions = p.positions.filter((x) => x.kind === 'security' && (x.securityId ?? x.name) === key)
      const share = positions.reduce((a, x) => a + x.weight, 0) * w
      const first = positions[0]
      if (!first || hit.exposure <= 0) continue
      out.holdings.push({
        portfolioNr: p.nr, portfolioId: p.id, securityId: first.securityId, isin: first.isin, name: fundName(first.name),
        share, fraction: share > 0 ? hit.exposure / share : 0, exposure: hit.exposure, via: hit.viaFund ? 'Fonds' : 'direkt',
        value: positions.reduce((a, x) => a + x.amount, 0), currency: p.currency ?? client.currency,
      })
    }
  }
  for (const h of out.holdings) {
    out.total += h.exposure
    if (h.via === 'Fonds') out.viaFunds += h.exposure
    else out.direct += h.exposure
  }
  out.holdings.sort((a, b) => b.exposure - a.exposure || a.share - b.share)
  return out
}

/** The part of the measure the wish is about: everything, or only direct holdings. */
export const breachOf = (m: ExclusionMeasure, wish: ExclusionWish) => (wish.type === 'exclude-sector' && wish.scope === 'direct' ? m.direct : m.total)

/** A copy of the raw client without the holding; its value moves to the portfolio's CHF account. */
export function applySale(raw: RawClient, h: Holding): RawClient {
  const copy = structuredClone(raw) as RawClient & { Portfolios?: Record<string, unknown>[] }
  const p = (Array.isArray(copy.Portfolios) ? copy.Portfolios : []).find((x) => x && x.PortfolioNr === h.portfolioNr)
  if (!p) return copy
  const positions = Array.isArray(p.SecurityPositions) ? (p.SecurityPositions as Record<string, unknown>[]) : []
  const sold = positions.filter((x) => x && (h.securityId !== undefined ? x.SecurityId === h.securityId : x.SecurityName !== undefined && fundName(String(x.SecurityName)) === h.name))
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const weight = sold.reduce((a, x) => a + num(x.PortfolioValuePercentage), 0)
  const amount = sold.reduce((a, x) => a + num(x.TotalAmountInPortfolioCurrency), 0)
  p.SecurityPositions = positions.filter((x) => !sold.includes(x))
  const accounts = Array.isArray(p.AccountPositions) ? (p.AccountPositions as Record<string, unknown>[]) : (p.AccountPositions = [])
  const account = accounts.find((a) => a && a.Currency === 'CHF')
  if (account) {
    account.PortfolioValuePercentage = num(account.PortfolioValuePercentage) + weight
    account.TotalAmountInPortfolioCurrency = num(account.TotalAmountInPortfolioCurrency) + amount
  } else {
    accounts.push({ Currency: 'CHF', PortfolioValuePercentage: weight, TotalAmountInPortfolioCurrency: amount })
  }
  if (typeof copy.LiquidityInDefaultCurrency === 'number') copy.LiquidityInDefaultCurrency += weight * num(p.AssetsUnderManagementInDefaultCurrency)
  return copy
}

// The portfolio checks that read positions; the others (violations, proposals, performance) do not change with a sale.
const RECHECKS = [allocation, concentration, risk]
const bad = (f: Finding) => f.severity === 'risk' || f.severity === 'warn'
const rank = { risk: 0, warn: 1, info: 2, ok: 3 } as const

/** Risk and warning findings on `after` that `before` did not have, or had milder. */
export function newIssues(before: RawClient, after: RawClient, ctx: CheckContext): Finding[] {
  const was = new Map(RECHECKS.flatMap((c) => c(before, ctx)).map((f) => [f.id, f]))
  return RECHECKS.flatMap((c) => c(after, ctx)).filter((f) => bad(f) && (!was.has(f.id) || rank[f.severity] < rank[was.get(f.id)!.severity]))
}

export type FixResult = { holding: Holding; fix: DraftProposal; before: number; after: number; newIssues: Finding[] }

export function smallestFix(raw: RawClient, ctx: CheckContext, wish: ExclusionWish, measured?: ExclusionMeasure): FixResult | undefined {
  const m = measured ?? measureExclusion(readClient(raw, ctx.ref), wish, ctx.ref)
  const direct = wish.type === 'exclude-sector' && wish.scope === 'direct'
  const holding = m.holdings
    .filter((h) => !direct || h.via === 'direkt')
    .sort((a, b) => b.exposure - a.exposure || a.share - b.share)[0]
  if (!holding) return undefined
  const copy = applySale(raw, holding)
  const after = breachOf(measureExclusion(readClient(copy, ctx.ref), wish, ctx.ref), wish)
  return {
    holding, before: breachOf(m, wish), after: Math.max(0, after),
    fix: {
      PortfolioId: holding.portfolioId,
      Reason: `${holding.name} verkaufen`,
      SecurityPositions: [{ SecurityId: holding.securityId, Isin: holding.isin, SecurityName: holding.name, ProposalValuePercentage: 0, TotalAmountInProposalCurrency: holding.value }],
    },
    newIssues: newIssues(raw, copy, ctx),
  }
}

/** "Verkauf SPDR MSCI World Energy UCITS ETF über CHF 12'345" — the sale as the briefing quotes it. */
export const saleText = (h: Holding) => `Verkauf ${h.name} über ${chf(h.value, h.currency)}`
