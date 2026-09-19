// portfolio.liquidity — cash across all portfolios (account positions), as a share of the client's wealth and in CHF.
// When a running plan note names an amount (e.g. CHF 15'000 for the Q1 tax payment), the cash is compared with it.
//
// Data trap: the client-level LiquidityInDefaultCurrency is half the portfolio sum on CASE-038, so the cash is summed
// per portfolio (LiquidityInDefaultCurrency, in the reporting currency), falling back to the account positions.
import type { Client } from '../data.ts'
import { chf, pct } from '../format.ts'
import { pick, sourceName } from '../lang.ts'
import { noteEvidence, planLabel, planWindows } from '../notes.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { clientOf, findingId, srcOf } from './common.ts'

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
  const t = pick(ctx.lang)
  const SRC = srcOf(ctx.lang)
  const cash = liquidityOf(client)
  if (cash.aum <= 0) return []
  const cur = client.currency
  // The nearest running plan that names an amount; an expired one may already be paid.
  const need = planWindows(client.notes, ctx.now).filter((w) => !w.expired && w.topic === 'liquidity' && w.amount !== undefined)
    .sort((a, b) => (a.monthsLeft ?? Infinity) - (b.monthsLeft ?? Infinity))[0]
  const short = need && cash.value < need.amount! ? need.amount! - cash.value : 0

  const numbers: Record<string, number> = { share: cash.share, value: cash.value }
  const evidence: Evidence[] = client.portfolios.map((p) => SRC.portfolio(p.nr))
  if (!evidence.length) evidence.push({ source: sourceName('clientFile', ctx.lang), quote: 'LiquidityInDefaultCurrency' })
  let title = `${t('Liquidität', 'Liquidity')} ${pct(cash.share)} (${chf(cash.value, cur)})`
  let detail = t('Summe der Kontopositionen über alle Portfolios.', 'Sum of the account positions across all portfolios.')
  if (need) {
    numbers.need = need.amount!
    evidence.push(noteEvidence(need, ctx.lang))
    // English labels are capitalised ('Tax payment'); inside the sentence they run in lower case.
    const label = t(need.label, planLabel(need, 'en').replace(/^./, (x) => x.toLowerCase()))
    if (short > 0) {
      numbers.shortfall = short
      title = t(
        `Liquidität ${chf(cash.value, cur)} (${pct(cash.share)}), unter dem Bedarf von ${chf(need.amount!, cur)} für ${label}`,
        `Liquidity ${chf(cash.value, cur)} (${pct(cash.share)}), below the ${chf(need.amount!, cur)} needed for ${label}`,
      )
      detail = `${t(`Es fehlen ${chf(short, cur)}.`, `${chf(short, cur)} is missing.`)} ${detail}`
    } else {
      detail = `${t(`Deckt den notierten Bedarf von ${chf(need.amount!, cur)} für ${label}.`, `Covers the noted need of ${chf(need.amount!, cur)} for ${label}.`)} ${detail}`
    }
  }
  const f: Finding = {
    id: findingId(CHECK, client.ref, 'total'), check: CHECK, kind: 'fact', topic: 'liquidity',
    severity: short > 0 ? 'warn' : 'info', title, detail, numbers, evidence,
  }
  return [f]
}
