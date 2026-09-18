import type { Client } from '../types'
import { toneDot } from '../cards/ui'
import { ChatDock } from './ChatDock'

// Compact in-call mode: one glanceable strip of what matters, chat as fallback.
export function LiveOverlay({ client, onClose }: { client: Client; onClose: () => void }) {
  const headline = client.briefing.find((c) => c.type === 'headline')
  const flags = client.briefing.find((c) => c.type === 'flags')
  const actions = client.briefing.find((c) => c.type === 'actions')

  return (
    <div className="fixed right-6 top-20 z-20 flex max-h-[80vh] w-[380px] flex-col overflow-hidden rounded-xl border border-white/20 bg-ink/90 text-white shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
          <span className="h-2 w-2 animate-pulse rounded-full bg-risk" /> Live · {client.name}
        </span>
        <button onClick={onClose} className="text-slate-300 hover:text-white">✕</button>
      </div>
      <div className="space-y-3 overflow-y-auto px-4 pb-3">
        {headline && <p className="font-medium leading-snug">{headline.text}</p>}
        {flags && (
          <ul className="space-y-1 text-sm text-slate-200">
            {flags.items.map((f) => (
              <li key={f.text} className="flex gap-2"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${toneDot[f.severity]}`} />{f.text}</li>
            ))}
          </ul>
        )}
        {actions && (
          <div className="rounded-lg bg-white/10 p-3 text-sm">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-300">Say next</div>
            {actions.items[0].text}
          </div>
        )}
      </div>
      <div className="h-64 bg-white text-ink"><ChatDock client={client} /></div>
    </div>
  )
}
