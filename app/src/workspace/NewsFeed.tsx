import { Newspaper } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SeverityIcon } from '../cards/ui'
import type { NewsItem } from '../types'

const START_HIDDEN = 2 // die jüngsten Meldungen treffen während der Sitzung nacheinander ein
const FIRST_ARRIVAL_MS = 5000
const ARRIVAL_MS = 12000

// Meldungen des Tages, gefiltert auf den gewählten Kunden. Neue Meldungen erscheinen oben und
// bleiben kurz hervorgehoben; Meldungen ohne Bezug zum Kunden sind standardmässig ausgeblendet.
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
  const shown = all ? arrived : relevant
  const newest = arrived[0]
  const fresh = new Set(feed.slice(hidden, START_HIDDEN).map((n) => n.id)) // erst während der Sitzung eingetroffen

  return (
    <section className="flex min-h-0 flex-col bg-white shadow-card">
      <div className="flex shrink-0 items-center gap-2 px-3.5 pt-3.5">
        <h3 className="flex items-center gap-1.5 text-[13px]"><Newspaper size={15} strokeWidth={1.5} /> Nachrichten</h3>
        <span className="flex items-center gap-1 rounded-sm bg-risk/10 px-1.5 py-px text-[10px] uppercase tracking-wide text-risk"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-risk" /> Live</span>
        <span className="ml-auto text-[11px] tabular-nums text-muted">Stand {newest?.time ?? '–'}</span>
      </div>
      <div className="flex shrink-0 items-center justify-between px-3.5 pb-2 pt-1 text-[11px] text-muted">
        <span>{arrived.length} geprüft · <span className="text-ink">{relevant.length} relevant</span></span>
        <button onClick={() => setAll((a) => !a)} className="text-brand hover:underline">{all ? 'Nur relevante' : 'Alle anzeigen'}</button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 && <li className="px-3.5 pb-3.5 text-[11px] text-muted">Heute keine Meldung mit Bezug zu diesem Kunden.</li>}
        {shown.map((n, i) => {
          const hit = n.affects[clientRef]
          return (
            <li key={n.id} className={`${fresh.has(n.id) ? 'news-in' : ''} border-l-[3px] px-3 py-2 ${hit ? 'border-brand' : 'border-transparent opacity-55'} ${i % 2 ? '' : 'bg-stripe'}`}>
              <div className="flex items-start gap-2">
                <span className="mt-px shrink-0 text-[11px] tabular-nums text-muted">{n.time}</span>
                <span className="min-w-0 flex-1 text-xs leading-snug">{n.title}</span>
                <span className="shrink-0 rounded-sm bg-pill px-1.5 py-px text-[10px]">{n.reach}</span>
              </div>
              {hit && (
                <div className="mt-1 flex items-start gap-1.5 pl-[38px] text-[11px] leading-snug">
                  <span className="mt-px"><SeverityIcon severity={hit.severity} size={11} /></span>
                  <span><span className="text-muted">{hit.position} · </span>{hit.meaning}</span>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
