// wish.cash — "keep a cash reserve" against the cash the client really has (E2). Cash = the account positions
// of all portfolios, in the reporting currency; the client file's own LiquidityInDefaultCurrency is shown next
// to it. With an amount ("CHF 15,000"): covered ('ok') or short ('warn'). Without one: the cash share as info.
import { chf, pct } from '../format.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { wishesOf } from '../wishes.ts'
import { clientOf, findingId } from './common.ts'
import { heldSecurities, noteEvidence, subjectOf, uniqueIds } from './wish-common.ts'

const CHECK = 'wish.cash'

export const cash: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const unique = uniqueIds()
  const out: Finding[] = []
  const { cash: accounts, cashShare } = heldSecurities(client)
  const cur = client.currency
  const fileLiquidity = client.liquidity !== undefined ? ` Liquidität laut Kundendatei: ${chf(client.liquidity, cur)}.` : ''
  const sources: Evidence[] = [{ source: 'Konten', quote: `Kontoguthaben aller Portfolios: ${chf(accounts, cur)}` }, { source: 'Kundendatei', quote: 'LiquidityInDefaultCurrency' }]

  for (const w of wishesOf(client, ctx).wishes) {
    if (w.wish.type !== 'keep-cash') continue
    const id = unique(findingId(CHECK, client.ref, subjectOf(w)))
    const numbers: Record<string, number> = { cash: accounts, cashShare, ...(client.liquidity !== undefined ? { liquidity: client.liquidity } : {}) }
    const amount = w.wish.amountChf
    if (amount !== undefined && cur === 'CHF') {
      const gap = amount - accounts
      out.push({
        id, check: CHECK, kind: 'fact', severity: gap > 0 ? 'warn' : 'ok', topic: 'liquidity',
        numbers: { ...numbers, amount, gap: Math.max(0, gap) },
        title: gap > 0
          ? `Wunsch «${w.de}» nicht gedeckt: Konten ${chf(accounts)}, es fehlen ${chf(gap)}`
          : `Wunsch «${w.de}» gedeckt: Konten ${chf(accounts)} (${pct(cashShare)} des Vermögens)`,
        detail: `Kontoguthaben aller Portfolios.${fileLiquidity}`,
        evidence: [noteEvidence(w), ...sources],
      })
      continue
    }
    out.push({
      id, check: CHECK, kind: 'fact', severity: 'info', topic: 'liquidity', numbers,
      title: `Wunsch «${w.de}»: Konten heute ${chf(accounts, cur)} (${pct(cashShare)} des Vermögens)`,
      detail: `${amount !== undefined ? `Betrag in CHF, Kunde rechnet in ${cur}: nicht verglichen. ` : 'Kein Betrag genannt: nachfragen, wie viel Reserve gemeint ist. '}${fileLiquidity.trim()}`.trim(),
      evidence: [noteEvidence(w), ...sources],
    })
  }
  return out
}
