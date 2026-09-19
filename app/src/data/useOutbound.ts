import { useEffect, useState } from 'react'

// "Who to call today": the server ranks all clients by their findings and today's matched news
// (N1, /api/outbound). Polled; the same array is kept while the ranking did not change.

export type OutboundReason = { kind: 'risk' | 'opportunity'; severity: 'risk' | 'warn' | 'ok' | 'info'; title: string; newsId?: string; findingId?: string; url?: string }
export type OutboundEntry = { ref: string; name?: string; score: number; opportunities?: number; reasons: OutboundReason[] }

const NONE: OutboundEntry[] = []

export function useOutbound(intervalMs = 120_000) {
  const [ranking, setRanking] = useState<OutboundEntry[]>(NONE)
  useEffect(() => {
    let stopped = false
    const tick = async () => {
      try {
        const r = await fetch('/api/outbound')
        if (!r.ok) return
        const data = await r.json() as { clients?: OutboundEntry[] }
        const next = Array.isArray(data.clients) ? data.clients : NONE
        if (!stopped) setRanking((prev) => (JSON.stringify(prev.map((x) => [x.ref, x.score])) === JSON.stringify(next.map((x) => [x.ref, x.score])) ? prev : next))
      } catch { /* keep the last ranking */ }
    }
    void tick()
    const timer = setInterval(() => void tick(), intervalMs)
    return () => { stopped = true; clearInterval(timer) }
  }, [intervalMs])
  return ranking
}
