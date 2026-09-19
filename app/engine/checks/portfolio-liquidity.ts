// portfolio.liquidity — cash across all portfolios (account positions), as a share of the client's wealth and in CHF.
// When a running plan note names an amount (e.g. CHF 15'000 for the Q1 tax payment), the cash is compared with it.
//
// Data trap: the client-level LiquidityInDefaultCurrency is half the portfolio sum on CASE-038, so the cash is summed
// per portfolio (LiquidityInDefaultCurrency, in the reporting currency), falling back to the account positions.
import type { Client } from '../data.ts'
import { chf, pct } from '../format.ts'
import { noteEvidence, planWindows } from '../notes.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { SRC, clientOf, findingId } from './common.ts'

const CHECK = 'portfolio.liquidity'

export function liquidityOf(client: Client): { value: number; share: number; aum: number } {
  let value = 0
  for (const p of client.portfolios) {
    value += p.liquidity ?? p.positions.filter((x) => x.kind === 'account').reduce((a, x) => a + x.amount, 0)
  }
  if (!client.portfolios.length) value = client.liquidity ?? 0
  const portfolioTotal = client.portfolios.reduce((a, p) => a + p.value, 0)
  const aum = portfolioTotal > 0 ? portfolioTotal : client.aum
  return { value, share: aum > 0 ? value / aum : 0, aum }
}

export const liquidity: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const cash = liquidityOf(client)
  if (cash.aum <= 0) return []
  const cur = client.currency
  // The nearest running plan that names an amount; an expired one may already be paid.
  const need = planWindows(client.notes, ctx.now).filter((w) => !w.expired && w.topic === 'liquidity' && w.amount !== undefined)
    .sort((a, b) => (a.monthsLeft ?? Infinity) - (b.monthsLeft ?? Infinity))[0]
  const short = need && cash.value < need.amount! ? need.amount! - cash.value : 0

  const numbers: Record<string, number> = { share: cash.share, value: cash.value }
  const evidence: Evidence[] = client.portfolios.map((p) => SRC.portfolio(p.nr))
  if (!evidence.length) evidence.push({ source: 'Kundendatei', quote: 'LiquidityInDefaultCurrency' })
  let title = `Liquidität ${pct(cash.share)} (${chf(cash.value, cur)})`
  let detail = 'Summe der Kontopositionen über alle Portfolios.'
  if (need) {
    numbers.need = need.amount!
    evidence.push(noteEvidence(need))
    if (short > 0) {
      numbers.shortfall = short
      title = `Liquidität ${chf(cash.value, cur)} (${pct(cash.share)}), unter dem Bedarf von ${chf(need.amount!, cur)} für ${need.label}`
      detail = `Es fehlen ${chf(short, cur)}. ${detail}`
    } else {
      detail = `Deckt den notierten Bedarf von ${chf(need.amount!, cur)} für ${need.label}. ${detail}`
    }
  }
  const f: Finding = {
    id: findingId(CHECK, client.ref, 'total'), check: CHECK, kind: 'fact', topic: 'liquidity',
    severity: short > 0 ? 'warn' : 'info', title, detail, numbers, evidence,
  }
  return [f]
}
