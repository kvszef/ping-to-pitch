// context.plan — a plan note whose time window is still running (retirement in two years, a tax payment, ...),
// or an open-ended plan (an expected inheritance). A fact with the months left, so the advisor can bring it up.
// Title contract with server/ai/briefing.ts: '<Label>: noch N Monate (bis DD.MM.YYYY)'; the label before ':' becomes
// "Geht es um Ihre Pensionierung?", the detail carries the question ending in '?', numbers.monthsLeft.
import { chf, dateCh, pct } from '../format.ts'
import { noteEvidence, planWindows } from '../notes.ts'
import type { Check, Finding } from '../types.ts'
import { clientOf, findingId } from './common.ts'
import { liquidityOf } from './portfolio-liquidity.ts'

const CHECK = 'context.plan'

const left = (n: number) => (n === 0 ? 'noch weniger als 1 Monat' : n === 1 ? 'noch 1 Monat' : `noch ${n} Monate`)

export const plan: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const cash = liquidityOf(client)
  return planWindows(client.notes, ctx.now).filter((w) => !w.expired).map((w): Finding => {
    const numbers: Record<string, number> = {}
    if (w.monthsLeft !== undefined) numbers.monthsLeft = w.monthsLeft
    if (w.ageMonths !== undefined) numbers.ageMonths = w.ageMonths
    if (w.amount !== undefined) numbers.amount = w.amount
    if (w.topic === 'liquidity' && cash.aum > 0) numbers.liquidityShare = cash.share
    const detail = [
      `Notiz${w.date ? ` vom ${dateCh(w.date)}` : ''}: ${w.de}.`,
      w.topic === 'liquidity' && cash.aum > 0 ? `Liquidität heute: ${pct(cash.share)} (${chf(cash.value, client.currency)}).` : '',
      w.question,
    ].filter(Boolean).join(' ')
    return {
      id: findingId(CHECK, client.ref, w.key), check: CHECK, kind: 'fact', severity: 'info', topic: w.topic,
      title: w.due && w.monthsLeft !== undefined ? `${w.label}: ${left(w.monthsLeft)} (bis ${dateCh(w.due)})` : `${w.label}: ${w.de}`,
      detail, numbers, evidence: [noteEvidence(w)],
    }
  })
}
