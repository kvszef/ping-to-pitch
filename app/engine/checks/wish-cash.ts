// wish.cash — "keep a cash reserve" against the cash the client really has (E2). Cash = the account positions
// of all portfolios, in the reporting currency; the client file's own LiquidityInDefaultCurrency is shown next
// to it. With an amount ("CHF 15,000"): covered ('ok') or short ('warn'). Without one: the cash share as info.
import { chf, pct } from '../format.ts'
import { pick, prefix, sourceName } from '../lang.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { wishesOf, wishText } from '../wishes.ts'
import { clientOf, findingId } from './common.ts'
import { heldSecurities, noteEvidence, subjectOf, uniqueIds } from './wish-common.ts'

const CHECK = 'wish.cash'

export const cash: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const unique = uniqueIds()
  const { lang } = ctx
  const t = pick(lang)
  const out: Finding[] = []
  const { cash: accounts, cashShare } = heldSecurities(client)
  const cur = client.currency
  const fileLiquidity = client.liquidity !== undefined ? t(` Liquidität laut Kundendatei: ${chf(client.liquidity, cur)}.`, ` Liquidity as per the client file: ${chf(client.liquidity, cur)}.`) : ''
  const sources: Evidence[] = [
    { source: sourceName('accounts', lang), quote: t(`Kontoguthaben aller Portfolios: ${chf(accounts, cur)}`, `Account balances of all portfolios: ${chf(accounts, cur)}`) },
    { source: sourceName('clientFile', lang), quote: 'LiquidityInDefaultCurrency' },
  ]

  for (const w of wishesOf(client, ctx).wishes) {
    if (w.wish.type !== 'keep-cash') continue
    const id = unique(findingId(CHECK, client.ref, subjectOf(w)))
    const wished = `${prefix('wish', lang)}«${wishText(w, lang)}»`
    const numbers: Record<string, number> = { cash: accounts, cashShare, ...(client.liquidity !== undefined ? { liquidity: client.liquidity } : {}) }
    const amount = w.wish.amountChf
    if (amount !== undefined && cur === 'CHF') {
      const gap = amount - accounts
      out.push({
        id, check: CHECK, kind: 'fact', severity: gap > 0 ? 'warn' : 'ok', topic: 'liquidity',
        numbers: { ...numbers, amount, gap: Math.max(0, gap) },
        title: gap > 0
          ? t(`${wished} nicht gedeckt: Konten ${chf(accounts)}, es fehlen ${chf(gap)}`, `${wished} not covered: accounts ${chf(accounts)}, short by ${chf(gap)}`)
          : t(`${wished} gedeckt: Konten ${chf(accounts)} (${pct(cashShare)} des Vermögens)`, `${wished} covered: accounts ${chf(accounts)} (${pct(cashShare)} of total assets)`),
        detail: `${t('Kontoguthaben aller Portfolios.', 'Account balances of all portfolios.')}${fileLiquidity}`,
        evidence: [noteEvidence(w, lang), ...sources],
      })
      continue
    }
    out.push({
      id, check: CHECK, kind: 'fact', severity: 'info', topic: 'liquidity', numbers,
      title: t(`${wished}: Konten heute ${chf(accounts, cur)} (${pct(cashShare)} des Vermögens)`, `${wished}: accounts today ${chf(accounts, cur)} (${pct(cashShare)} of total assets)`),
      detail: `${amount !== undefined
        ? t(`Betrag in CHF, Kunde rechnet in ${cur}: nicht verglichen. `, `Amount in CHF, the client reports in ${cur}: not compared. `)
        : t('Kein Betrag genannt: nachfragen, wie viel Reserve gemeint ist. ', 'No amount stated: ask how large a reserve is meant. ')}${fileLiquidity.trim()}`.trim(),
      evidence: [noteEvidence(w, lang), ...sources],
    })
  }
  return out
}
