// HTTP side of the news agent, mounted by server/api.ts. Contract: PLAN.md section 3 "News".
//   GET  /api/news/:ref        inbound: this client's relevant news now  → { items: NewsItem[], findings, offline }
//   GET  /api/news             the day's feed over all clients (affects filled per client)
//   GET  /api/outbound         "who to call today": every client ranked by news and engine findings
//   POST /api/news             demo control: { title, source?, snippet? } is matched on the next request
//   POST /api/news/snapshot    save what was fetched as the offline fallback (run once with network)
// Language: the GET routes take `lang` ('de' | 'en') as their last argument, read by server/api.ts from
// `?lang=` with langOf(); absent = English, as on every route. POST /api/news reads
// body `language`. Headlines are never translated; the judged cache holds both languages.

import { readClient } from '../../engine/data.ts'
import { langOf, pick, type Lang } from '../../engine/lang.ts'
import type { Finding } from '../../engine/types.ts'
import { clientsWithFindings } from '../ai/briefing-route.ts'
import { holdingsOf, type Holding } from './holdings.ts'
import { engineReasons, newsPoints, weigh, type Reason } from './score.ts'
import { CACHE_MS, newsFindings, newsHits, pushArticle, saveSnapshot, severityOf, toNewsItems, hitScore, pctText, type Complete, type Hit, type NewsItemOut } from './news.ts'

const INBOUND = { maxAgeMs: 60_000, judgeWithinMs: 4000 }
let lastRefresh: string | undefined

type Entry = Awaited<ReturnType<typeof clientsWithFindings>>[number]

// Engine findings in the advisor's language (their titles become outbound reasons). Typed with the optional
// `lang` so this compiles before and after ai/briefing-route.ts takes it; until then the findings stay German.
const withFindings: (now: Date, lang?: Lang) => ReturnType<typeof clientsWithFindings> = clientsWithFindings

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

export async function clientNews(ref: string, complete: Complete | null, lang: Lang = 'en') {
  const now = new Date()
  const e = (await withFindings(now, lang)).find((x) => x.ref === ref)
  if (!e) return { status: 404, data: { error: pick(lang)('Kunde nicht gefunden', 'Client not found') } }
  // A call is now: fetch this client's holdings fresh (under 1 s) and give the model 4 s for articles it has not seen.
  const hits = await newsHits(holdingsFor(e), now, complete, undefined, INBOUND)
  const items = [...toNewsItems(ref, hits, now, undefined, lang).values()]
  return { status: 200, data: { items, findings: newsFindings(ref, hits, lang), offline: hits.some((h) => h.offline), judgedBy: complete ? 'ai' : 'rules', fetchedAt: now.toISOString() } }
}

/** News findings for the briefing's slow tier. Never throws: no news is an empty list. */
export async function briefingNews(ref: string, complete: Complete | null, lang: Lang = 'en'): Promise<Finding[]> {
  try { const out = await clientNews(ref, complete, lang); return out.status === 200 ? (out.data as { findings: Finding[] }).findings : [] } catch { return [] }
}

export async function newsFeed(complete: Complete | null, lang: Lang = 'en') {
  const now = new Date()
  const entries = await withFindings(now, lang)
  const all = await hitsForAll(entries, now, complete)
  const merged = new Map<string, NewsItemOut>()
  for (const e of entries) toNewsItems(e.ref, ownHits(e, all), now, merged, lang)
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

// An opportunity is only a reason to call if it does not touch a holding the client wants out of
// (a contradiction finding quotes that position).
function blockedByWish(h: Hit, findings: Finding[]) {
  return findings.some((f) => f.check.startsWith('contradiction') && f.evidence.some((ev) => ev.quote !== undefined && h.holding.names.includes(ev.quote)))
}

export async function outbound(complete: Complete | null, lang: Lang = 'en') {
  const now = new Date()
  const entries = await withFindings(now, lang)
  const all = await hitsForAll(entries, now, complete)
  // A reason to call is worth less the more clients share the same article (score.ts).
  const counts = (h: Hit) => h.judgement.direction !== 'neutral' && h.judgement.importance >= 2
  const own = entries.map((e) => ownHits(e, all))
  const sharedBy = new Map<string, number>()
  for (const hits of own) for (const id of new Set(hits.filter(counts).map((h) => h.article.id))) sharedBy.set(id, (sharedBy.get(id) ?? 0) + 1)
  const ranked = entries.map((e, n) => {
    const news: Reason[] = []
    const counted = new Set<string>() // one story per holding: three papers on the same news count once
    for (const h of own[n]) {
      if (!counts(h) || counted.has(h.holding.query)) continue
      if (h.judgement.direction === 'opportunity' && blockedByWish(h, e.findings)) continue
      counted.add(h.holding.query)
      news.push({
        kind: h.judgement.direction as Reason['kind'], severity: severityOf(h.judgement), newsId: h.article.id, url: h.article.url || undefined, points: newsPoints(hitScore(h), sharedBy.get(h.article.id) ?? 1),
        title: `${h.holding.label} (${pctText(h.holding.weight)}): ${h.article.title}`,
      })
    }
    // House view (cio.house-view): a recent change of the view that touches this client, or an opportunity with a
    // ready, re-checked step, is a reason to call today. At most two per client.
    const view = e.findings.filter((f) => f.check === 'cio.house-view' && !f.id.endsWith(':summary') && (f.numbers?.changed || f.fix))
      .sort((a, b) => (b.numbers?.changed ?? 0) - (a.numbers?.changed ?? 0)).slice(0, 2)
    const houseView: Reason[] = view.map((f) => ({ kind: f.kind === 'action' ? 'opportunity' : 'risk', severity: f.severity === 'ok' ? 'ok' : 'warn', title: f.title, findingId: f.id, points: (f.numbers?.changed ? 1.2 : 0) + (f.fix ? 0.8 : 0) }))
    // The client's own file (rule breaches, missing cash, a bad month ...) weighs at least as much as the news.
    const { score, reasons } = weigh(news, engineReasons(e.findings, lang), houseView)
    return { ref: e.ref, name: e.name, score, opportunities: reasons.filter((r) => r.kind === 'opportunity').length, reasons: reasons.slice(0, 5) }
  })
  ranked.sort((a, b) => b.score - a.score)
  lastRefresh = now.toISOString()
  return { status: 200, data: { date: now.toISOString().slice(0, 10), fetchedAt: lastRefresh, offline: all.some((h) => h.offline), judgedBy: complete ? 'ai' : 'rules', clients: ranked } }
}

export function pushNews(body: Buffer) {
  const p = JSON.parse(body.toString('utf8') || '{}') as { title?: unknown; source?: unknown; snippet?: unknown; url?: unknown; language?: unknown }
  const lang = langOf(p.language)
  if (typeof p.title !== 'string' || !p.title.trim()) return { status: 400, data: { error: pick(lang)('title fehlt', 'title is missing') } }
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined)
  return { status: 200, data: pushArticle({ title: p.title.trim(), source: s(p.source), snippet: s(p.snippet), url: s(p.url) }, new Date(), lang) }
}

export async function snapshotNews() {
  return { status: 200, data: { saved: await saveSnapshot() } }
}
