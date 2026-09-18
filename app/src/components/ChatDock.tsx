import { useEffect, useRef, useState } from 'react'
import { ask } from '../assistant'
import type { ChatMessage, Client } from '../types'

export function ChatDock({ client }: { client: Client }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

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

  const suggestions = ['Why did it fall?', 'What about USD exposure?', 'Any sustainable options?']

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Ask about {client.name}</div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-full border border-line px-3 py-1 text-xs hover:border-brand hover:text-brand">{s}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[90%] rounded-lg px-3 py-2 leading-snug ${m.role === 'advisor' ? 'ml-auto bg-brand text-white' : 'bg-surface'}`}>{m.text}</div>
        ))}
        {busy && <div className="text-xs text-muted">Thinking…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="flex gap-2 border-t border-line p-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a follow-up…" className="flex-1 rounded border border-line px-3 py-2 outline-none focus:border-brand" />
        <button className="rounded bg-brand px-3 py-2 font-medium text-white hover:bg-brand-dark">Send</button>
      </form>
    </div>
  )
}
