import { ArrowRight, BarChart3, CornerDownLeft, MessageSquare, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { ModuleView } from './modules'
import type { ChatEntry, Detail } from './types'

// "Kurz nachfragen": a pop-over for a quick question, docked to the right edge, not a panel that
// stays open. Opens with "/" or the button, closes with Esc. No backdrop: the rest of the UI stays
// fully clickable behind it, and the panel itself grows or shrinks with whatever comes back —
// a short line of text stays narrow, a graph module widens and lengthens it.

export function QuickAsk({ open, onOpen, onClose, name, chat, busy, detail, suggestions, onAsk, onShow }: {
  open: boolean; onOpen: () => void; onClose: () => void; name: string; chat: ChatEntry[]; busy: boolean; detail: Detail
  suggestions: string[]; onAsk: (text: string) => void; onShow: (id: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const lastQ = [...chat].reverse().find((e) => e.role === 'berater')
  const lastA = lastQ ? chat.slice(chat.indexOf(lastQ) + 1).find((e) => e.role === 'ki') : undefined
  const hasContent = !!((lastQ || busy) || suggestions.length > 0)
  const wide = !!lastA?.module // a graph module needs more room than a line of text

  return (
    <>
    {/* The trigger: a tab on the right edge, halfway down; it widens on hover and the panel opens from it. */}
    <button onClick={onOpen} aria-label="Kurz nachfragen" title="Kurz nachfragen ( / )"
      className={`group fixed right-0 top-1/2 z-40 flex -translate-y-1/2 items-center gap-2 rounded-l-full bg-brand py-3 pl-3.5 pr-3 text-white shadow-card transition-[opacity,transform,padding] duration-300 ease-[cubic-bezier(.22,1,.36,1)] hover:pl-4 ${open ? 'pointer-events-none translate-x-full opacity-0' : 'opacity-100'}`}>
      <MessageSquare size={17} />
      <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs transition-[max-width] duration-300 ease-[cubic-bezier(.22,1,.36,1)] group-hover:max-w-[140px]">Nachfragen <kbd className="ml-1 rounded bg-white/20 px-1 text-[10px]">/</kbd></span>
    </button>
    <div className={`pointer-events-none fixed inset-y-0 right-0 z-50 flex items-center justify-end px-4 transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} aria-hidden={!open}>
      <div role="dialog" aria-label="Kurz nachfragen"
        className={`${open ? 'pointer-events-auto' : 'pointer-events-none'} flex max-h-[70vh] origin-right flex-col overflow-hidden rounded-3xl border border-white/40 bg-white/30 shadow-[0_24px_80px_rgba(0,0,0,0.18)] backdrop-blur-2xl transition-[transform,width] duration-500 ease-[cubic-bezier(.22,1,.36,1)] ${wide ? 'w-[560px]' : 'w-[400px]'} max-w-[calc(100vw-2rem)] ${open ? 'translate-x-0' : 'translate-x-6'}`}>
        <form onSubmit={(e) => { e.preventDefault(); const v = input.current?.value ?? ''; if (v.trim()) { onAsk(v); input.current!.value = '' } }} className="flex shrink-0 items-center gap-3 px-5 py-4">
          <span className="text-[15px] text-brand">/</span>
          <input ref={input} autoComplete="off" placeholder={`Kurz nachfragen zu ${name} …`} className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted" />
          <button aria-label="Fragen" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-dark"><ArrowRight size={16} /></button>
          <button type="button" onClick={onClose} aria-label="Schliessen" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-pill hover:text-ink"><X size={15} /></button>
        </form>

        {/* Grid-rows trick: animates from 0 to the content's natural height without measuring it in JS. */}
        <div className="grid shrink-0 transition-[grid-template-rows] duration-500 ease-[cubic-bezier(.22,1,.36,1)]" style={{ gridTemplateRows: hasContent ? '1fr' : '0fr' }}>
          <div className="min-h-0 overflow-y-auto overflow-x-hidden">
            {(lastQ || busy) ? (
              <div className="border-t border-white/40 px-5 py-4 text-[14px]">
                {lastQ && <p className="mb-2 text-[12px] text-muted">{lastQ.text}</p>}
                {busy && !lastA && <p className="animate-pulse text-muted">…</p>}
                {lastA && lastA.role === 'ki' && (
                  <div key={lastA.id} className="anim-rise">
                    <p className="leading-relaxed">{lastA.text}</p>
                    {lastA.sources.length > 0 && <p className="mt-1.5 text-[11px] text-muted">Quellen: {lastA.sources.join(' · ')}</p>}
                    {lastA.module && <ModuleView spec={lastA.module} detail={detail} />}
                    {lastA.offered && <button onClick={() => onShow(lastA.id)} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-pill px-2.5 py-1 text-[11px] hover:bg-brand hover:text-white"><BarChart3 size={12} /> Grafik · {lastA.offered.confidence}%</button>}
                  </div>
                )}
              </div>
            ) : suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-white/40 px-5 py-3">
                {suggestions.slice(0, 5).map((s) => <button key={s} onClick={() => onAsk(s)} className="rounded-full bg-white/40 px-3 py-1 text-[12px] text-muted hover:bg-brand-soft/60 hover:text-ink">{s}</button>)}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 border-t border-white/30 px-5 py-2 text-[10px] text-muted"><CornerDownLeft size={10} /> fragen · Esc schliessen · Die Antwort holt die passende Kachel nach vorne</div>
      </div>
    </div>
    </>
  )
}
