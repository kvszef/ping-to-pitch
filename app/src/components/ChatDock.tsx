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
    <section className={`flex flex-col bg-white shadow-card ${className}`}>
      <h3 className="flex items-center gap-1.5 px-4 pt-4 text-[15px]"><MessageSquare size={16} strokeWidth={1.5} /> Rückfragen</h3>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4 text-xs">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-sm bg-pill px-2 py-1 hover:bg-brand hover:text-white">{s}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[90%] px-2.5 py-1.5 leading-snug ${m.role === 'advisor' ? 'ml-auto bg-brand text-white' : 'bg-stripe'}`}>{m.text}</div>
        ))}
        {busy && <div className="text-muted">…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="flex border-t border-line text-xs">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Rückfrage stellen …" className="min-w-0 flex-1 px-3 py-2 outline-none" />
        <button className="bg-brand px-3 text-white hover:bg-brand-dark">Senden</button>
      </form>
    </section>
  )
}
