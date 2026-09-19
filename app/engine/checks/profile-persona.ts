// profile.persona — one sentence that describes the client: life stage, pension, the two strongest traits, interests.
// Built only from profile.trait and the client's own fields; no names, no gender (the data has none we may use).
// German joins its fragments with semicolons; English builds its own sentence from English fragments.
import { pick, sourceName, type Lang } from '../lang.ts'
import type { Check, Evidence } from '../types.ts'
import { findingId } from './common.ts'
import { signalsOf, type LifeStage, type Signals } from './profile-signals.ts'
import { traitsOf } from './profile-traits.ts'

const CHECK = 'profile.persona'
const TRAITS_IN_LINE = 2

const STAGE: Record<LifeStage, (age?: number) => string> = {
  company: () => 'Firmenkunde',
  minor: (a) => `Minderjährig (${a} Jahre)`,
  early: (a) => `In der Aufbauphase (${a} Jahre)`,
  mid: (a) => `Mitten im Berufsleben (${a} Jahre)`,
  'pre-retirement': (a) => `In den Jahren vor der Pensionierung (${a} Jahre)`,
  retired: (a) => `Im Pensionsalter (${a} Jahre)`,
}
// English: a noun phrase the rest of the sentence hangs on ("A client in mid-career (aged 45) who tends to be …").
const STAGE_EN: Record<LifeStage, (age?: number) => string> = {
  company: () => 'A corporate client',
  minor: (a) => `A minor (aged ${a})`,
  early: (a) => `A client building up assets (aged ${a})`,
  mid: (a) => `A client in mid-career (aged ${a})`,
  'pre-retirement': (a) => `A client in the years before retirement (aged ${a})`,
  retired: (a) => `A client of retirement age (aged ${a})`,
}

export function personaLine(s: Signals, lang?: Lang): { text: string; evidence: Evidence[] } | undefined {
  const t = pick(lang)
  const traits = traitsOf(s, lang)
  const lead = traits.filter((x) => x.adjective).slice(0, TRAITS_IN_LINE)
  const interests = traits.find((x) => x.key === 'interests')
  // Life stage alone is not a persona.
  if (!lead.length && !interests) return undefined

  const evidence: Evidence[] = []
  if (s.stage) evidence.push({ source: sourceName('clientFile', lang), quote: s.stage === 'company' ? 'IsClientACompany' : 'Birthday' })
  if (s.pension) evidence.push({ source: sourceName('portfolio', lang), ref: s.client.portfolios.find((p) => /vorsorge|pension/i.test(`${p.service ?? ''} ${p.name ?? ''}`))?.nr, quote: t('Vorsorge', 'Pension') })
  evidence.push(...lead.flatMap((x) => x.evidence.slice(0, 2)))
  if (interests) evidence.push(...interests.evidence.slice(0, 2))
  const unique = evidence.filter((e, i) => evidence.findIndex((x) => JSON.stringify(x) === JSON.stringify(e)) === i)

  const retiring = !!s.stage && s.stage !== 'company' && (s.age ?? 0) >= 50 && s.notes.some((n) => /retire in the next two years/i.test(n.text))
  if (lang === 'en') {
    const who = retiring ? `A client nearing retirement (aged ${s.age})` : s.stage ? STAGE_EN[s.stage](s.age) : 'A client'
    const tends = lead.length ? ` ${s.stage === 'company' ? 'that' : 'who'} tends to be ${lead.map((x) => x.adjective).join(' and ')}` : ''
    const head = `${who}${s.pension ? ' with a pension portfolio' : ''}${tends}`
    return { text: `${[head, ...(interests ? [interests.line ?? interests.title] : [])].join('; ')}.`, evidence: unique }
  }
  const parts: string[] = []
  if (s.stage) parts.push(retiring ? `Pensionierung in Sicht (${s.age} Jahre)` : STAGE[s.stage](s.age))
  if (s.pension) {
    if (parts.length) parts[parts.length - 1] += ', mit Vorsorgeportfolio'
    else parts.push('Mit Vorsorgeportfolio')
  }
  if (lead.length) parts.push(`wirkt eher ${lead.map((x) => x.adjective).join(' und ')}`)
  if (interests) parts.push(interests.title)
  const text = parts.join('; ')
  return { text: `${text.charAt(0).toUpperCase()}${text.slice(1)}.`, evidence: unique }
}

export const persona: Check = (raw, ctx) => {
  const s = signalsOf(raw, ctx)
  const t = pick(ctx.lang)
  const line = personaLine(s, ctx.lang)
  if (!line || !line.evidence.length) return []
  return [{
    id: findingId(CHECK, s.client.ref, 'line'), check: CHECK, kind: 'interpretation', severity: 'info', topic: 'profile',
    title: line.text,
    detail: t('Aus Notizen, Vorschlägen, Beständen und Stammdaten abgeleitet: eine Tendenz, kein Urteil.', 'Derived from notes, proposals, holdings and master data: a tendency, not a verdict.'),
    numbers: s.age !== undefined ? { age: s.age } : undefined,
    evidence: line.evidence,
  }]
}
