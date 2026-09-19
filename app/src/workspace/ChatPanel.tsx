import { ArrowRight, BarChart3, ChevronDown, MessageSquare, Pin } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { tr } from '../data/i18n-static'
import { useTranslated, type Language } from '../data/useTranslate'
import { ModuleView } from './modules'
import { Smooth } from './motion'
import type { ChatEntry, Detail } from './types'

// The chat under the graph column: collapsed to one input line, it grows upward over the graphs
// when there is something to read and shrinks back when closed. "/" jumps into it.
// Every answer can be pinned to the graph column and followed up with one click.

// Follow-ups name the original question, so the model knows what "more" refers to even for an older, pinned answer.
export const FOLLOW_UPS: { label: string; ask: (q: string) => string }[] = [
  { label: 'Genauer', ask: (q) => `Genauer, mit allen Zahlen dazu: ${q}` },
  { label: 'Warum?', ask: (q) => `Warum ist das so? Zur Frage: ${q}` },
  { label: 'Für den Kunden', ask: (q) => `Wie sage ich das dem Kunden in zwei Sätzen? Zur Frage: ${q}` },
]

export function ChatPanel({ above, name, chat, busy, detail, suggestions, pinned, onAsk, onShow, onPin, language }: {
  above?: ReactNode; name: string; chat: ChatEntry[]; busy: boolean; detail: Detail; suggestions: string[]; pinned: string[]
  onAsk: (text: string) => void; onShow: (id: string) => void; onPin: (id: string) => void; language: Language
}) {
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) { if (e.key === 'Escape') { setOpen(false); input.current?.blur() } return }
      if (e.key === '/') { e.preventDefault(); input.current?.focus(); setOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // A question asked from elsewhere (a pinned answer's "Mehr") opens the panel too.
  useEffect(() => { if (busy) setOpen(true) }, [busy])

  const lastQ = [...chat].reverse().find((e) => e.role === 'berater')
  const lastA = lastQ ? chat.slice(chat.indexOf(lastQ) + 1).find((e) => e.role === 'ki') : undefined
  const send = (text: string) => { if (text.trim()) { onAsk(text); setOpen(true) } }
  const [suggestionsT, lastQT, lastAT] = [useTranslated(suggestions, language), useTranslated([lastQ?.text ?? ''], language)[0], useTranslated([lastA?.role === 'ki' ? lastA.text : ''], language)[0]]
  const [chrome, followUps] = [
    useTranslated(['Nachfragen', 'Quellen:', 'Grafik', 'Lösen', 'Rechts anheften', 'Angeheftet', 'Anheften'], language),
    useTranslated(FOLLOW_UPS.map((f) => f.label), language),
  ]

  return (
    <div className="absolute inset-x-3 bottom-3 z-20 overflow-hidden rounded-2xl bg-white/70 shadow-[0_12px_40px_rgba(31,56,88,0.18)] ring-1 ring-white/80 backdrop-blur-2xl">
      {/* During a call the live transcript sits right above the chat. */}
      {above && <div className="pt-2">{above}</div>}
      <Smooth>
        {open && (
          <div className="max-h-[60vh] overflow-y-auto px-4 pb-1 pt-3 text-[13px]">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted">
              <MessageSquare size={11} /> {chrome[0]}
              <button onClick={() => setOpen(false)} aria-label="Einklappen" className="ml-auto flex h-6 w-6 items-center justify-center rounded-full hover:bg-pill hover:text-ink"><ChevronDown size={13} /></button>
            </div>
            {!lastQ && !busy && (
              <div className="flex flex-wrap gap-1.5 pb-2">
                {suggestions.slice(0, 4).map((s, i) => <button key={s} onClick={() => send(s)} className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] text-muted hover:bg-brand-soft/60 hover:text-ink">{suggestionsT[i] || s}</button>)}
              </div>
            )}
            {lastQ && <p className="mb-1.5 text-[11px] text-muted">{lastQT || lastQ.text}</p>}
            {busy && !lastA && <p className="animate-pulse pb-2 text-muted">…</p>}
            {lastA?.role === 'ki' && (
              <div key={lastA.id} className="anim-rise pb-2">
                <p className="leading-relaxed">{lastAT || lastA.text}</p>
                {lastA.sources.length > 0 && <p className="mt-1 text-[10px] text-muted">{chrome[1]} {lastA.sources.join(' · ')}</p>}
                {lastA.module && <ModuleView spec={lastA.module} detail={detail} language={language} />}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {lastA.offered && <button onClick={() => onShow(lastA.id)} className="inline-flex items-center gap-1 rounded-full bg-pill px-2 py-0.5 text-[10px] hover:bg-brand hover:text-white"><BarChart3 size={11} /> {chrome[2]} · {lastA.offered.confidence}%</button>}
                  <button onClick={() => onPin(lastA.id)} aria-pressed={pinned.includes(lastA.id)} title={pinned.includes(lastA.id) ? chrome[3] : chrome[4]}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${pinned.includes(lastA.id) ? 'bg-brand text-white' : 'bg-pill hover:bg-brand hover:text-white'}`}>
                    <Pin size={11} className={pinned.includes(lastA.id) ? 'fill-current' : ''} /> {pinned.includes(lastA.id) ? chrome[5] : chrome[6]}
                  </button>
                  {lastQ && !busy && FOLLOW_UPS.map((f, i) => (
                    <button key={f.label} onClick={() => send(f.ask(lastQ.text))} className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-muted hover:bg-brand-soft/60 hover:text-ink">{followUps[i] || f.label}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Smooth>
      <form onSubmit={(e) => { e.preventDefault(); send(input.current?.value ?? ''); if (input.current) input.current.value = '' }} className="flex items-center gap-2 p-1.5">
        <MessageSquare size={14} className="ml-2 shrink-0 text-muted" />
        <input ref={input} onFocus={() => setOpen(true)} autoComplete="off" placeholder={tr(`Nachfragen zu ${name} …  /`, language)} className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] outline-none placeholder:text-muted" />
        <button aria-label="Fragen" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-dark"><ArrowRight size={14} /></button>
      </form>
    </div>
  )
}
