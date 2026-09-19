import { pick, type Lang } from '../../engine/lang.ts'
import type { Finding, Severity } from '../../engine/types.ts'

// Who to call today: how a client's reasons are weighed. News is the trigger, the client's own file is
// the substance: what the engine found in the portfolio and the notes must be able to outweigh a
// headline that ten other clients share. Pure, so the expected order is pinned by tests on the real
// clients (score.test.ts). Every reason is an engine finding or a news hit: nothing is phrased here
// beyond counting findings of the same kind into one line.

export type Reason = { kind: 'risk' | 'opportunity'; title: string; severity: Severity; findingId?: string; newsId?: string; url?: string; points: number }

// News: the best stories only, each dampened by how many clients share the same article.
export const MAX_NEWS = 2
export const MAX_NEWS_POINTS = 4
export const newsPoints = (hitScore: number, sharedBy: number) => Math.round((hitScore / Math.sqrt(Math.max(1, sharedBy))) * 10) / 10

const bare = (title: string) => title.replace(/^CASE-[\w-]+:\s*/, '')
const cap = (n: number, max: number) => Math.round(Math.min(max, n) * 10) / 10

type Group = { match: (f: Finding) => boolean; points: (list: Finding[]) => number; title?: (list: Finding[], lang: Lang) => string }

const more = (list: Finding[], lang: Lang, de: string, en: string) =>
  list.length > 1 ? `${list.length} ${pick(lang)(de, en)}: ${bare(list[0].title)}${pick(lang)(`, dazu ${list.length - 1} weitere`, `, plus ${list.length - 1} more`)}` : bare(list[0].title)

// One line per kind of finding, most serious kinds first. Points are per client, not per finding, so
// forty sector deviations do not bury one missed tax payment.
const GROUPS: Group[] = [
  // Cash is short of a payment the client announced.
  { match: (f) => f.check === 'portfolio.liquidity' && f.severity !== 'info' && f.severity !== 'ok', points: () => 3 },
  // A promise from an earlier call is due.
  { match: (f) => f.check.startsWith('memory.') && (f.severity === 'risk' || f.severity === 'warn'), points: () => 2.5 },
  // The bank's own suitability check fails: 1.2 per breach.
  { match: (f) => f.check === 'portfolio.violations' && f.severity === 'risk', points: (l) => cap(1.2 * l.length, 5), title: (l, lang) => more(l, lang, 'Regelverletzungen', 'rule breaches') },
  // The portfolio contradicts something the client asked for.
  { match: (f) => f.check.startsWith('contradiction.') && f.severity === 'risk', points: (l) => cap(2 * l.length, 3) },
  // An asset class outside its band (numbers.limit), e.g. all cash.
  { match: (f) => f.check === 'portfolio.allocation' && f.severity === 'risk' && f.numbers?.limit !== undefined, points: (l) => cap(2 * l.length, 3) },
  { match: (f) => f.check === 'portfolio.risk' && f.severity === 'risk', points: () => 1.5 },
  { match: (f) => f.check === 'portfolio.concentration' && f.severity === 'risk', points: () => 1.5 },
  // A month the client will have noticed: 1 point from −5%, 2 points from −10%.
  { match: (f) => f.check === 'portfolio.performance' && (f.numbers?.lastMonth ?? 0) <= -0.05, points: (l) => cap(Math.abs(l[0].numbers!.lastMonth) * 20, 2) },
  { match: (f) => f.check === 'portfolio.maturities' && f.kind === 'action', points: () => 1 },
  { match: (f) => f.check === 'portfolio.proposals' && f.severity === 'warn' && f.kind === 'action', points: () => 1 },
  { match: (f) => f.check === 'context.stale-note', points: () => 1 },
  // Deviations from the model portfolio (regions, sectors): many per client, rarely a reason on their own.
  { match: (f) => f.check === 'portfolio.allocation' && f.severity === 'risk' && f.numbers?.limit === undefined, points: () => 0.5, title: (l, lang) => more(l, lang, 'Abweichungen vom Modellportfolio', 'deviations from the model portfolio') },
]

/** The client's own reasons to be called, one per kind of finding. */
export function engineReasons(findings: Finding[], lang: Lang = 'en'): Reason[] {
  const out: Reason[] = []
  const taken = new Set<string>()
  for (const g of GROUPS) {
    const list = findings.filter((f) => !taken.has(f.id) && g.match(f))
    if (!list.length) continue
    list.forEach((f) => taken.add(f.id))
    const points = g.points(list)
    if (points > 0) out.push({ kind: 'risk', severity: list[0].severity, title: g.title ? g.title(list, lang) : bare(list[0].title), findingId: list[0].id, points })
  }
  return out
}

/** News (already scored with newsPoints), the engine's reasons and the house view become one ranked list and a score. */
export function weigh(news: Reason[], engine: Reason[], houseView: Reason[] = []): { score: number; reasons: Reason[] } {
  const stories = [...news].sort((a, b) => b.points - a.points).slice(0, MAX_NEWS)
  const total = stories.reduce((s, r) => s + r.points, 0)
  const scale = total > MAX_NEWS_POINTS ? MAX_NEWS_POINTS / total : 1
  const capped = stories.map((r) => ({ ...r, points: Math.round(r.points * scale * 10) / 10 }))
  // Same points: the client's own file before the house view before a headline.
  const order = new Map<Reason, number>([...engine.map((r) => [r, 0] as const), ...houseView.map((r) => [r, 1] as const), ...capped.map((r) => [r, 2] as const)])
  const reasons = [...order.keys()].sort((a, b) => b.points - a.points || order.get(a)! - order.get(b)!)
  return { score: Math.round(reasons.reduce((s, r) => s + r.points, 0) * 10) / 10, reasons }
}
