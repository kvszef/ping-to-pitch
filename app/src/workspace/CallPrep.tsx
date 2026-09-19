import { Ban, ExternalLink, MessageCircleQuestion, PhoneIncoming, PhoneOutgoing, Quote, Sparkles, Target } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CallPlan, PlanLine } from '../../server/ai/callplan-types'
import { useTranslated, type Language } from '../data/useTranslate'

// Two ways to look at a client, one per call direction.
//   prep      we call ("Heute anrufen"): why we call, what the call should achieve, how to convince
//             this client. The plan comes from server/ai/callplan.ts.
//   inbound   the client calls: who it is and the 60-second brief, the key facts at a glance.
// The workspace picks the mode from what happens (a call going out or coming in, a client picked
// from today's list); the switch below lets the advisor change it at any time.
export type CallMode = 'prep' | 'inbound'

export function ModeSwitch({ mode, onMode, language }: { mode: CallMode; onMode: (m: CallMode) => void; language: Language }) {
  const [out, inn, outTitle, innTitle] = useTranslated(['Ausgehend', 'Eingehend', 'Anruf vorbereiten: Anlass, Ziel und Argumente', 'Kunde ruft an: das Wichtigste auf einen Blick'], language)
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

const KIND = { fact: 'Fakt', interpretation: 'Einschätzung', action: 'Massnahme' } as const
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
  // One batch for everything the card shows: [text, source, label] per line, then tone, questions, chrome.
  const texts = useTranslated([
    ...lines.flatMap((l) => [l.text, l.source, l.label ?? '', KIND[l.kind]]),
    ...(plan?.tone ?? []), ...(plan?.questions ?? []).flatMap((q) => [q.q, q.a]),
    'Anrufplan', 'Warum wir anrufen', 'Ziel des Gesprächs', 'So überzeugen Sie diesen Kunden', 'Einstieg', 'Nicht ansprechen', 'Wahrscheinliche Rückfragen',
    'Ton', 'ausserdem', 'Kein dringender Anlass in den Daten. Ein Anruf dient der Kontaktpflege.', 'Anrufplan wird berechnet …', 'KI-formuliert, Zahlen geprüft', 'KI formuliert …', 'Artikel öffnen',
  ], language)
  const at = new Map(lines.map((l, i) => [l, i * 4]))
  const t = (l: PlanLine) => ({ text: texts[at.get(l)!] || l.text, source: texts[at.get(l)! + 1] || l.source, label: texts[at.get(l)! + 2] || l.label, kind: texts[at.get(l)! + 3] || KIND[l.kind] })
  const toneAt = lines.length * 4
  const questionsAt = toneAt + (plan?.tone.length ?? 0)
  const [title, why, goal, convince, opener, avoid, questions, tone, also, none, loading, written, isWriting, openArticle] = texts.slice(questionsAt + (plan?.questions.length ?? 0) * 2)

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
