import { useState } from 'react'
import { CardView } from './cards/registry'
import { ChatDock } from './components/ChatDock'
import { LiveOverlay } from './components/LiveOverlay'
import { clients } from './data/mock'

export default function App() {
  const [ref, setRef] = useState(clients[0].ref)
  const [live, setLive] = useState(false)
  const client = clients.find((c) => c.ref === ref) ?? clients[0]

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between bg-brand px-5 py-3 text-white">
        <div className="font-semibold tracking-wide">UNRISKOMEGA <span className="font-normal opacity-80">· 60-Second Briefing</span></div>
        <div className="flex gap-2">
          <button className="rounded bg-white/15 px-3 py-1.5 text-xs hover:bg-white/25">Upload clients.json</button>
          <button className="rounded bg-white/15 px-3 py-1.5 text-xs hover:bg-white/25">Import PDF (ex-custody)</button>
          <button onClick={() => setLive((v) => !v)} className="rounded bg-white px-3 py-1.5 text-xs font-semibold text-brand-dark">{live ? 'Exit live mode' : 'Live call mode'}</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-line bg-white">
          <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Clients</div>
          {clients.map((c) => (
            <button key={c.ref} onClick={() => setRef(c.ref)} className={`block w-full border-l-4 px-4 py-3 text-left hover:bg-surface ${c.ref === ref ? 'border-brand bg-surface' : 'border-transparent'}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{c.name}</span>
                {c.alerts > 0 && <span className="rounded-full bg-risk px-1.5 text-[10px] font-semibold text-white">{c.alerts}</span>}
              </div>
              <div className="text-xs text-muted">{c.mandate}</div>
              <div className="text-xs text-muted">{c.context}</div>
            </button>
          ))}
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-4xl space-y-4">
            <div className="flex items-baseline justify-between">
              <h1 className="text-xl font-semibold">{client.name} <span className="text-sm font-normal text-muted">{client.ref} · {client.aum}</span></h1>
              <span className="text-xs text-muted">{client.context} · ~60s read</span>
            </div>
            {client.briefing.map((card, i) => <CardView key={`${client.ref}-${i}`} card={card} />)}
          </div>
        </main>

        {!live && <aside className="hidden w-80 shrink-0 border-l border-line bg-white lg:block"><ChatDock client={client} /></aside>}
      </div>

      {live && <LiveOverlay client={client} onClose={() => setLive(false)} />}
    </div>
  )
}
