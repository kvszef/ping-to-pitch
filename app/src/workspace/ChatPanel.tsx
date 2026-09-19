import { ArrowRight, BarChart3, ChevronDown, MessageSquare } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ModuleView } from './modules'
import { Smooth } from './motion'
import type { ChatEntry, Detail } from './types'

// The chat under the graph column: collapsed to one input line, it grows upward over the graphs
// when there is something to read and shrinks back when closed. "/" jumps into it.

export function ChatPanel({ name, chat, busy, detail, suggestions, onAsk, onShow }: {
  name: string; chat: ChatEntry[]; busy: boolean; detail: Detail; suggestions: string[]; onAsk: (text: string) => void; onShow: (id: string) => void
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

  const lastQ = [...chat].reverse().find((e) => e.role === 'berater')
  const lastA = lastQ ? chat.slice(chat.indexOf(lastQ) + 1).find((e) => e.role === 'ki') : undefined
  const send = (text: string) => { if (text.trim()) { onAsk(text); setOpen(true) } }

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 overflow-hidden rounded-2xl bg-white/70 shadow-[0_12px_40px_rgba(31,56,88,0.18)] ring-1 ring-white/80 backdrop-blur-2xl">
      <Smooth>
        {open && (
          <div className="max-h-[60vh] overflow-y-auto px-4 pb-1 pt-3 text-[13px]">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted">
              <MessageSquare size={11} /> Nachfragen
              <button onClick={() => setOpen(false)} aria-label="Einklappen" className="ml-auto flex h-6 w-6 items-center justify-center rounded-full hover:bg-pill hover:text-ink"><ChevronDown size={13} /></button>
            </div>
            {!lastQ && !busy && (
              <div className="flex flex-wrap gap-1.5 pb-2">
                {suggestions.slice(0, 4).map((s) => <button key={s} onClick={() => send(s)} className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] text-muted hover:bg-brand-soft/60 hover:text-ink">{s}</button>)}
              </div>
            )}
            {lastQ && <p className="mb-1.5 text-[11px] text-muted">{lastQ.text}</p>}
            {busy && !lastA && <p className="animate-pulse pb-2 text-muted">…</p>}
            {lastA?.role === 'ki' && (
              <div key={lastA.id} className="anim-rise pb-2">
                <p className="leading-relaxed">{lastA.text}</p>
                {lastA.sources.length > 0 && <p className="mt-1 text-[10px] text-muted">Quellen: {lastA.sources.join(' · ')}</p>}
                {lastA.module && <ModuleView spec={lastA.module} detail={detail} />}
                {lastA.offered && <button onClick={() => onShow(lastA.id)} className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-pill px-2 py-0.5 text-[10px] hover:bg-brand hover:text-white"><BarChart3 size={11} /> Grafik · {lastA.offered.confidence}%</button>}
              </div>
            )}
          </div>
        )}
      </Smooth>
      <form onSubmit={(e) => { e.preventDefault(); send(input.current?.value ?? ''); if (input.current) input.current.value = '' }} className="flex items-center gap-2 p-1.5">
        <MessageSquare size={14} className="ml-2 shrink-0 text-muted" />
        <input ref={input} onFocus={() => setOpen(true)} autoComplete="off" placeholder={`Nachfragen zu ${name} …  /`} className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] outline-none placeholder:text-muted" />
        <button aria-label="Fragen" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-dark"><ArrowRight size={14} /></button>
      </form>
    </div>
  )
}
