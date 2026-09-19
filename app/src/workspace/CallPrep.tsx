import { Ban, ExternalLink, MessageCircleQuestion, PhoneIncoming, PhoneOutgoing, Quote, Sparkles, Target } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CallPlan, PlanLine } from '../../server/ai/callplan-types'
import type { EngineFinding, TalkLine } from '../types'
import { useTranslated, type Language } from '../data/useTranslate'
import { callReasonsOf } from './callReasons'

// Two ways to look at a client, one per call direction.
//   prep      we call ("Heute anrufen"): why we call, what the call should achieve, how to convince
//             this client. The plan comes from server/ai/callplan.ts.
//   inbound   the client calls: who it is and the 60-second brief, the key facts at a glance.
// The workspace picks the mode from what happens (a call going out or coming in, a client picked
// from today's list); the switch below lets the advisor change it at any time.
export type CallMode = 'prep' | 'inbound'

export function ModeSwitch({ mode, onMode, language }: { mode: CallMode; onMode: (m: CallMode) => void; language: Language }) {
  const [out, inn, outTitle, innTitle] = language === 'en'
    ? ['Outgoing', 'Incoming', 'Prepare the call: reason, goal and arguments', 'The client calls: the key facts at a glance']
    : ['Ausgehend', 'Eingehend', 'Anruf vorbereiten: Anlass, Ziel und Argumente', 'Kunde ruft an: das Wichtigste auf einen Blick']
  const options = [['prep', out, outTitle, PhoneOutgoing], ['inbound', inn, innTitle, PhoneIncoming]] as const
  return (
    <div role="tablist" aria-label="Ansicht" className="flex shrink-0 rounded-full bg-pill/70 p-0.5 text-[11px]">
      {options.map(([id, label, title, Icon]) => (
        <button key={id} role="tab" aria-selected={mode === id} title={title} onClick={() => onMode(id)}
          className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 transition-colors duration-200 ${mode === id ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
          <Icon size={11} /> {label}
        </button>
      ))}
    </div>
  )
}

// Fixed labels as a static pair: they show at once, with no trip to the translation model.
const KIND = { de: { fact: 'Fakt', interpretation: 'Einschätzung', action: 'Massnahme' }, en: { fact: 'Fact', interpretation: 'Assessment', action: 'Action' } } as const
const LABELS = {
  de: { title: 'Anrufplan', why: 'Warum wir anrufen', goal: 'Ziel des Gesprächs', convince: 'So überzeugen Sie diesen Kunden', opener: 'Einstieg', avoid: 'Nicht ansprechen', questions: 'Wahrscheinliche Rückfragen', tone: 'Ton', also: 'ausserdem', none: 'Kein dringender Anlass in den Daten. Ein Anruf dient der Kontaktpflege.', loading: 'Anrufplan wird berechnet …', written: 'KI-formuliert, Zahlen geprüft', writing: 'KI formuliert …', article: 'Artikel öffnen' },
  en: { title: 'Call plan', why: 'Why we are calling', goal: 'Goal of the call', convince: 'How to convince this client', opener: 'Opening line', avoid: 'Do not bring up', questions: 'Questions the client will probably ask', tone: 'Tone', also: 'also', none: 'No pressing reason in the data. A call keeps the relationship warm.', loading: 'Working out the call plan …', written: 'Worded by AI, numbers checked', writing: 'AI is wording it …', article: 'Open article' },
} as const
const dot = (l: PlanLine) => (l.severity === 'risk' ? 'bg-risk' : l.severity === 'warn' ? 'bg-warn' : l.severity === 'ok' ? 'bg-ok' : 'bg-brand')

function Block({ title, icon, aside, children }: { title: string; icon?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-brand/15 pt-2.5 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted">{icon}<span>{title}</span>{aside}</div>
      {children}
    </div>
  )
}

export function CallPrep({ plan, writing, language }: { plan: CallPlan | null; writing: boolean; language: Language }) {
  const lines = plan ? [...plan.reasons, ...plan.goals, ...plan.arguments, plan.open, ...plan.avoid] : []
  // One batch for the plan's own text: [text, source, label] per line, then tone and questions. What the
  // server already phrased in the advisor's language passes through untouched; the rest is the safety net.
  const texts = useTranslated([
    ...lines.flatMap((l) => [l.text, l.source, l.label ?? '']),
    ...(plan?.tone ?? []), ...(plan?.questions ?? []).flatMap((q) => [q.q, q.a]),
  ], language)
  const at = new Map(lines.map((l, i) => [l, i * 3]))
  const t = (l: PlanLine) => ({ text: texts[at.get(l)!] || l.text, source: texts[at.get(l)! + 1] || l.source, label: texts[at.get(l)! + 2] || l.label, kind: KIND[language][l.kind] })
  const toneAt = lines.length * 3
  const questionsAt = toneAt + (plan?.tone.length ?? 0)
  const { title, why, goal, convince, opener, avoid, questions, tone, also, none, loading, written, writing: isWriting, article: openArticle } = LABELS[language]

  const source = (l: PlanLine) => (
    <p className="mt-0.5 text-[10px] text-muted">{t(l).kind} · {t(l).source}{l.date ? `, ${l.date}` : ''}</p>
  )

  return (
    <section className="mb-3 snap-start rounded-xl bg-white/90 px-4 py-3.5 shadow-card ring-1 ring-brand/25">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] text-brand-dark">
        <PhoneOutgoing size={12} /> <span className="uppercase tracking-wide">{title}</span>
        {plan && (writing || plan.phrasedBy !== 'vorlage') && <span className={`ml-auto flex items-center gap-1 text-[10px] text-muted ${writing ? 'animate-pulse' : ''}`}><Sparkles size={10} /> {writing ? isWriting : written}</span>}
      </div>

      {!plan ? <p className="animate-pulse text-[13px] text-muted">{loading}</p> : (
        <div className="space-y-2.5">
          <Block title={why}>
            {!plan.reasons.length && <p className="text-[13px] text-muted">{none}</p>}
            <ul className="space-y-1.5">
              {plan.reasons.map((l, i) => (
                <li key={l.id} className="flex items-start gap-2.5">
                  <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${dot(l)}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`leading-snug ${i === 0 ? 'text-[16px]' : 'text-[14px] text-ink/80'}`}>
                      {t(l).text}
                      {l.url && <a href={l.url} target="_blank" rel="noreferrer" aria-label={openArticle} title={openArticle} className="ml-1.5 inline-flex translate-y-px text-muted hover:text-brand-dark"><ExternalLink size={12} /></a>}
                    </p>
                    {source(l)}
                  </div>
                </li>
              ))}
            </ul>
          </Block>

          {plan.goals.length > 0 && (
            <Block title={goal} icon={<Target size={11} />}>
              <div className="rounded-lg bg-brand-soft/40 px-3 py-2">
                <p className="text-[16px] leading-snug text-ink">{t(plan.goals[0]).text}</p>
                {source(plan.goals[0])}
              </div>
              {plan.goals.slice(1).map((l) => (
                <p key={l.id} className="mt-1.5 px-3 text-[13px] leading-snug text-ink/75"><span className="mr-1.5 text-[10px] uppercase tracking-wide text-muted">{also}</span>{t(l).text}</p>
              ))}
            </Block>
          )}

          {(plan.arguments.length > 0 || plan.tone.length > 0) && (
            <Block title={convince} aside={plan.tone.length > 0 && (
              <span className="ml-auto flex flex-wrap items-center gap-1 normal-case tracking-normal"><span className="text-[10px] uppercase tracking-wide">{tone}</span>
                {plan.tone.map((x, i) => <span key={x} className="rounded-full bg-pill px-2 py-px text-[11px] text-ink/80">{texts[toneAt + i] || x}</span>)}
              </span>
            )}>
              <ol className="space-y-2">
                {plan.arguments.map((l, i) => (
                  <li key={l.id} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] tabular-nums text-brand-dark">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] leading-snug">{l.label && <span className="mr-1.5 text-brand-dark">{t(l).label}.</span>}{t(l).text}</p>
                      {source(l)}
                    </div>
                  </li>
                ))}
              </ol>
            </Block>
          )}

          {plan.open.text && (
            <Block title={opener} icon={<Quote size={11} />}>
              <p className="text-[14px] italic leading-snug text-ink/85">«{t(plan.open).text}»</p>
            </Block>
          )}

          {plan.avoid.length > 0 && (
            <Block title={avoid} icon={<Ban size={11} />}>
              <ul className="space-y-1">{plan.avoid.map((l) => <li key={l.id} className="text-[13px] leading-snug text-ink/75">{t(l).text}</li>)}</ul>
            </Block>
          )}

          {plan.questions.length > 0 && (
            <Block title={questions} icon={<MessageCircleQuestion size={11} />}>
              <dl className="space-y-1.5">
                {plan.questions.map((q, i) => (
                  <div key={q.id}><dt className="text-[13px] leading-snug">{texts[questionsAt + i * 2] || q.q}</dt><dd className="text-[12px] leading-snug text-muted">{texts[questionsAt + i * 2 + 1] || q.a}</dd></div>
                ))}
              </dl>
            </Block>
          )}
        </div>
      )}
    </section>
  )
}

// Incoming view, always the second thing on the page (right under who the client is): why the client
// is probably calling. The engine's ranked guesses (profile.call-reason: an open draft, a bond that
// repays soon, a recent note, a weak month), each with its source. A guess is labelled as one, and
// when the data holds none the card says so instead of inventing a reason.
const WHY = {
  de: { title: 'Warum der Kunde wohl anruft', none: 'Kein naheliegender Anlass in den Daten: offen nachfragen.' },
  en: { title: 'Why the client is probably calling', none: 'No obvious reason in the data: ask openly.' },
} as const

// `fallback`: the talk track's own reasons (src/data/talkTrack.ts), used while the engine has not answered
// or cannot be reached, so the card is there from the first moment of the call.
export function WhyCalling({ findings, fallback = [], language }: { findings?: EngineFinding[]; fallback?: TalkLine[]; language: Language }) {
  const day = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso)
  const fromEngine = callReasonsOf(findings).map((f) => ({ id: f.id, title: f.title, detail: f.detail, source: f.evidence[0]?.source ?? 'Engine', date: day(f.evidence.find((e) => e.date)?.date), severity: f.severity }))
  const reasons = (findings ? fromEngine : fallback.map((r, i) => ({ id: `talk-${i}`, title: r.text, detail: undefined, source: r.source, date: r.date, severity: r.severity }))).slice(0, 3)
  const texts = useTranslated(reasons.flatMap((r) => [r.title, r.detail ?? '', r.source]), language)
  return (
    <section className="mb-3 snap-start rounded-xl bg-white/90 px-4 py-3.5 shadow-card ring-1 ring-brand/25">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-brand-dark"><PhoneIncoming size={12} /> <span className="uppercase tracking-wide">{WHY[language].title}</span></div>
      {!reasons.length && <p className="text-[13px] text-muted">{WHY[language].none}</p>}
      <ul className="space-y-1.5">
        {reasons.map((r, i) => (
          <li key={r.id} className="flex items-start gap-2.5">
            <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${r.severity === 'risk' ? 'bg-risk' : r.severity === 'warn' ? 'bg-warn' : 'bg-brand'}`} />
            <div className="min-w-0 flex-1">
              <p className={`leading-snug ${i === 0 ? 'text-[16px]' : 'text-[14px] text-ink/80'}`}>{texts[i * 3] || r.title}</p>
              {r.detail && <p className="mt-0.5 text-[12px] leading-snug text-ink/70">{texts[i * 3 + 1] || r.detail}</p>}
              {/* Why someone calls is always a guess, whatever it is built from. */}
              <p className="mt-0.5 text-[10px] text-muted">{KIND[language].interpretation} · {texts[i * 3 + 2] || r.source}{r.date ? `, ${r.date}` : ''}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
