import { Newspaper } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SeverityIcon } from '../cards/ui'
import type { NewsItem } from '../types'

const START_HIDDEN = 2 // the newest items arrive one by one during the session
const FIRST_ARRIVAL_MS = 5000
const ARRIVAL_MS = 12000
const MAX_RELEVANT = 4
const MAX_ALL = 7

// The day's news filtered to the selected client. Fixed height, never scrolls: only the newest few
// are shown, the rest sit behind a counter. Meaning and affected position are on hover.
export function NewsFeed({ feed, clientRef }: { feed: NewsItem[]; clientRef: string }) {
  const [hidden, setHidden] = useState(Math.min(START_HIDDEN, feed.length))
  const [all, setAll] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (hidden <= 0) return
    const timer = setTimeout(() => setHidden((h) => h - 1), hidden === START_HIDDEN ? FIRST_ARRIVAL_MS : ARRIVAL_MS)
    return () => clearTimeout(timer)
  }, [hidden])

  const arrived = feed.slice(hidden)
  const relevant = arrived.filter((n) => n.affects[clientRef])
  const pool = all ? arrived : relevant
  const shown = pool.slice(0, all ? MAX_ALL : MAX_RELEVANT)
  const fresh = new Set(feed.slice(hidden, START_HIDDEN).map((n) => n.id))

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-white shadow-card">
      <div className="flex shrink-0 items-center gap-2 px-3.5 pb-2 pt-3.5">
        <h3 className="flex items-center gap-1.5 text-[13px]"><Newspaper size={15} strokeWidth={1.5} /> Nachrichten</h3>
        <span className="flex items-center gap-1 rounded-sm bg-risk/10 px-1.5 py-px text-[10px] uppercase tracking-wide text-risk"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-risk" /> Live</span>
        <button onClick={() => setAll((a) => !a)} title={all ? 'Nur relevante anzeigen' : 'Alle Meldungen anzeigen'} className="ml-auto text-[11px] tabular-nums text-muted hover:text-brand">
          <span className="text-ink">{relevant.length}</span> von {arrived.length}
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-hidden">
        {shown.length === 0 && <li className="px-3.5 text-[11px] text-muted">Keine Meldung zu diesem Kunden.</li>}
        {shown.map((n, i) => {
          const hit = n.affects[clientRef]
          const isOpen = expanded === n.id
          return (
            <li key={n.id} className={`${fresh.has(n.id) ? 'news-in' : ''} border-l-[3px] ${hit ? 'border-brand' : 'border-transparent opacity-55'} ${i % 2 ? '' : 'bg-stripe'}`}>
              <button onClick={() => setExpanded(isOpen ? null : n.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                <span className="shrink-0 text-[11px] tabular-nums text-muted">{n.time}</span>
                <span className="min-w-0 flex-1 truncate text-xs">{n.title}</span>
                {hit && <span className="flex shrink-0 items-center gap-1 rounded-sm bg-pill px-1.5 py-px text-[10px]"><SeverityIcon severity={hit.severity} size={10} /> {hit.tag}</span>}
              </button>
              {isOpen && (
                <div className="anim-rise space-y-0.5 px-3 pb-2 pl-[52px] text-[11px] leading-snug text-muted">
                  {hit && <div><span className="text-ink">{hit.position}</span> · {hit.meaning}</div>}
                  <div>{n.source}</div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {pool.length > shown.length && <div className="shrink-0 px-3.5 pb-2 pt-1 text-right text-[11px] text-muted">+{pool.length - shown.length} weitere</div>}
    </section>
  )
}
