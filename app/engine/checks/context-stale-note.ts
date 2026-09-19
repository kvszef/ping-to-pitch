// context.stale-note — a plan note whose time window has passed (a property purchase "within 12 months", noted two
// years ago). It may be done or dropped, so it is an action: ask, don't state. The detail is the question to ask.
// Title contract with server/ai/cards.ts: 'Veraltet: <Label> – Zeitfenster lief am DD.MM.YYYY ab (Notiz vom …)',
// numbers.ageMonths, evidence source 'Kundennotiz'. Open-ended plans count as stale after OPEN_PLAN_STALE_MONTHS.
import { dateCh } from '../format.ts'
import { noteEvidence, OPEN_PLAN_STALE_MONTHS, planWindows } from '../notes.ts'
import type { Check, Finding } from '../types.ts'
import { clientOf, findingId } from './common.ts'

const CHECK = 'context.stale-note'

export const staleNote: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  return planWindows(client.notes, ctx.now).filter((w) => w.expired).map((w): Finding => {
    const numbers: Record<string, number> = { ageMonths: w.ageMonths ?? 0 }
    if (w.overdueMonths !== undefined) numbers.overdueMonths = w.overdueMonths
    const since = `Notiz vom ${dateCh(w.date)}`
    return {
      id: findingId(CHECK, client.ref, w.key), check: CHECK, kind: 'action', severity: 'warn', topic: w.topic,
      title: w.due
        ? `Veraltet: ${w.label} – Zeitfenster lief am ${dateCh(w.due)} ab (${since})`
        : `Veraltet: ${w.label} – seit ${w.ageMonths} Monaten offen, ohne Frist (${since}, Schwelle ${OPEN_PLAN_STALE_MONTHS} Monate)`,
      detail: w.question, numbers, evidence: [noteEvidence(w)],
    }
  })
}
