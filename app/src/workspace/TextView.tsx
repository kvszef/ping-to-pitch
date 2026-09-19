import { Check, Copy, FileDown, MessageSquareText } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslated, type Language } from '../data/useTranslate'
import { digestText, type Digest as DigestData } from './digest'
import { ModuleView } from './modules'
import { useNarrative } from './useNarrative'

// The main panel as text: the brief as bullet points with one or two graphs, readable in a minute.
// "PDF" prints the same content as one page (the browser's "Save as PDF"; no library, works offline):
// a copy of it sits in a print-only sheet next to #root, see .print-sheet in index.css.

const DOT = { risk: 'bg-risk', warn: 'bg-warn', ok: 'bg-ok', info: 'bg-brand' }
const CHROME = ['Überblick', 'Sekunden Lesezeit', 'Kopieren', 'Kopiert', 'Als PDF speichern', 'Grafiken', 'Keine Angaben für diesen Kunden.', 'Stand', 'Alle Zahlen sind aus den Kundendaten berechnet, die Quelle steht je Punkt in Klammern. Interne Gesprächsvorbereitung, keine Anlageempfehlung.']

// The running text card: the overview as the advisor can say it, in the tone the engine found for this client.
const TALK = {
  de: { title: 'Gesprächstext', tone: 'Ton', neutral: 'sachlich', model: 'KI-formuliert, Zahlen geprüft', plain: 'aus den Stichpunkten, ohne KI', writing: 'wird formuliert …' },
  en: { title: 'Talking text', tone: 'Tone', neutral: 'factual', model: 'Worded by AI, numbers checked', plain: 'from the bullet points, no AI', writing: 'being worded …' },
}
type Talk = { text: string; byModel: boolean; loading: boolean }

function TalkText({ d, talk, language, print = false }: { d: DigestData; talk: Talk; language: Language; print?: boolean }) {
  const l = TALK[language]
  return (
    <>
      <h3 className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-brand-dark">
        {!print && <MessageSquareText size={12} />}{l.title}
        <span className="rounded-full bg-pill px-2 py-px normal-case tracking-normal text-ink/80">{l.tone}: {d.tone.register ?? l.neutral}</span>
        <span className="normal-case tracking-normal text-muted">· {talk.loading ? l.writing : talk.byModel ? l.model : l.plain}</span>
      </h3>
      <p className={`leading-relaxed ${talk.loading ? 'text-wait' : ''}`}>{talk.text}</p>
    </>
  )
}

type Words = { chrome: string[]; labels: string[]; groups: string[]; texts: string[]; sources: string[] }

function Body({ d, w, asOf, language, talk, print = false }: { d: DigestData; w: Words; asOf?: string; language: Language; talk?: Talk; print?: boolean }) {
  // Where each section's bullets start in the translated texts and sources.
  const startOf = d.sections.map((_, si) => d.sections.slice(0, si).reduce((a, s) => a + s.bullets.length, 0))
  return (
    <div className={print ? 'text-[12px] text-ink' : 'text-[14px]'}>
      {print && <h1 className="mb-1 text-[20px]">{d.name} <span className="text-[12px] text-muted">· {w.chrome[0]}, {d.seconds} {w.chrome[1]}{asOf ? ` · ${w.chrome[7]} ${asOf}` : ''}</span></h1>}
      {d.facts.length > 0 && (
        <p className="mb-3 leading-relaxed text-ink/80">
          {d.facts.map(([label, value], i) => <span key={label} className="mr-3 inline-block"><span className="text-[10px] uppercase tracking-wide text-muted">{w.labels[i] || label}</span> {value}</span>)}
        </p>
      )}
      {!d.sections.length && <p className="text-muted">{w.chrome[6]}</p>}
      <div className={print ? 'columns-2 gap-8' : ''}>
        {d.sections.map((s, si) => (
          <section key={`${s.group}-${si}`} className="mb-3 break-inside-avoid">
            <h3 className="mb-1 text-[10px] uppercase tracking-wide text-brand-dark">{w.groups[si] || s.group}</h3>
            <ul className="space-y-1">
              {s.bullets.map((b, bi) => {
                const i = startOf[si] + bi
                return (
                  <li key={b.id} className="flex items-baseline gap-2 leading-snug">
                    <span className={`h-1.5 w-1.5 shrink-0 -translate-y-0.5 rounded-full ${DOT[b.severity ?? 'info']}`} />
                    <span className="min-w-0 flex-1">
                      {b.figure && <span className="mr-1.5 font-medium tabular-nums text-brand-dark">{b.figure}</span>}
                      {w.texts[i] || b.text} <span className="text-[10px] text-muted">({w.sources[i] || b.source})</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
      {talk?.text && <section className="mt-3 break-inside-avoid"><TalkText d={d} talk={talk} language={language} print /></section>}
      {d.charts.length > 0 && (
        <section className="mt-4 break-inside-avoid">
          <h3 className="mb-1 text-[10px] uppercase tracking-wide text-brand-dark">{w.chrome[5]}</h3>
          <div className="grid grid-cols-2 gap-3">{d.charts.map((c) => <ModuleView key={c.id} spec={c.spec} detail="standard" language={language} />)}</div>
        </section>
      )}
      {print && <p className="mt-4 border-t border-line pt-2 text-[9px] text-muted">{w.chrome[8]}</p>}
    </div>
  )
}

export function TextView({ digest: d, asOf, language }: { digest: DigestData; asOf?: string; language: Language }) {
  const bullets = d.sections.flatMap((s) => s.bullets)
  const chartWords = d.charts.flatMap((c) => [c.title, ...(c.spec.type === 'balken' ? c.spec.bars.map((b) => b.label) : [])])
  // One batch for everything on the page, so the English view fills in at once.
  const all = useTranslated([...CHROME, ...d.facts.map(([l]) => l), ...d.sections.map((s) => s.group), ...bullets.map((b) => b.text), ...bullets.map((b) => b.source), ...chartWords], language)
  const cut = [CHROME.length, d.facts.length, d.sections.length, bullets.length, bullets.length]
  const parts = cut.map((len, i) => { const at = cut.slice(0, i).reduce((a, b) => a + b, 0); return all.slice(at, at + len) })
  const w: Words = { chrome: parts[0], labels: parts[1], groups: parts[2], texts: parts[3], sources: parts[4] }

  // The copied text reads in the advisor's language too: German original → what is shown.
  const said = new Map([...CHROME, ...d.facts.map(([l]) => l), ...d.sections.map((s) => s.group), ...bullets.map((b) => b.text), ...bullets.map((b) => b.source), ...chartWords].map((t, i) => [t, all[i] ?? t]))
  const say = (t: string) => said.get(t) ?? t
  const talk = useNarrative(d, language, say)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    const l = TALK[language]
    const spoken = talk.text ? [`${l.title} (${l.tone}: ${d.tone.register ?? l.neutral})\n${talk.text}`] : []
    try { await navigator.clipboard.writeText([digestText(d, say), ...spoken].join('\n\n')); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked: the text is on screen anyway */ }
  }
  // The file name the browser proposes is the page title. No client name in it, only the reference.
  const print = () => {
    const title = document.title
    document.title = `${w.chrome[0]} ${d.ref}`
    window.addEventListener('afterprint', () => { document.title = title }, { once: true })
    window.print()
  }
  const button = 'flex items-center gap-1.5 rounded-full bg-pill/60 px-2.5 py-1 text-[11px] text-ink/80 hover:bg-pill hover:text-ink'

  return (
    <>
    <article className="anim-rise mb-3 rounded-xl bg-white/85 p-5 shadow-card ring-1 ring-black/5">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-[16px]">{w.chrome[0]} <span className="text-[11px] text-muted">· {d.seconds} {w.chrome[1]}</span></h2>
        <button onClick={() => void copy()} className={button}>{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? w.chrome[3] : w.chrome[2]}</button>
        <button onClick={print} className={button}><FileDown size={12} /> {w.chrome[4]}</button>
      </header>
      <Body d={d} w={w} asOf={asOf} language={language} />
      {createPortal(<div className="print-sheet"><Body d={d} w={w} asOf={asOf} language={language} talk={talk} print /></div>, document.body)}
    </article>
    {talk.text && (
      <article className="anim-rise mb-3 rounded-xl bg-white/85 p-5 text-[14px] shadow-card ring-1 ring-black/5">
        <TalkText d={d} talk={talk} language={language} />
      </article>
    )}
    </>
  )
}
