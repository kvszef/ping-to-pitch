import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Ban, Check, CircleAlert, CircleHelp, MessageCircle, Pause, Play, PhoneIncoming, Timer } from 'lucide-react'
import type { CardOf, TalkLine } from '../types'
import { KindTag, Panel, SeverityIcon, useLanguage } from './ui'
import { useTranslated } from '../data/useTranslate'

// The 60-second briefing as a talk track: four blocks in speaking order, a reading-time budget and a
// rehearsal mode that walks through the lines at speaking pace. Every line opens its source on click.

const WORDS_PER_SECOND = 2.5 // 150 words per minute, calm advisory speaking pace
const BUDGET = 60
const words = (text: string) => text.split(/\s+/).filter(Boolean).length
const seconds = (line: TalkLine) => words(line.text) / WORDS_PER_SECOND

function Line({ line, active, big = false, muted = false }: { line: TalkLine; active: boolean; big?: boolean; muted?: boolean }) {
  const language = useLanguage()
  const [quelleAnzeigen, quelle] = useTranslated(['Quelle anzeigen', 'Quelle:'], language)
  const [open, setOpen] = useState(false)
  return (
    <li className={`rounded-sm transition-colors duration-300 ${active ? 'bg-brand-soft/50' : ''}`}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} title={quelleAnzeigen} className={`flex w-full items-start gap-1.5 px-1.5 py-1 text-left leading-snug hover:bg-stripe ${big ? 'text-[17px]' : 'text-[13px]'} ${muted || line.covered ? 'text-muted' : ''}`}>
        {line.covered ? <span className="mt-[3px] text-ok"><Check size={12} /></span> : line.severity && <span className="mt-[3px]"><SeverityIcon severity={line.severity} size={12} /></span>}
        <span className={line.covered ? 'line-through decoration-1' : ''}>{line.text}</span>
      </button>
      {open && <div className="anim-rise px-1.5 pb-1 text-[11px] text-muted">{quelle} {line.source}{line.date ? `, ${line.date}` : ''}{line.detail ? ` · ${line.detail}` : ''}</div>}
    </li>
  )
}

function Block({ icon: Icon, label, children }: { icon: typeof Ban; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted"><Icon size={12} /> {label}</div>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  )
}

export function TalkTrack({ card }: { card: CardOf<'talktrack'> }) {
  const language = useLanguage()
  const [
    probelesen, stopp, lesezeit, woerter, budgetLabel, zuLang, warumRuftDerKundeAn, quelleLabel,
    einstieg, unbedingtAnsprechen, fragen, nichtAnsprechen, keineOffeneFrage, nichtsBekannt,
  ] = useTranslated(
    [
      'Probelesen', 'Stopp', 'Lesezeit', 'Wörter', 'Budget', 'zu lang', 'Warum ruft der Kunde an?', 'Quelle:',
      'Einstieg', 'Unbedingt ansprechen', 'Fragen', 'Nicht ansprechen', 'Keine offene Frage.', 'Nichts bekannt.',
    ],
    language,
  )
  const spoken = useMemo(() => [card.open, ...card.mention, ...card.ask], [card])
  const total = spoken.reduce((n, l) => n + words(l.text), 0)
  const budget = spoken.reduce((n, l) => n + seconds(l), 0)
  const over = budget > BUDGET

  // Rehearsal: elapsed speaking time; the line whose slice contains it is highlighted.
  const [elapsed, setElapsed] = useState<number | null>(null)
  useEffect(() => {
    if (elapsed === null) return
    if (elapsed >= budget) { const t = setTimeout(() => setElapsed(null), 800); return () => clearTimeout(t) }
    const t = setTimeout(() => setElapsed((e) => (e === null ? null : e + 0.25)), 250)
    return () => clearTimeout(t)
  }, [elapsed, budget])
  let acc = 0
  const activeIndex = elapsed === null ? -1 : spoken.findIndex((l) => (acc += seconds(l)) > elapsed)
  const isActive = (l: TalkLine) => activeIndex >= 0 && spoken[activeIndex] === l

  const fill = Math.min(1, (elapsed ?? budget) / BUDGET)

  return (
    <Panel title={card.title} icon={Timer} aside={
      <button onClick={() => setElapsed((e) => (e === null ? 0 : null))} className="flex items-center gap-1 rounded-sm bg-pill px-2 py-0.5 text-[11px] font-normal hover:bg-brand hover:text-white">
        {elapsed === null ? <><Play size={11} /> {probelesen}</> : <><Pause size={11} /> {stopp}</>}
      </button>
    }>
      <div className="mb-4">
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-track" role="meter" aria-valuemin={0} aria-valuemax={BUDGET} aria-valuenow={Math.round(budget)} aria-label={lesezeit}>
          <div className={`h-full rounded-full ${over ? 'bg-warn' : 'bg-brand-dark'} ${elapsed === null ? 'transition-[width] duration-500' : 'transition-[width] duration-200 ease-linear'}`} style={{ width: `${fill * 100}%` }} />
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] tabular-nums text-muted">
          {elapsed !== null ? <span className="text-ink">{Math.floor(elapsed)} s</span> : <span className={over ? 'text-ink' : ''}>≈ {Math.round(budget)} s {lesezeit}</span>}
          <span>· {total} {woerter} · {budgetLabel} {BUDGET} s</span>
          {over && <span className="flex items-center gap-1 text-ink"><SeverityIcon severity="warn" size={11} /> {zuLang}</span>}
        </div>
      </div>

      {card.reasons && card.reasons.length > 0 && (
        <div className="mb-4 border-l-4 border-brand bg-brand-soft/25 px-3 py-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted"><PhoneIncoming size={12} /> {warumRuftDerKundeAn} <KindTag kind="interpretation" /></div>
          <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {card.reasons.map((r, i) => (
              <li key={r.text} title={`${quelleLabel} ${r.source}${r.date ? `, ${r.date}` : ''}`} className="flex items-center gap-1.5">
                <span className="text-[11px] tabular-nums text-muted">{i + 1}.</span>
                {r.severity && <SeverityIcon severity={r.severity} size={12} />}
                <span>{r.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mb-3">
        <Block icon={MessageCircle} label={einstieg}><Line line={card.open} active={isActive(card.open)} big /></Block>
      </div>
      <div className="@container"><div className="grid gap-4 @2xl:grid-cols-3">
        <Block icon={CircleAlert} label={unbedingtAnsprechen}>{card.mention.map((l) => <Line key={l.text} line={l} active={isActive(l)} />)}</Block>
        <Block icon={CircleHelp} label={fragen}>{card.ask.length ? card.ask.map((l) => <Line key={l.text} line={l} active={isActive(l)} />) : <li className="px-1.5 text-xs text-muted">{keineOffeneFrage}</li>}</Block>
        <Block icon={Ban} label={nichtAnsprechen}>{card.avoid.length ? card.avoid.map((l) => <Line key={l.text} line={l} active={false} muted />) : <li className="px-1.5 text-xs text-muted">{nichtsBekannt}</li>}</Block>
      </div></div>
    </Panel>
  )
}
