// profile.tone — how the advisor should talk to this client: one register ("kurz und sachlich" or "ruhig und erklärend")
// plus concrete hints, each from a note or a trait. No signal, no finding: a neutral tone needs no advice.
import type { Check, Evidence, Finding } from '../types.ts'
import { findingId } from './common.ts'
import { noteEvidence, signalsOf } from './profile-signals.ts'
import { traitsOf, type TraitKey } from './profile-traits.ts'

const CHECK = 'profile.tone'
const TOPIC = 'profile'

export const REGISTER = { brief: 'kurz und sachlich', calm: 'ruhig und erklärend', mixed: 'sachlich, bei Bedarf erklären' } as const

export const tone: Check = (raw, ctx) => {
  const s = signalsOf(raw, ctx)
  const traits = traitsOf(s)
  const trait = (k: TraitKey) => traits.find((t) => t.key === k)

  // Each signal adds weight to one register; notes weigh more than inferred traits.
  let brief = 0, calm = 0
  const briefWhy: string[] = [], calmWhy: string[] = []
  const briefEv: Evidence[] = [], calmEv: Evidence[] = []
  const add = (side: 'brief' | 'calm', w: number, why: string, ev: Evidence[]) => {
    if (side === 'brief') { brief += w; briefWhy.push(why); briefEv.push(...ev) } else { calm += w; calmWhy.push(why); calmEv.push(...ev) }
  }
  const briefNotes = s.has('brief')
  if (briefNotes.length) add('brief', 2, 'schwer erreichbar oder wenig Kontakt gewünscht', briefNotes.map(noteEvidence))
  if (s.client.isCompany) add('brief', 1, 'Firmenkunde', [{ source: 'Kundendatei', quote: 'IsClientACompany' }])
  for (const [k, side, w, why] of [
    ['autonomy', 'brief', 1, 'entscheidet gern selbst'],
    ['loss-calm', 'brief', 1, 'gelassen bei Schwankungen'],
    ['steady', 'brief', 1, 'will wenige Anpassungen'],
    ['loss-reacts', 'calm', 2, 'reagiert eher auf Verluste'],
    ['risk-careful', 'calm', 1, 'vorsichtiger als das Profil'],
    ['control', 'calm', 1, 'will vor Änderungen informiert sein'],
  ] as const) {
    const t = trait(k)
    if (t) add(side, w, why, t.evidence.slice(0, 2))
  }

  const out: Finding[] = []
  const ref = s.client.ref
  if (brief || calm) {
    const register = brief > calm ? REGISTER.brief : calm > brief ? REGISTER.calm : REGISTER.mixed
    const why = brief > calm ? briefWhy : calm > brief ? calmWhy : [...briefWhy, ...calmWhy]
    out.push({
      id: findingId(CHECK, ref, 'register'), check: CHECK, kind: 'action', severity: 'info', topic: TOPIC,
      title: `Ton: ${register}`,
      detail: `Weil: ${why.join(', ')}.`,
      numbers: { brief, calm },
      evidence: brief > calm ? briefEv : calm > brief ? calmEv : [...briefEv, ...calmEv],
    })
  }

  // Concrete hints. Titles are short so the briefing can list them after the register.
  const hint = (key: string, title: string, evidence: Evidence[]) => {
    if (evidence.length) out.push({ id: findingId(CHECK, ref, `hint:${key}`), check: CHECK, kind: 'action', severity: 'info', topic: TOPIC, title, evidence })
  }
  const email = briefNotes.some((n) => /email/i.test(n.text))
  if (briefNotes.length) hint('short', email ? 'kurz halten, Details per E-Mail nachreichen' : 'kurz halten', briefNotes.map(noteEvidence))
  const autonomy = trait('autonomy')
  if (autonomy) hint('options', 'Optionen zur Wahl statt fertiger Empfehlung', autonomy.evidence.slice(0, 3))
  const controlNotes = s.has('control').filter((n) => !n.signals.includes('written'))
  if (controlNotes.length) hint('ask-first', 'vor jeder Änderung Rückfrage anbieten, nichts im selben Gespräch umsetzen', controlNotes.map(noteEvidence))
  const written = s.has('written')
  if (written.length) hint('written', 'schriftliche Zusammenfassung zusagen', written.map(noteEvidence))
  const discreet = s.has('discreet')
  if (discreet.length) hint('discreet', 'mündlich und diskret, wenig Schriftliches', discreet.map(noteEvidence))
  const reacts = trait('loss-reacts')
  if (reacts) hint('losses', 'Schwankungen einordnen, nicht kleinreden', reacts.evidence.slice(0, 3))
  const calmTrait = trait('loss-calm')
  if (calmTrait && !reacts) hint('long-view', 'langfristige Sicht betonen, keine Hektik', calmTrait.evidence.slice(0, 3))
  const values = trait('values')
  if (values) hint('values', 'Nachhaltigkeit von sich aus ansprechen', values.evidence.slice(0, 3))
  return out
}
