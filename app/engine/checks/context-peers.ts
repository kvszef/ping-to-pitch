// context.peers — was last month's move market-wide or specific to this portfolio? Compares the client's return
// with clients of the same risk profile (ctx.peers, computed once by the caller; all clients when it has no profile).
// Aggregates only: no other client is named or referenced anywhere in the finding.
import { combinedHistory } from '../data.ts'
import { monthCh, signedPct } from '../format.ts'
import { pick, sourceName } from '../lang.ts'
import type { Check, Finding } from '../types.ts'
import { clientOf, findingId, srcOf } from './common.ts'
import { performanceStats } from './portfolio-performance.ts'

const CHECK = 'context.peers'
// Worse than the peer median by 3 percentage points in one month is more than market noise for similar mandates.
// Our judgement, not a bank rule.
const WORSE_BY = 0.03
const MIN_PEERS = 3

export const peers: Check = (raw, ctx) => {
  if (!ctx.peers) return []
  const client = clientOf(raw, ctx.ref)
  const lang = ctx.lang, t = pick(lang)
  const stats = performanceStats(combinedHistory(client.portfolios))
  if (!stats || stats.lastMonth === undefined || stats.asOf !== ctx.peers.asOf) return []
  const group = ctx.peers.of(client.ref, client.riskProfileId)
  const month = group.lastMonth
  if (!month || month.n < MIN_PEERS) return []

  const level = ctx.ref.riskProfile(client.riskProfileId)?.level
  const profile = level ?? client.riskProfileName ?? group.riskProfileId
  const who = group.riskProfileId === undefined ? t(`alle Kunden, n=${month.n}`, `all clients, n=${month.n}`) : t(`Profil ${profile}, n=${month.n}`, `profile ${profile}, n=${month.n}`)
  const diff = stats.lastMonth - month.median
  const verdict = diff <= -WORSE_BY ? t('schwächer als vergleichbare Kunden', 'weaker than comparable clients')
    : diff >= WORSE_BY ? t('besser als vergleichbare Kunden', 'better than comparable clients')
      : stats.lastMonth < month.p25 ? t('grösstenteils marktweit, Portfolio etwas stärker betroffen als die meisten', 'largely market-wide, portfolio hit somewhat harder than most')
        : stats.lastMonth > month.p75 ? t('grösstenteils marktweit, Portfolio etwas besser als die meisten', 'largely market-wide, portfolio somewhat better than most')
          : t('marktweit, nicht portfoliospezifisch', 'market-wide, not specific to this portfolio')

  const numbers: Record<string, number> = {
    lastMonth: stats.lastMonth, peerMedian: month.median, peerP25: month.p25, peerP75: month.p75, peerN: month.n, diff,
  }
  const detail = [t(
    `${monthCh(stats.asOf)}. Mittlere Hälfte der Vergleichsgruppe: ${signedPct(month.p25)} bis ${signedPct(month.p75)}.`,
    `${monthCh(stats.asOf, lang)}. Middle half of the peer group: ${signedPct(month.p25)} to ${signedPct(month.p75)}.`,
  )]
  const year = group.twelveMonths
  if (stats.twelveMonths !== undefined && year && year.n >= MIN_PEERS) {
    numbers.twelveMonths = stats.twelveMonths
    numbers.peerMedian12 = year.median
    detail.push(t(`12 Monate: ${signedPct(stats.twelveMonths)}, Median der Gruppe ${signedPct(year.median)}.`, `12 months: ${signedPct(stats.twelveMonths)}, group median ${signedPct(year.median)}.`))
  }
  detail.push(t(
    'Nur Kennzahlen der Gruppe, kein anderer Kunde wird genannt. Aus Monatswerten, nicht um Ein- und Auszahlungen bereinigt.',
    'Only figures of the group, no other client is named. From monthly values, not adjusted for deposits and withdrawals.',
  ))

  const f: Finding = {
    id: findingId(CHECK, client.ref, 'total'), check: CHECK, kind: 'interpretation', topic: 'performance',
    severity: diff <= -WORSE_BY ? 'warn' : 'info',
    title: t(
      `Letzter Monat ${signedPct(stats.lastMonth)}, ähnliche Kunden (${who}): Median ${signedPct(month.median)}: ${verdict}`,
      `Last month ${signedPct(stats.lastMonth)}, similar clients (${who}): median ${signedPct(month.median)}: ${verdict}`,
    ),
    detail: detail.join(' '), numbers,
    evidence: [
      srcOf(lang).history(client.portfolios.map((p) => p.nr).join(', '), stats.asOf),
      { source: sourceName('peers', lang), quote: `${who}, ${t('Median', 'median')} ${signedPct(month.median)}`, date: stats.asOf },
    ],
  }
  return [f]
}
