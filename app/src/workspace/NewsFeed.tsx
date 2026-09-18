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
// are shown, the rest sit behind a counter. Each is a self-contained bubble: title, meaning and
// affected position at a glance, nothing hidden behind a click.
export function NewsFeed({ feed, clientRef }: { feed: NewsItem[]; clientRef: string }) {
  const [hidden, setHidden] = useState(Math.min(START_HIDDEN, feed.length))
  const [all, setAll] = useState(false)

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
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white/75 shadow-card ring-1 ring-black/5 backdrop-blur-md">
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2.5 pt-4">
        <h3 className="flex items-center gap-1.5 text-[14px]"><Newspaper size={17} strokeWidth={1.5} /> Nachrichten</h3>
        <span className="flex items-center gap-1 rounded-full bg-risk/10 px-1.5 py-px text-[10px] uppercase tracking-wide text-risk"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-risk" /> Live</span>
        <button onClick={() => setAll((a) => !a)} title={all ? 'Nur relevante anzeigen' : 'Alle Meldungen anzeigen'} className="ml-auto text-[11px] tabular-nums text-muted hover:text-brand">
          <span className="text-ink">{relevant.length}</span> von {arrived.length}
        </button>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pb-3">
        {shown.length === 0 && <li className="px-1 text-[11px] text-muted">Keine Meldung zu diesem Kunden.</li>}
        {shown.map((n) => {
          const hit = n.affects[clientRef]
          return (
            <li key={n.id} className={`${fresh.has(n.id) ? 'news-in' : ''} rounded-xl px-3.5 py-3 ${hit ? 'bg-brand-soft/25' : 'bg-stripe opacity-70'}`}>
              <div className="flex items-start gap-2.5">
                {hit && <span className="mt-0.5 shrink-0"><SeverityIcon severity={hit.severity} size={15} /></span>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[10px] tabular-nums text-muted">
                    <span>{n.time}</span>
                    {hit && <span className="rounded-full bg-pill px-1.5 py-px text-[10px] normal-case text-ink">{hit.tag}</span>}
                  </div>
                  <p className="mt-0.5 text-[13px] leading-snug text-ink">{n.title}</p>
                  {hit && <p className="mt-1 text-[11px] leading-snug text-muted"><span className="text-ink">{hit.position}</span> · {hit.meaning}</p>}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {pool.length > shown.length && <div className="shrink-0 px-4 pb-3 pt-1 text-right text-[11px] text-muted">+{pool.length - shown.length} weitere</div>}
    </section>
  )
}
