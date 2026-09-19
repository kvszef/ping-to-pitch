// context.peers — was last month's move market-wide or specific to this portfolio? Compares the client's return
// with clients of the same risk profile (ctx.peers, computed once by the caller; all clients when it has no profile).
// Aggregates only: no other client is named or referenced anywhere in the finding.
import { combinedHistory } from '../data.ts'
import { monthCh, signedPct } from '../format.ts'
import type { Check, Finding } from '../types.ts'
import { SRC, clientOf, findingId } from './common.ts'
import { performanceStats } from './portfolio-performance.ts'

const CHECK = 'context.peers'
// Worse than the peer median by 3 percentage points in one month is more than market noise for similar mandates.
// Our judgement, not a bank rule.
const WORSE_BY = 0.03
const MIN_PEERS = 3

export const peers: Check = (raw, ctx) => {
  if (!ctx.peers) return []
  const client = clientOf(raw, ctx.ref)
  const stats = performanceStats(combinedHistory(client.portfolios))
  if (!stats || stats.lastMonth === undefined || stats.asOf !== ctx.peers.asOf) return []
  const group = ctx.peers.of(client.ref, client.riskProfileId)
  const month = group.lastMonth
  if (!month || month.n < MIN_PEERS) return []

  const level = ctx.ref.riskProfile(client.riskProfileId)?.level
  const who = group.riskProfileId === undefined ? `alle Kunden, n=${month.n}` : `Profil ${level ?? client.riskProfileName ?? group.riskProfileId}, n=${month.n}`
  const diff = stats.lastMonth - month.median
  const verdict = diff <= -WORSE_BY ? 'schwächer als vergleichbare Kunden'
    : diff >= WORSE_BY ? 'besser als vergleichbare Kunden'
      : stats.lastMonth < month.p25 ? 'grösstenteils marktweit, Portfolio etwas stärker betroffen als die meisten'
        : stats.lastMonth > month.p75 ? 'grösstenteils marktweit, Portfolio etwas besser als die meisten'
          : 'marktweit, nicht portfoliospezifisch'

  const numbers: Record<string, number> = {
    lastMonth: stats.lastMonth, peerMedian: month.median, peerP25: month.p25, peerP75: month.p75, peerN: month.n, diff,
  }
  const detail = [`${monthCh(stats.asOf)}. Mittlere Hälfte der Vergleichsgruppe: ${signedPct(month.p25)} bis ${signedPct(month.p75)}.`]
  const year = group.twelveMonths
  if (stats.twelveMonths !== undefined && year && year.n >= MIN_PEERS) {
    numbers.twelveMonths = stats.twelveMonths
    numbers.peerMedian12 = year.median
    detail.push(`12 Monate: ${signedPct(stats.twelveMonths)}, Median der Gruppe ${signedPct(year.median)}.`)
  }
  detail.push('Nur Kennzahlen der Gruppe, kein anderer Kunde wird genannt. Aus Monatswerten, nicht um Ein- und Auszahlungen bereinigt.')

  const f: Finding = {
    id: findingId(CHECK, client.ref, 'total'), check: CHECK, kind: 'interpretation', topic: 'performance',
    severity: diff <= -WORSE_BY ? 'warn' : 'info',
    title: `Letzter Monat ${signedPct(stats.lastMonth)}, ähnliche Kunden (${who}): Median ${signedPct(month.median)}: ${verdict}`,
    detail: detail.join(' '), numbers,
    evidence: [
      SRC.history(client.portfolios.map((p) => p.nr).join(', '), stats.asOf),
      { source: 'Vergleichsgruppe (aggregiert)', quote: `${who}, Median ${signedPct(month.median)}`, date: stats.asOf },
    ],
  }
  return [f]
}
