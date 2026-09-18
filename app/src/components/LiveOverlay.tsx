import { X } from 'lucide-react'
import type { Client } from '../types'
import { SeverityIcon } from '../cards/ui'
import { ChatDock } from './ChatDock'

// Compact in-call mode: one glanceable strip of what matters, chat as fallback.
export function LiveOverlay({ client, onClose }: { client: Client; onClose: () => void }) {
  const headline = client.briefing.find((c) => c.type === 'headline')
  const flags = client.briefing.find((c) => c.type === 'flags')
  const actions = client.briefing.find((c) => c.type === 'actions')

  return (
    <div className="fixed bottom-2 right-2 z-20 flex max-h-[calc(100vh-290px)] w-[300px] flex-col bg-white shadow-[0_4px_24px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between bg-topbar px-3 py-2 text-xs text-white">
        <span className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-risk" /> Telefonberatung · {client.name}</span>
        <button onClick={onClose}><X size={14} /></button>
      </div>
      <div className="space-y-3 overflow-y-auto p-4">
        {headline && <p className="text-[15px] leading-snug">{headline.text}</p>}
        {flags && (
          <ul className="space-y-1.5 text-xs">
            {flags.items.map((f) => <li key={f.text} className="flex items-center gap-2"><SeverityIcon severity={f.severity} size={12} />{f.text}</li>)}
          </ul>
        )}
        {actions && (
          <div className="border-l-2 border-brand bg-stripe px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted">Say next</div>
            {actions.items[0].text}
          </div>
        )}
      </div>
      <ChatDock client={client} className="h-60 border-t border-line !shadow-none" />
    </div>
  )
}
