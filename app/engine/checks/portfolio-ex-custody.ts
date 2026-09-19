// portfolio.ex-custody — assets the client holds at another bank, imported from a statement (N3).
// One fact per ex-custody portfolio: value, share of the client's total and the statement date. Every other
// check already treats the portfolio like any other; this one makes sure the briefing names it as such.
import { chf, dateCh, pct } from '../format.ts'
import type { Check, Finding } from '../types.ts'
import { SRC, clientOf, findingId } from './common.ts'

const CHECK = 'portfolio.ex-custody'

export const exCustody: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const external = client.portfolios.filter((p) => p.isExCustody)
  if (!external.length) return []
  const total = client.portfolios.reduce((a, p) => a + Math.max(0, p.value), 0)
  return external.map((p): Finding => {
    const share = total > 0 ? p.value / total : 0
    const bank = p.name?.split(' · ')[1]
    const securities = p.positions.filter((x) => x.kind === 'security')
    // Positions the bank's own master data does not know: classified from the statement, a best guess.
    const guessed = securities.filter((x) => x.securityId === undefined || x.securityId < 0).reduce((a, x) => a + x.weight, 0)
    return {
      id: findingId(CHECK, client.ref, p.nr), check: CHECK, kind: 'fact', severity: 'info', topic: 'allocation',
      title: `${p.nr}${bank ? ` bei ${bank}` : ''}: ${chf(p.value, p.currency ?? client.currency)}, ${pct(share)} des Gesamtvermögens (Auszug vom ${dateCh(p.riskDate)})`,
      detail: `Ex-custody: Vermögen bei einer anderen Bank, aus dem Auszug übernommen. ${securities.length} Wertschriften und ${p.positions.length - securities.length} Konten; ${pct(guessed)} des Fremddepots sind nicht in unseren Stammdaten und nach dem Auszug eingeordnet.`,
      numbers: { value: p.value, share, positions: p.positions.length, guessedShare: guessed },
      evidence: [{ ...SRC.portfolio(p.nr), source: 'Fremddepot (Auszug)', date: p.riskDate }],
    }
  })
}
