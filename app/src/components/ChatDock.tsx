import { MessageSquare } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ask } from '../assistant'
import type { ChatMessage, Client } from '../types'

export function ChatDock({ client, className = '' }: { client: Client; className?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const suggestions = client.briefing.flatMap((c) => (c.type === 'questions' ? c.items.map((x) => x.q) : []))

  useEffect(() => { setMessages([]) }, [client.ref])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [messages])

  async function send(text: string) {
    if (!text.trim() || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'advisor', text }])
    setBusy(true)
    const answer = await ask(client, text)
    setMessages((m) => [...m, { role: 'assistant', text: answer }])
    setBusy(false)
  }

  return (
    <section className={`flex flex-col ${className}`}>
      <h3 className="flex items-center gap-1.5 px-4 pt-4 text-[15px]"><MessageSquare size={16} strokeWidth={1.5} /> Fragen</h3>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4 text-xs">
        {messages.length === 0 && (
          <div className="space-y-1">
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)} className="block text-left text-muted transition-colors hover:text-brand">{s}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[90%] rounded-2xl px-3 py-1.5 leading-snug ${m.role === 'advisor' ? 'ml-auto bg-brand text-white' : 'bg-stripe'}`}>{m.text}</div>
        ))}
        {busy && <div className="text-muted">…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="flex items-center gap-2 border-t border-line/70 p-2 text-xs">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Frage stellen …" className="min-w-0 flex-1 rounded-full bg-stripe px-3.5 py-2 outline-none focus:ring-1 focus:ring-brand" />
        <button aria-label="Senden" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-dark">→</button>
      </form>
    </section>
  )
}
