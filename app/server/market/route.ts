// HTTP side of the news agent, mounted by server/api.ts. Contract: PLAN.md section 3 "News".
//   GET  /api/news/:ref        inbound: this client's relevant news now  → { items: NewsItem[], findings, offline }
//   GET  /api/news             the day's feed over all clients (affects filled per client)
//   GET  /api/outbound         "who to call today": every client ranked by news and engine findings
//   POST /api/news             demo control: { title, source?, snippet? } is matched on the next request
//   POST /api/news/snapshot    save what was fetched as the offline fallback (run once with network)

import { readClient } from '../../engine/data.ts'
import type { Finding } from '../../engine/types.ts'
import { clientsWithFindings } from '../ai/briefing-route.ts'
import { holdingsOf, type Holding } from './holdings.ts'
import { CACHE_MS, newsFindings, newsHits, pushArticle, saveSnapshot, severityOf, toNewsItems, hitScore, pctText, type Complete, type Hit, type NewsItemOut, type Severity } from './news.ts'

const INBOUND = { maxAgeMs: 60_000, judgeWithinMs: 4000 }
let lastRefresh: string | undefined

type Entry = Awaited<ReturnType<typeof clientsWithFindings>>[number]

const holdingsFor = (e: Entry) => holdingsOf(readClient(e.raw, e.index))

// A client's own view of a shared hit: same article and judgement, the client's own weight.
function ownHits(e: Entry, all: Hit[]): Hit[] {
  const mine = new Map(holdingsFor(e).map((h) => [h.query, h]))
  return all.flatMap((h) => { const own = mine.get(h.holding.query); return own ? [{ ...h, holding: own }] : [] })
    .sort((a, b) => hitScore(b) - hitScore(a))
}

async function hitsForAll(entries: Entry[], now: Date, complete: Complete | null) {
  const unique = new Map<string, Holding>()
  for (const e of entries) for (const h of holdingsFor(e)) if (!unique.has(h.query)) unique.set(h.query, h)
  return newsHits([...unique.values()], now, complete)
}

export async function clientNews(ref: string, complete: Complete | null) {
  const now = new Date()
  const e = (await clientsWithFindings(now)).find((x) => x.ref === ref)
  if (!e) return { status: 404, data: { error: 'Kunde nicht gefunden' } }
  // A call is now: fetch this client's holdings fresh (under 1 s) and give the model 4 s for articles it has not seen.
  const hits = await newsHits(holdingsFor(e), now, complete, undefined, INBOUND)
  const items = [...toNewsItems(ref, hits, now).values()]
  return { status: 200, data: { items, findings: newsFindings(ref, hits), offline: hits.some((h) => h.offline), judgedBy: complete ? 'ai' : 'rules', fetchedAt: now.toISOString() } }
}

/** News findings for the briefing's slow tier. Never throws: no news is an empty list. */
export async function briefingNews(ref: string, complete: Complete | null): Promise<Finding[]> {
  try { const out = await clientNews(ref, complete); return out.status === 200 ? (out.data as { findings: Finding[] }).findings : [] } catch { return [] }
}

export async function newsFeed(complete: Complete | null) {
  const now = new Date()
  const entries = await clientsWithFindings(now)
  const all = await hitsForAll(entries, now, complete)
  const merged = new Map<string, NewsItemOut>()
  for (const e of entries) toNewsItems(e.ref, ownHits(e, all), now, merged)
  const items = [...merged.values()].sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''))
  return { status: 200, data: items }
}

// Keeps news and judgements fresh for everyone: runs the outbound pass at start and every CACHE_MS, so the
// "who to call today" list and most inbound calls are answered from a cache that is at most 10 minutes old.
let watcher: ReturnType<typeof setInterval> | undefined
export function startNewsWatcher(complete: Complete | null) {
  if (watcher) return
  const tick = () => { outbound(complete).catch(() => { /* next tick tries again */ }) }
  tick()
  watcher = setInterval(tick, CACHE_MS)
  watcher.unref?.()
}

export const newsStatus = () => ({ watching: !!watcher, lastRefresh })

type Reason = { kind: 'risk' | 'opportunity'; title: string; severity: Severity; findingId?: string; newsId?: string; url?: string; points: number }

// An opportunity is only a reason to call if it does not touch a holding the client wants out of
// (a contradiction finding quotes that position).
function blockedByWish(h: Hit, findings: Finding[]) {
  return findings.some((f) => f.check.startsWith('contradiction') && f.evidence.some((ev) => ev.quote !== undefined && h.holding.names.includes(ev.quote)))
}

const ENGINE_POINTS = { risk: 1, warn: 0.3 } as const
const MAX_ENGINE = 3

export async function outbound(complete: Complete | null) {
  const now = new Date()
  const entries = await clientsWithFindings(now)
  const all = await hitsForAll(entries, now, complete)
  const ranked = entries.map((e) => {
    const reasons: Reason[] = []
    const counted = new Set<string>() // one story per holding: three papers on the same news count once
    for (const h of ownHits(e, all)) {
      if (h.judgement.direction === 'neutral' || h.judgement.importance < 2 || counted.has(h.holding.query)) continue
      if (h.judgement.direction === 'opportunity' && blockedByWish(h, e.findings)) continue
      counted.add(h.holding.query)
      reasons.push({
        kind: h.judgement.direction, severity: severityOf(h.judgement), newsId: h.article.id, url: h.article.url || undefined, points: hitScore(h),
        title: `${h.holding.label} (${pctText(h.holding.weight)}): ${h.article.title}`,
      })
    }
    const engine = e.findings.filter((f) => f.severity === 'risk' || (f.severity === 'warn' && f.kind === 'action'))
      .sort((a, b) => (a.severity === 'risk' ? 0 : 1) - (b.severity === 'risk' ? 0 : 1)).slice(0, MAX_ENGINE)
    for (const f of engine) reasons.push({ kind: 'risk', severity: f.severity, title: f.title, findingId: f.id, points: ENGINE_POINTS[f.severity as 'risk' | 'warn'] ?? 0 })
    reasons.sort((a, b) => b.points - a.points)
    const score = Math.round(reasons.reduce((s, r) => s + r.points, 0) * 10) / 10
    return { ref: e.ref, name: e.name, score, opportunities: reasons.filter((r) => r.kind === 'opportunity').length, reasons: reasons.slice(0, 5) }
  })
  ranked.sort((a, b) => b.score - a.score)
  lastRefresh = now.toISOString()
  return { status: 200, data: { date: now.toISOString().slice(0, 10), fetchedAt: lastRefresh, offline: all.some((h) => h.offline), judgedBy: complete ? 'ai' : 'rules', clients: ranked } }
}

export function pushNews(body: Buffer) {
  const p = JSON.parse(body.toString('utf8') || '{}') as { title?: unknown; source?: unknown; snippet?: unknown; url?: unknown }
  if (typeof p.title !== 'string' || !p.title.trim()) return { status: 400, data: { error: 'title fehlt' } }
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined)
  return { status: 200, data: pushArticle({ title: p.title.trim(), source: s(p.source), snippet: s(p.snippet), url: s(p.url) }, new Date()) }
}

export async function snapshotNews() {
  return { status: 200, data: { saved: await saveSnapshot() } }
}
