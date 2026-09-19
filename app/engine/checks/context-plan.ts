// context.plan — a plan note whose time window is still running (retirement in two years, a tax payment, ...),
// or an open-ended plan (an expected inheritance). A fact with the months left, so the advisor can bring it up.
// Title contract with server/ai/briefing.ts: '<Label>: noch N Monate (bis DD.MM.YYYY)'; the label before ':' becomes
// "Geht es um Ihre Pensionierung?", the detail carries the question ending in '?', numbers.monthsLeft.
// English (ctx.lang 'en') keeps the shape: '<Label>: N months left (until DD.MM.YYYY)'.
import { chf, dateCh, pct } from '../format.ts'
import { pick, type Lang } from '../lang.ts'
import { noteEvidence, planLabel, planQuestion, planSummary, planWindows } from '../notes.ts'
import type { Check, Finding } from '../types.ts'
import { clientOf, findingId } from './common.ts'
import { liquidityOf } from './portfolio-liquidity.ts'

const CHECK = 'context.plan'

const left = (n: number, lang?: Lang) => (lang === 'en'
  ? (n === 0 ? 'less than 1 month left' : n === 1 ? '1 month left' : `${n} months left`)
  : (n === 0 ? 'noch weniger als 1 Monat' : n === 1 ? 'noch 1 Monat' : `noch ${n} Monate`))

export const plan: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const cash = liquidityOf(client)
  const lang = ctx.lang, t = pick(lang)
  return planWindows(client.notes, ctx.now).filter((w) => !w.expired).map((w): Finding => {
    const numbers: Record<string, number> = {}
    if (w.monthsLeft !== undefined) numbers.monthsLeft = w.monthsLeft
    if (w.ageMonths !== undefined) numbers.ageMonths = w.ageMonths
    if (w.amount !== undefined) numbers.amount = w.amount
    if (w.topic === 'liquidity' && cash.aum > 0) numbers.liquidityShare = cash.share
    const detail = [
      t(`Notiz${w.date ? ` vom ${dateCh(w.date)}` : ''}: ${w.de}.`, `Note${w.date ? ` of ${dateCh(w.date)}` : ''}: ${w.en}.`),
      w.topic === 'liquidity' && cash.aum > 0 ? `${t('Liquidität heute', 'Liquidity today')}: ${pct(cash.share)} (${chf(cash.value, client.currency)}).` : '',
      planQuestion(w, lang),
    ].filter(Boolean).join(' ')
    return {
      id: findingId(CHECK, client.ref, w.key), check: CHECK, kind: 'fact', severity: 'info', topic: w.topic,
      title: w.due && w.monthsLeft !== undefined
        ? `${planLabel(w, lang)}: ${left(w.monthsLeft, lang)} (${t('bis', 'until')} ${dateCh(w.due)})`
        : `${planLabel(w, lang)}: ${planSummary(w, lang)}`,
      detail, numbers, evidence: [noteEvidence(w, lang)],
    }
  })
}
