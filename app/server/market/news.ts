// The news agent. For each holding it searches the web (Bing News RSS), keeps articles that name the holding,
// and has the model judge each one: relevant for an investor in it? how important? risk or opportunity?
// The model only reads security names and headlines, never client data. Weights and scores are computed here.
// No model: keyword rules judge. No network: the last saved snapshot answers, labelled offline.
// Language: a judgement carries its sentence in German and English (one judging call, one cache), and what
// is built from it takes an optional `lang` (German when absent). Headlines are data and never translated.

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pick, sourceName, type Lang } from '../../engine/lang.ts'
import type { Evidence, Finding } from '../../engine/types.ts'
import { searchBing, type Article } from './bing.ts'
import type { Holding } from './holdings.ts'

export type Direction = 'risk' | 'opportunity' | 'neutral'
export type Judgement = { relevant: boolean; importance: 0 | 1 | 2 | 3; direction: Direction; meaning: string; meaningEn: string; by: 'ai' | 'rules' }
/** The judgement's sentence in the advisor's language (German when absent). */
export const meaningOf = (j: Judgement, lang?: Lang) => (lang === 'en' ? j.meaningEn || j.meaning : j.meaning)
export type Hit = { holding: Holding; article: Article; judgement: Judgement }
export type Complete = (messages: { role: 'system' | 'user'; content: string }[]) => Promise<unknown>
export type Severity = 'risk' | 'warn' | 'ok' | 'info'

const RECENT_DAYS = 3
const PER_HOLDING = 4
export const CACHE_MS = 10 * 60_000 // the watcher refreshes this often; nothing older is served while online
export type Freshness = { maxAgeMs?: number; judgeWithinMs?: number }
const SNAPSHOT_PER_QUERY = 6
const SNAPSHOT = resolve(process.cwd(), 'server/market/news-snapshot.json')

// ---- fetching -------------------------------------------------------------------------------------

type Fetched = { at: number; articles: Article[]; offline: boolean }
const fetched = new Map<string, Fetched>()
const pushed: Article[] = [] // demo control: items pushed live via POST /api/news
let snapshot: Record<string, Article[]> | null = null

async function loadSnapshot() {
  if (snapshot) return snapshot
  try { snapshot = JSON.parse(await readFile(SNAPSHOT, 'utf8')) as Record<string, Article[]> } catch { snapshot = {} }
  return snapshot
}

export async function articlesFor(query: string, search: (q: string) => Promise<Article[]> = searchBing, maxAgeMs = CACHE_MS): Promise<Fetched> {
  const hit = fetched.get(query)
  if (hit && !hit.offline && Date.now() - hit.at < maxAgeMs) return hit
  let out: Fetched
  try { out = { at: Date.now(), articles: await search(query), offline: false } } catch {
    out = { at: Date.now(), articles: (await loadSnapshot())[query] ?? [], offline: true }
  }
  fetched.set(query, out)
  return out
}

/** Writes what is cached now as the offline snapshot (run once before the demo with network). */
export async function saveSnapshot() {
  const base = await loadSnapshot()
  for (const [q, f] of fetched) {
    const own = f.articles.filter((a) => mentions(a, q) && !isQuotePage(a.title)).slice(0, SNAPSHOT_PER_QUERY)
    if (!f.offline && own.length) base[q] = own
  }
  await writeFile(SNAPSHOT, JSON.stringify(base, null, 1))
  return Object.keys(base).length
}

export function pushArticle(a: { title: string; source?: string; snippet?: string; url?: string }, now: Date, lang?: Lang): Article {
  const article: Article = { id: `N-push-${pushed.length + 1}`, title: a.title, url: a.url ?? '', source: a.source ?? pick(lang)('Eingespielt (Demo)', 'Pushed (demo)'), published: now.toISOString(), snippet: a.snippet ?? '' }
  pushed.unshift(article)
  return article
}

// ---- matching -------------------------------------------------------------------------------------

export const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
export const mentions = (a: Pick<Article, 'title' | 'snippet'>, query: string) => norm(`${a.title} ${a.snippet}`).includes(norm(query))
// Price pages and fund fact sheets are not news.
export const isQuotePage = (title: string) => /^(Kurs|Aktien?|Chart|Fondsporträt|Factsheet)\b(?!ziel)|\bUCITS ETF\b|\bETF\b.*\b(acc|dist|CHF|USD|EUR)$/i.test(title.trim())

export function recent(a: Article, now: Date, days = RECENT_DAYS) {
  if (!a.published) return true
  const age = now.getTime() - Date.parse(a.published)
  return age <= days * 86_400_000 && age > -86_400_000
}

/** Articles to judge for these holdings: they must name the holding; live ones must be recent. Newest first. */
export async function candidates(holdings: Holding[], now: Date, search?: (q: string) => Promise<Article[]>, maxAgeMs = CACHE_MS) {
  const out: { holding: Holding; article: Article; offline: boolean }[] = []
  await pool(holdings, 4, async (h) => {
    const f = await articlesFor(h.query, search, maxAgeMs)
    const own = [...pushed, ...f.articles]
      .filter((a) => mentions(a, h.query) && !isQuotePage(a.title) && (f.offline || recent(a, now)))
      .sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''))
    const seen = new Set<string>()
    for (const a of own) {
      const key = norm(a.title).slice(0, 60)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ holding: h, article: a, offline: f.offline && !a.id.startsWith('N-push') })
      if (seen.size >= PER_HOLDING) break
    }
  })
  return out
}

async function pool<T>(items: T[], size: number, work: (t: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) await work(items[next++]) }))
}

// ---- judging --------------------------------------------------------------------------------------

const RISK = /gewinnwarnung|einbruch|bricht ein|stürzt|sturz|verlust|klage|busse|strafe|rückruf|herabstuf|downgrade|abschreibung|wertberichtigung|beschlagnahm|enteign|sinkt|fällt|fallen|stellenabbau|warnt|senkt|kürzt|skandal|ermittl|untersuch|sanktion|russland|schlag gegen|kämpft|droht|verlust des|profit warning|plunge|lawsuit|fine|cut/i
// English headlines (US names): whole words only, so they never fire inside a German word.
const RISK_EN = /\b(drops|slumps?|tumbles?|plummets?|sinks|warns|layoffs|scandal|recall|sanctions|probe into|misses)\b/i
const CHANCE_EN = /\b(rises|surges|jumps|soars|takeover|acquires|dividend|wins|tops estimates)\b/i
const CHANCE = /übernahm|übernimmt|rekord|steigt|steigen|hebt|erhöht|dividende|rückkauf|aufstuf|upgrade|kaufempfehlung|übertrifft|zulassung|auftrag|gewinnt|wachstum|beat|raises|record|buyback|approval/i

export function ruleJudgement(a: Pick<Article, 'title' | 'snippet'>, query: string): Judgement {
  if (!mentions(a, query)) return { relevant: false, importance: 0, direction: 'neutral', meaning: '', meaningEn: '', by: 'rules' }
  const text = a.title
  const risk = RISK.test(text) || RISK_EN.test(text), chance = CHANCE.test(text) || CHANCE_EN.test(text)
  const direction: Direction = risk && !chance ? 'risk' : chance && !risk ? 'opportunity' : 'neutral'
  const meaning = direction === 'risk' ? 'Negative Meldung zu einer Position im Portfolio: Einordnung bereithalten.'
    : direction === 'opportunity' ? 'Positive Meldung zu einer Position: guter Anlass für einen Anruf.'
      : 'Meldung zu einer Position im Portfolio.'
  const meaningEn = direction === 'risk' ? 'Negative news on a position in the portfolio: have your assessment ready.'
    : direction === 'opportunity' ? 'Positive news on a position: a good reason to call.'
      : 'News on a position in the portfolio.'
  return { relevant: true, importance: direction === 'neutral' ? 1 : 2, direction, meaning, meaningEn, by: 'rules' }
}

const judged = new Map<string, Judgement>()
const inflight = new Map<string, Promise<void>>() // items the model is judging right now (watcher and a call may overlap)
const JUDGE_BATCH = 20

export const JUDGE_RULES = `You screen news for a Swiss private banker. Each item names an INVESTMENT (a company, bond issuer or fund theme) and one headline with a snippet.
Decide for each item:
- relevant: true only if the article is really about this investment (not a namesake, not a passing mention) and could matter to someone holding it.
- importance: 0 none, 1 routine, 2 worth mentioning to a client who holds it, 3 the client may call about it today (big price move, profit warning, takeover, scandal, sanctions, rating change).
- direction: "risk" if it is bad for a holder, "opportunity" if it is good for a holder, else "neutral".
- meaning: ONE sentence in German (Swiss spelling, ss not ß), max 18 words, what it means for someone holding this investment. Use no number that is not in the headline or snippet. No advice to buy or sell.
- meaning_en: the same sentence in English (British spelling), max 18 words, same rules. The headline itself is never translated or quoted in another language.
Answer as JSON: {"items":[{"i":number,"relevant":boolean,"importance":0|1|2|3,"direction":"risk"|"opportunity"|"neutral","meaning":string,"meaning_en":string}]}`

const numbersIn = (s: string) => s.match(/\d+(?:[.,']\d+)*/g) ?? []

function checkedMeaning(meaning: unknown, a: Article, fallback: string, german = true) {
  if (typeof meaning !== 'string' || !meaning.trim()) return fallback
  const source = `${a.title} ${a.snippet}`
  return numbersIn(meaning).every((n) => source.includes(n)) ? (german ? meaning.trim().replace(/ß/g, 'ss') : meaning.trim()) : fallback
}

// judgeWithinMs: answer after this long even if the model is still busy; unfinished items get the rules now
// and the model's judgement lands in the cache for the next request.
export async function judge(items: { holding: Holding; article: Article }[], complete: Complete | null, judgeWithinMs?: number): Promise<Judgement[]> {
  const key = (x: { holding: Holding; article: Article }) => `${x.holding.query}|${x.article.id}`
  const todo = items.filter((x) => !judged.has(key(x)) && !inflight.has(key(x)))
  const waiting = [...new Set(items.map(key).filter((k) => inflight.has(k)))].map((k) => inflight.get(k))
  if (complete) {
    const batches: (typeof todo)[] = []
    for (let i = 0; i < todo.length; i += JUDGE_BATCH) batches.push(todo.slice(i, i + JUDGE_BATCH))
    const work = pool(batches, 3, async (batch) => {
      try {
        const answer = await complete([
          { role: 'system', content: JUDGE_RULES },
          { role: 'user', content: JSON.stringify(batch.map((x, i) => ({ i, investment: x.holding.label, headline: x.article.title, snippet: x.article.snippet.slice(0, 300), source: x.article.source, date: x.article.published?.slice(0, 10) }))) },
        ]) as { items?: { i?: unknown; relevant?: unknown; importance?: unknown; direction?: unknown; meaning?: unknown; meaning_en?: unknown }[] }
        for (const r of answer.items ?? []) {
          const x = typeof r.i === 'number' ? batch[r.i] : undefined
          if (!x) continue
          const rules = ruleJudgement(x.article, x.holding.query)
          const importance = [0, 1, 2, 3].includes(Number(r.importance)) ? (Number(r.importance) as Judgement['importance']) : rules.importance
          const direction: Direction = r.direction === 'risk' || r.direction === 'opportunity' || r.direction === 'neutral' ? r.direction : rules.direction
          judged.set(key(x), { relevant: r.relevant === true, importance, direction, meaning: checkedMeaning(r.meaning, x.article, rules.meaning), meaningEn: checkedMeaning(r.meaning_en, x.article, rules.meaningEn, false), by: 'ai' })
        }
      } catch { /* this batch falls back to the rules below */ }
    })
    const done = work.finally(() => { for (const x of todo) inflight.delete(key(x)) })
    for (const x of todo) inflight.set(key(x), done)
    waiting.push(done)
  }
  const all = Promise.all(waiting)
  await (judgeWithinMs === undefined ? all : Promise.race([all, new Promise((r) => setTimeout(r, judgeWithinMs))]))
  return items.map((x) => judged.get(key(x)) ?? ruleJudgement(x.article, x.holding.query))
}

/** Relevant hits for these holdings, most important first. */
export async function newsHits(holdings: Holding[], now: Date, complete: Complete | null, search?: (q: string) => Promise<Article[]>, fresh: Freshness = {}) {
  const found = await candidates(holdings, now, search, fresh.maxAgeMs)
  const judgements = await judge(found, complete, fresh.judgeWithinMs)
  const hits: (Hit & { offline: boolean })[] = found.map((x, i) => ({ ...x, judgement: judgements[i] })).filter((h) => h.judgement.relevant && h.judgement.importance > 0)
  return hits.sort((a, b) => hitScore(b) - hitScore(a) || (b.article.published ?? '').localeCompare(a.article.published ?? ''))
}

// ---- turning hits into what the UI and the briefing read ------------------------------------------

/** Points for the outbound ranking: importance, scaled by how much of the portfolio it touches (full at 5%). */
export const hitScore = (h: Hit) => h.judgement.importance * Math.min(1, h.holding.weight / 0.05)

export function severityOf(j: Judgement): Severity {
  if (j.direction === 'risk') return j.importance >= 2 ? 'risk' : 'warn'
  return j.direction === 'opportunity' ? 'ok' : 'info'
}

export const pctText = (w: number) => `${(w * 100).toFixed(w < 0.01 ? 1 : 0)}%`

const timeText = (iso: string | undefined, now: Date) => {
  if (!iso) return ''
  const d = new Date(iso)
  const zurich = (x: Date) => x.toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })
  return zurich(d) === zurich(now) ? d.toLocaleTimeString('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' }) : zurich(d)
}

// Same shape as NewsItem in src/types.ts, plus url and offline.
export type NewsItemOut = {
  id: string; time: string; title: string; source: string; reach: 'Titel' | 'Sektor'; url?: string; published?: string; offline?: boolean
  affects: Record<string, { tag: string; position: string; meaning: string; severity: Severity; direction: Direction; importance: number }>
}

export function toNewsItems(ref: string, hits: (Hit & { offline?: boolean })[], now: Date, merge = new Map<string, NewsItemOut>(), lang?: Lang) {
  const t = pick(lang)
  for (const h of hits) {
    const a = h.article
    const item = merge.get(a.id) ?? { id: a.id, time: timeText(a.published, now), title: a.title, source: a.source, reach: h.holding.fund ? 'Sektor' : 'Titel', url: a.url || undefined, published: a.published, offline: h.offline || undefined, affects: {} }
    if (!item.affects[ref]) item.affects[ref] = {
      tag: `${h.holding.label} ${pctText(h.holding.weight)}`,
      position: `${h.holding.names[0]}, ${pctText(h.holding.weight)} ${t('des Portfolios', 'of the portfolio')}`,
      meaning: meaningOf(h.judgement, lang), severity: severityOf(h.judgement), direction: h.judgement.direction, importance: h.judgement.importance,
    }
    merge.set(a.id, item)
  }
  return merge
}

const SOURCE = (a: Article): Evidence => ({ source: a.source, ref: a.url || a.id, quote: a.title, date: a.published?.slice(0, 10) })

/** news.hit findings, plus the top risk/opportunity from the last days as a call reason (inbound banner). */
export function newsFindings(ref: string, hits: Hit[], lang?: Lang): Finding[] {
  const t = pick(lang)
  const share = (h: Hit) => `${pctText(h.holding.weight)} ${t('des Portfolios', 'of the portfolio')}`
  const out: Finding[] = hits.map((h) => ({
    id: `news.hit:${ref}:${h.article.id}`, check: 'news.hit', kind: 'fact', severity: severityOf(h.judgement),
    title: `${h.holding.label} (${share(h)}): ${h.article.title}`,
    detail: meaningOf(h.judgement, lang),
    numbers: { weight: h.holding.weight, importance: h.judgement.importance },
    evidence: [SOURCE(h.article), ...h.holding.names.map((n) => ({ source: sourceName('position', lang), quote: n }))],
    topic: 'news',
  }))
  const top = hits.find((h) => h.judgement.importance >= 2 && h.judgement.direction !== 'neutral')
  if (top) out.push({
    id: `profile.call-reason:${ref}:news:${top.article.id}`, check: 'profile.call-reason', kind: 'interpretation', severity: severityOf(top.judgement),
    title: `${t('Meldung zu', 'News on')} ${top.holding.label} (${share(top)}): ${top.article.title}`,
    detail: meaningOf(top.judgement, lang),
    numbers: { score: 2 + top.judgement.importance, weight: top.holding.weight },
    evidence: [SOURCE(top.article)],
    topic: 'call-reason',
  })
  return out
}
