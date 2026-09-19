// profile.persona — one German sentence that describes the client: life stage, pension, the two strongest traits, interests.
// Built only from profile.trait and the client's own fields; no names, no gender (the data has none we may use).
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

export function personaLine(s: Signals): { text: string; evidence: Evidence[] } | undefined {
  const traits = traitsOf(s)
  const parts: string[] = []
  const evidence: Evidence[] = []
  if (s.stage) {
    const retiring = (s.age ?? 0) >= 50 && s.notes.some((n) => /retire in the next two years/i.test(n.text))
    parts.push(retiring && s.stage !== 'company' ? `Pensionierung in Sicht (${s.age} Jahre)` : STAGE[s.stage](s.age))
    evidence.push(s.stage === 'company' ? { source: 'Kundendatei', quote: 'IsClientACompany' } : { source: 'Kundendatei', quote: 'Birthday' })
  }
  if (s.pension) {
    if (parts.length) parts[parts.length - 1] += ', mit Vorsorgeportfolio'
    else parts.push('Mit Vorsorgeportfolio')
    evidence.push({ source: 'Portfolio', ref: s.client.portfolios.find((p) => /vorsorge|pension/i.test(`${p.service ?? ''} ${p.name ?? ''}`))?.nr, quote: 'Vorsorge' })
  }
  const lead = traits.filter((t) => t.adjective).slice(0, TRAITS_IN_LINE)
  if (lead.length) {
    parts.push(`wirkt eher ${lead.map((t) => t.adjective).join(' und ')}`)
    evidence.push(...lead.flatMap((t) => t.evidence.slice(0, 2)))
  }
  const interests = traits.find((t) => t.key === 'interests')
  if (interests) {
    parts.push(interests.title)
    evidence.push(...interests.evidence.slice(0, 2))
  }
  // Life stage alone is not a persona.
  if (!lead.length && !interests) return undefined
  const text = parts.join('; ')
  const unique = evidence.filter((e, i) => evidence.findIndex((x) => JSON.stringify(x) === JSON.stringify(e)) === i)
  return { text: `${text.charAt(0).toUpperCase()}${text.slice(1)}.`, evidence: unique }
}

export const persona: Check = (raw, ctx) => {
  const s = signalsOf(raw, ctx)
  const line = personaLine(s)
  if (!line || !line.evidence.length) return []
  return [{
    id: findingId(CHECK, s.client.ref, 'line'), check: CHECK, kind: 'interpretation', severity: 'info', topic: 'profile',
    title: line.text,
    detail: 'Aus Notizen, Vorschlägen, Beständen und Stammdaten abgeleitet: eine Tendenz, kein Urteil.',
    numbers: s.age !== undefined ? { age: s.age } : undefined,
    evidence: line.evidence,
  }]
}
