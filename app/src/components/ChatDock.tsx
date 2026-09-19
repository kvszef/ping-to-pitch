import { BarChart3, MessageSquare, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Client } from '../types'
import { activeProvider, answer, fetchStatus, question, type Status } from '../workspace/brain'
import { ModuleView } from '../workspace/modules'
import { useSettings } from '../workspace/settings'
import type { ChatEntry } from '../workspace/types'

// Reine Nachrichtenliste + Eingabe, ohne Chrome. Wird sowohl im Slide-in-Panel als auch kompakt im Live-Overlay verwendet.
export function ChatThread({ client, className = '', autoFocus = false }: { client: Client; className?: string; autoFocus?: boolean }) {
  // Same path as the workspace chat: the configured model answers from this client's data, example mode as fallback.
  const [settings] = useSettings()
  const [status, setStatus] = useState<Status>({ openai: false, apertus: false, elevenlabs: false })
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestions = client.briefing.flatMap((c) => (c.type === 'questions' ? c.items.map((x) => x.q) : []))

  useEffect(() => { fetchStatus().then(setStatus) }, [])
  useEffect(() => { setMessages([]) }, [client.ref])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [messages])
  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, [autoFocus])

  async function send(text: string) {
    if (!text.trim() || busy) return
    setInput('')
    setMessages((m) => [...m, question(text)])
    setBusy(true)
    const reply = await answer(client, text, settings, status, messages)
    setMessages((m) => [...m, reply.entry])
    setBusy(false)
  }

  return (
    <section className={`flex flex-col ${className}`}>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4 text-xs">
        {messages.length === 0 && (
          <div className="space-y-1.5">
            <p className="pb-0.5 text-[11px] text-muted">Vorschläge</p>
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)} className="block rounded-full bg-stripe px-3 py-1.5 text-left transition-colors hover:bg-brand-soft/60 hover:text-brand">{s}</button>
            ))}
          </div>
        )}
        {messages.map((m) => m.role === 'berater'
          ? <div key={m.id} className="anim-rise ml-auto w-fit max-w-[90%] rounded-2xl bg-brand px-3 py-1.5 leading-snug text-white">{m.text}</div>
          : (
            <div key={m.id} className="anim-rise max-w-[95%] rounded-2xl bg-stripe/80 px-3 py-2 leading-snug">
              <p>{m.text}</p>
              {m.sources.length > 0 && <p className="mt-1 text-[10px] text-muted">Quellen: {m.sources.join(' · ')}</p>}
              {m.module && <ModuleView spec={m.module} detail={settings.detail} />}
              {m.offered && <button onClick={() => setMessages((all) => all.map((e) => (e.id === m.id && e.role === 'ki' && e.offered ? { ...e, module: e.offered.spec, offered: undefined } : e)))} className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] hover:bg-brand hover:text-white"><BarChart3 size={11} /> Grafik · {m.offered.confidence}%</button>}
            </div>
          ))}
        {busy && <div className="text-muted">…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="flex shrink-0 items-center gap-2 border-t border-line/70 p-3 text-xs">
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Frage zu ${client.name} …`} title={`KI: ${activeProvider(settings, status) ?? 'Beispielmodus'}`} className="min-w-0 flex-1 rounded-full bg-stripe px-3.5 py-2 outline-none focus:ring-1 focus:ring-brand" />
        <button aria-label="Senden" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-dark">→</button>
      </form>
    </section>
  )
}

// Kollabiert zu einem runden Auslöser unten rechts; öffnet als Panel von rechts (federnd rein, zackig raus).
export function ChatDock({ client }: { client: Client }) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [client.ref])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  const hasSuggestions = client.briefing.some((c) => c.type === 'questions' && c.items.length > 0)

  return (
    <>
      <button
        aria-label={open ? 'Fragen schliessen' : 'Fragen stellen'}
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-card transition-all duration-200 hover:bg-brand-dark active:scale-90 ${open ? 'rotate-90 scale-95' : ''}`}
      >
        {open ? <X size={22} strokeWidth={1.75} /> : <MessageSquare size={22} strokeWidth={1.75} />}
        {!open && hasSuggestions && (
          <span className="absolute right-0 top-0 h-3 w-3 animate-pulse rounded-full bg-risk ring-2 ring-white" />
        )}
      </button>

      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-30 bg-ink/15 transition-opacity ${open ? 'pointer-events-auto opacity-100 duration-300' : 'pointer-events-none opacity-0 duration-200'}`}
      />

      <div
        role="dialog"
        aria-label="Fragen an den Assistenten"
        className={`fixed inset-y-0 right-0 z-40 flex w-[380px] max-w-[92vw] flex-col bg-white/75 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl transition-transform will-change-transform ${open ? 'translate-x-0 duration-300 ease-[cubic-bezier(.22,1,.36,1)]' : 'translate-x-full duration-200 ease-[cubic-bezier(.4,0,1,1)]'}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line/70 px-4 py-3">
          <h3 className="flex items-center gap-1.5 text-[15px]"><MessageSquare size={16} strokeWidth={1.5} /> Fragen</h3>
          <button aria-label="Schliessen" onClick={() => setOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-stripe hover:text-ink">
            <X size={15} />
          </button>
        </div>
        <ChatThread client={client} className="min-h-0 flex-1" autoFocus={open} />
      </div>
    </>
  )
}
