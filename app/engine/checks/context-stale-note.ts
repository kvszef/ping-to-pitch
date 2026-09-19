// context.stale-note — a plan note whose time window has passed (a property purchase "within 12 months", noted two
// years ago). It may be done or dropped, so it is an action: ask, don't state. The detail is the question to ask.
// Title contract with server/ai/cards.ts: 'Veraltet: <Label> – Zeitfenster lief am DD.MM.YYYY ab (Notiz vom …)',
// numbers.ageMonths, evidence source 'Kundennotiz'. Open-ended plans count as stale after OPEN_PLAN_STALE_MONTHS.
// English (ctx.lang 'en'): 'Outdated: <Label> – time window ended on DD.MM.YYYY (note of …)', source 'Client note';
// readers use hasPrefix/stripPrefix(title, 'outdated') and isSource(source, 'note') from lang.ts.
import { dateCh } from '../format.ts'
import { pick, prefix } from '../lang.ts'
import { noteEvidence, OPEN_PLAN_STALE_MONTHS, planLabel, planQuestion, planWindows } from '../notes.ts'
import type { Check, Finding } from '../types.ts'
import { clientOf, findingId } from './common.ts'

const CHECK = 'context.stale-note'

export const staleNote: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const lang = ctx.lang, t = pick(lang)
  return planWindows(client.notes, ctx.now).filter((w) => w.expired).map((w): Finding => {
    const numbers: Record<string, number> = { ageMonths: w.ageMonths ?? 0 }
    if (w.overdueMonths !== undefined) numbers.overdueMonths = w.overdueMonths
    const since = `${t('Notiz vom', 'note of')} ${dateCh(w.date, lang)}`
    const head = `${prefix('outdated', lang)}${planLabel(w, lang)} – `
    return {
      id: findingId(CHECK, client.ref, w.key), check: CHECK, kind: 'action', severity: 'warn', topic: w.topic,
      title: w.due
        ? head + t(`Zeitfenster lief am ${dateCh(w.due)} ab (${since})`, `time window ended on ${dateCh(w.due)} (${since})`)
        : head + t(
          `seit ${w.ageMonths} Monaten offen, ohne Frist (${since}, Schwelle ${OPEN_PLAN_STALE_MONTHS} Monate)`,
          `open for ${w.ageMonths} months, no deadline (${since}, threshold ${OPEN_PLAN_STALE_MONTHS} months)`,
        ),
      detail: planQuestion(w, lang), numbers, evidence: [noteEvidence(w, lang)],
    }
  })
}
