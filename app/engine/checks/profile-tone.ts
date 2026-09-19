// profile.tone — how the advisor should talk to this client: one register ("kurz und sachlich" or "ruhig und erklärend")
// plus concrete hints, each from a note or a trait. No signal, no finding: a neutral tone needs no advice.
// The register title carries the 'tone' prefix from lang.ts; readers take it off with stripPrefix().
import { pick, prefix, sourceName } from '../lang.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { findingId } from './common.ts'
import { noteEvidence, signalsOf, type ReadNote } from './profile-signals.ts'
import { traitsOf, type TraitKey } from './profile-traits.ts'

const CHECK = 'profile.tone'
const TOPIC = 'profile'

export const REGISTER = { brief: 'kurz und sachlich', calm: 'ruhig und erklärend', mixed: 'sachlich, bei Bedarf erklären' } as const
export const REGISTER_EN = { brief: 'brief and factual', calm: 'calm and explanatory', mixed: 'factual, explain where needed' } as const

export const tone: Check = (raw, ctx) => {
  const s = signalsOf(raw, ctx)
  const t = pick(ctx.lang)
  const noteEv = (n: ReadNote) => noteEvidence(n, ctx.lang)
  const traits = traitsOf(s, ctx.lang)
  const trait = (k: TraitKey) => traits.find((x) => x.key === k)

  // Each signal adds weight to one register; notes weigh more than inferred traits.
  let brief = 0, calm = 0
  const briefWhy: string[] = [], calmWhy: string[] = []
  const briefEv: Evidence[] = [], calmEv: Evidence[] = []
  const add = (side: 'brief' | 'calm', w: number, why: string, ev: Evidence[]) => {
    if (side === 'brief') { brief += w; briefWhy.push(why); briefEv.push(...ev) } else { calm += w; calmWhy.push(why); calmEv.push(...ev) }
  }
  const briefNotes = s.has('brief')
  if (briefNotes.length) add('brief', 2, t('schwer erreichbar oder wenig Kontakt gewünscht', 'hard to reach or wants little contact'), briefNotes.map(noteEv))
  if (s.client.isCompany) add('brief', 1, t('Firmenkunde', 'corporate client'), [{ source: sourceName('clientFile', ctx.lang), quote: 'IsClientACompany' }])
  for (const [k, side, w, why, whyEn] of [
    ['autonomy', 'brief', 1, 'entscheidet gern selbst', 'likes to decide alone'],
    ['loss-calm', 'brief', 1, 'gelassen bei Schwankungen', 'calm when markets swing'],
    ['steady', 'brief', 1, 'will wenige Anpassungen', 'wants few adjustments'],
    ['loss-reacts', 'calm', 2, 'reagiert eher auf Verluste', 'tends to react to losses'],
    ['risk-careful', 'calm', 1, 'vorsichtiger als das Profil', 'more cautious than the risk profile'],
    ['control', 'calm', 1, 'will vor Änderungen informiert sein', 'wants to be informed before changes'],
  ] as const) {
    const x = trait(k)
    if (x) add(side, w, t(why, whyEn), x.evidence.slice(0, 2))
  }

  const out: Finding[] = []
  const ref = s.client.ref
  if (brief || calm) {
    const registers = ctx.lang === 'en' ? REGISTER_EN : REGISTER
    const register = brief > calm ? registers.brief : calm > brief ? registers.calm : registers.mixed
    const why = brief > calm ? briefWhy : calm > brief ? calmWhy : [...briefWhy, ...calmWhy]
    out.push({
      id: findingId(CHECK, ref, 'register'), check: CHECK, kind: 'action', severity: 'info', topic: TOPIC,
      title: `${prefix('tone', ctx.lang)}${register}`,
      detail: t(`Weil: ${why.join(', ')}.`, `Because: ${why.join(', ')}.`),
      numbers: { brief, calm },
      evidence: brief > calm ? briefEv : calm > brief ? calmEv : [...briefEv, ...calmEv],
    })
  }

  // Concrete hints. Titles are short so the briefing can list them after the register.
  const hint = (key: string, title: string, evidence: Evidence[]) => {
    if (evidence.length) out.push({ id: findingId(CHECK, ref, `hint:${key}`), check: CHECK, kind: 'action', severity: 'info', topic: TOPIC, title, evidence })
  }
  const email = briefNotes.some((n) => /email/i.test(n.text))
  if (briefNotes.length) hint('short', email ? t('kurz halten, Details per E-Mail nachreichen', 'keep it short, send the details by email') : t('kurz halten', 'keep it short'), briefNotes.map(noteEv))
  const autonomy = trait('autonomy')
  if (autonomy) hint('options', t('Optionen zur Wahl statt fertiger Empfehlung', 'offer options to choose from, not a finished recommendation'), autonomy.evidence.slice(0, 3))
  const controlNotes = s.has('control').filter((n) => !n.signals.includes('written'))
  if (controlNotes.length) hint('ask-first', t('vor jeder Änderung Rückfrage anbieten, nichts im selben Gespräch umsetzen', 'offer to check back before any change, carry out nothing during the same call'), controlNotes.map(noteEv))
  const written = s.has('written')
  if (written.length) hint('written', t('schriftliche Zusammenfassung zusagen', 'promise a written summary'), written.map(noteEv))
  const discreet = s.has('discreet')
  if (discreet.length) hint('discreet', t('mündlich und diskret, wenig Schriftliches', 'verbal and discreet, little in writing'), discreet.map(noteEv))
  const reacts = trait('loss-reacts')
  if (reacts) hint('losses', t('Schwankungen einordnen, nicht kleinreden', 'put market swings into context, do not play them down'), reacts.evidence.slice(0, 3))
  const calmTrait = trait('loss-calm')
  if (calmTrait && !reacts) hint('long-view', t('langfristige Sicht betonen, keine Hektik', 'stress the long view, no rush'), calmTrait.evidence.slice(0, 3))
  const values = trait('values')
  if (values) hint('values', t('Nachhaltigkeit von sich aus ansprechen', 'raise sustainability without being asked'), values.evidence.slice(0, 3))
  return out
}
