// One concrete rebalancing step for a house-view opportunity: sell from what the view wants less of (or use
// surplus cash), buy the recommended product for what it wants more of, then re-check the result.
//
// - Size: the smaller of the gap to the SAA target, what the source can give, and 10% of the portfolio, rounded
//   down to CHF 1'000. One step, not "all the way to the target".
// - Applied to a copy of the raw client, like fix.ts: the sold position shrinks (or goes), the bought product
//   is added with its reference.json classification, so every exposure and check works on the copy.
// - Re-check: the two categories before and after, the number of allocation/concentration/risk warnings before
//   and after, and any warning that is new (fix.ts newIssues). A step that makes things worse is not proposed.
import { readClient, exposure, type Dimension } from './data.ts'
import { clientExposure } from './checks/wish-common.ts'
import { allocation } from './checks/portfolio-allocation.ts'
import { concentration } from './checks/portfolio-concentration.ts'
import { risk } from './checks/portfolio-risk.ts'
import { newIssues } from './fix.ts'
import type { CheckContext, DraftProposal, Finding, RawClient } from './types.ts'

export type Leg = { side: 'Verkauf' | 'Kauf'; name: string; amount: number }
export type Effect = { label: string; before: number; after: number; unit: '%' | 'Anzahl'; good: boolean }
export type Rebalance = { legs: Leg[]; effects: Effect[]; newIssues: Finding[]; fix: DraftProposal }
export type Target = { dimension: Dimension; category: string; label: string; target: number }
export type Source = { kind: 'position'; dimension: Dimension; category: string; label: string } | { kind: 'cash'; label: string }

const STEP_CAP = 0.1 // at most 10% of the portfolio in one step
const STEP_MIN = 0.01 // a step below 1% of the portfolio changes nothing worth a call
const ROUND = 1000
const bad = (f: Finding) => f.severity === 'risk' || f.severity === 'warn'
const warnings = (raw: RawClient, ctx: CheckContext) => [allocation, concentration, risk].flatMap((c) => c(raw, ctx)).filter(bad).length
type RawPosition = Record<string, unknown>
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function rebalance(raw: RawClient, ctx: CheckContext, buy: Target, product: { id: number; name: string }, source: Source): Rebalance | undefined {
  const client = readClient(raw, ctx.ref)
  const main = [...client.portfolios].filter((p) => p.positions.length).sort((a, b) => b.value - a.value)[0]
  const sec = ctx.ref.security(product.id)
  if (!main || main.value <= 0 || !sec) return undefined

  // How much the target category is short, in portfolio terms (regions and sectors are measured in the equity part).
  const before = clientExposure(client, buy.dimension, ctx.ref)
  const actual = before.ofBase.get(buy.category) ?? 0
  const gap = (buy.target - actual) * (before.base || 1)
  if (gap <= 0) return undefined

  // What the source can give, and which position (or account) it comes from.
  let available = 0, soldName = source.label, soldId: number | undefined
  if (source.kind === 'position') {
    const e = exposure(main, source.dimension, ctx.ref)
    const top = (e.contributors.get(source.category) ?? []).find((c) => c.securityId !== undefined)
    if (!top) return undefined
    const pos = main.positions.find((p) => p.securityId === top.securityId)
    available = pos?.weight ?? 0
    soldName = pos?.name ?? top.name
    soldId = top.securityId
  } else {
    const liquidityBand = ctx.ref.saa(main.saaId)?.bands.find((b) => b.dimension === 'AssetClass' && b.category === 'Liquidity')
    const cash = main.positions.filter((p) => p.kind === 'account' && p.currency === 'CHF').reduce((a, p) => a + p.weight, 0)
    available = Math.max(0, cash - (liquidityBand?.target ?? 0.02))
  }
  const weight = Math.min(gap, available, STEP_CAP)
  const amount = Math.floor((weight * main.value) / ROUND) * ROUND
  if (amount < ROUND || amount / main.value < STEP_MIN) return undefined
  const w = amount / main.value

  // Apply to a copy of the raw client.
  const copy = structuredClone(raw) as RawClient & { Portfolios?: Record<string, unknown>[] }
  const p = (copy.Portfolios ?? []).find((x) => x && x.PortfolioNr === main.nr)
  if (!p) return undefined
  const positions = (Array.isArray(p.SecurityPositions) ? p.SecurityPositions : (p.SecurityPositions = [])) as RawPosition[]
  const accounts = (Array.isArray(p.AccountPositions) ? p.AccountPositions : (p.AccountPositions = [])) as RawPosition[]
  const take = (x: RawPosition) => {
    const share = num(x.PortfolioValuePercentage)
    const ratio = share > 0 ? Math.min(1, w / share) : 1
    x.PortfolioValuePercentage = share - Math.min(share, w)
    x.TotalAmountInPortfolioCurrency = num(x.TotalAmountInPortfolioCurrency) * (1 - ratio)
  }
  if (source.kind === 'position') {
    const x = positions.find((q) => q && q.SecurityId === soldId)
    if (!x) return undefined
    take(x)
    if (num(x.PortfolioValuePercentage) <= 1e-6) positions.splice(positions.indexOf(x), 1)
  } else {
    const x = accounts.find((a) => a && a.Currency === 'CHF')
    if (!x) return undefined
    take(x)
  }
  positions.push({ SecurityId: sec.id, Isin: sec.isin, SecurityName: sec.name, Currency: sec.currency, PortfolioValuePercentage: w, TotalAmountInPortfolioCurrency: amount })

  // Re-check on the copy.
  const after = clientExposure(readClient(copy, ctx.ref), buy.dimension, ctx.ref)
  const effects: Effect[] = [{ label: buy.label, before: actual, after: after.ofBase.get(buy.category) ?? 0, unit: '%', good: true }]
  if (source.kind === 'position') {
    const b = clientExposure(client, source.dimension, ctx.ref).ofBase.get(source.category) ?? 0
    const a = clientExposure(readClient(copy, ctx.ref), source.dimension, ctx.ref).ofBase.get(source.category) ?? 0
    effects.push({ label: source.label, before: b, after: a, unit: '%', good: a <= b })
  }
  const warnBefore = warnings(raw, ctx), warnAfter = warnings(copy, ctx)
  effects.push({ label: 'Warnungen Allokation, Klumpen, Risiko', before: warnBefore, after: warnAfter, unit: 'Anzahl', good: warnAfter <= warnBefore })
  const fresh = newIssues(raw, copy, ctx)
  if (warnAfter > warnBefore) return undefined // a step that makes things worse is not a proposal

  return {
    legs: [{ side: 'Verkauf', name: soldName, amount }, { side: 'Kauf', name: product.name, amount }],
    effects, newIssues: fresh,
    fix: {
      PortfolioId: main.id,
      Reason: `${buy.label} aufstocken gemäss Hausmeinung`,
      SecurityPositions: [
        ...(soldId !== undefined ? [{ SecurityId: soldId, SecurityName: soldName, ProposalValuePercentage: -w, TotalAmountInProposalCurrency: -amount }] : []),
        { SecurityId: sec.id, Isin: sec.isin, SecurityName: sec.name, ProposalValuePercentage: w, TotalAmountInProposalCurrency: amount },
      ],
    },
  }
}
