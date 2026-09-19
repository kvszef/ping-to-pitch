// portfolio.performance — returns from the monthly value history, per portfolio and for the client total.
// PerformanceYTD is absent on every portfolio in the case data, so all returns are computed from PerformanceHistory.
// The month values are not adjusted for deposits or withdrawals (CASE-037 got a CHF 1M deposit), and every finding says so.
import { combinedHistory, type NavPoint } from '../data.ts'
import { monthCh, signedPct } from '../format.ts'
import { pick, type Lang } from '../lang.ts'
import type { Check, Finding } from '../types.ts'
import { clientOf, findingId, srcOf } from './common.ts'

const CHECK = 'portfolio.performance'
// A monthly drop of 3% or more is the kind of move a client notices on a statement and asks about. Our judgement, not a bank rule.
const LIKELY_QUESTION_DROP = -0.03
const NOT_ADJUSTED = 'Aus Monatswerten, nicht um Ein- und Auszahlungen bereinigt.'
const NOT_ADJUSTED_EN = 'From monthly values, not adjusted for deposits and withdrawals.'

// yyyy-MM-01 of the month `k` months before `iso`.
const monthsBack = (iso: string, k: number) => {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1 - k
  const d = new Date(Date.UTC(y, m, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export type PerformanceStats = {
  asOf: string; value: number
  lastMonth?: number; threeMonths?: number; twelveMonths?: number; ytd?: number
  worstMonth?: { date: string; value: number } // worst single month within the last 12 months
  maxDrawdown?: { value: number; peak: string; trough: string } // over the whole history, peak to trough
}

export function performanceStats(history: NavPoint[]): PerformanceStats | undefined {
  if (history.length < 2) return undefined
  const byDate = new Map(history.map((h) => [h.date, h.value]))
  const last = history[history.length - 1]
  const back = (k: number) => {
    const base = byDate.get(monthsBack(last.date, k))
    return base ? last.value / base - 1 : undefined
  }
  const janFirst = byDate.get(`${last.date.slice(0, 4)}-01-01`)
  const stats: PerformanceStats = {
    asOf: last.date, value: last.value,
    lastMonth: back(1), threeMonths: back(3), twelveMonths: back(12),
    // Base is the value dated Jan 1 of the last point's year; in January the base is the last point itself, so no YTD.
    ytd: janFirst && last.date.slice(5, 7) !== '01' ? last.value / janFirst - 1 : undefined,
  }

  const firstOfWindow = monthsBack(last.date, 12)
  for (let i = 1; i < history.length; i++) {
    const cur = history[i], prev = history[i - 1]
    if (cur.date <= firstOfWindow || monthsBack(cur.date, 1) !== prev.date) continue
    const r = cur.value / prev.value - 1
    if (!stats.worstMonth || r < stats.worstMonth.value) stats.worstMonth = { date: cur.date, value: r }
  }

  let peak = history[0]
  for (const h of history) {
    if (h.value > peak.value) peak = h
    const dd = h.value / peak.value - 1
    if (dd < 0 && (!stats.maxDrawdown || dd < stats.maxDrawdown.value)) stats.maxDrawdown = { value: dd, peak: peak.date, trough: h.date }
  }
  return stats
}

function finding(clientRef: string, subject: string, label: string, stats: PerformanceStats, evidenceRef: string, lang?: Lang): Finding {
  const t = pick(lang)
  const month = (iso: string) => monthCh(iso, lang)
  const parts: string[] = []
  if (stats.lastMonth !== undefined) parts.push(`${signedPct(stats.lastMonth)} ${t('im letzten Monat', 'last month')}`)
  if (stats.twelveMonths !== undefined) parts.push(`${signedPct(stats.twelveMonths)} ${t('über 12 Monate', 'over 12 months')}`)
  if (!parts.length && stats.threeMonths !== undefined) parts.push(`${signedPct(stats.threeMonths)} ${t('über 3 Monate', 'over 3 months')}`)

  const detail: string[] = [`${t('Stand', 'As of')}: ${month(stats.asOf)}.`]
  if (stats.threeMonths !== undefined) detail.push(`${t('3 Monate', '3 months')}: ${signedPct(stats.threeMonths)}.`)
  if (stats.ytd !== undefined) detail.push(`${t('Seit Jahresbeginn', 'Year to date')}: ${signedPct(stats.ytd)}.`)
  if (stats.worstMonth) detail.push(t(
    `Schwächster Monat der letzten 12: ${month(stats.worstMonth.date)} mit ${signedPct(stats.worstMonth.value)}.`,
    `Weakest month of the last 12: ${month(stats.worstMonth.date)} with ${signedPct(stats.worstMonth.value)}.`,
  ))
  if (stats.maxDrawdown) detail.push(t(
    `Grösster Rückgang (Höchst- bis Tiefstwert): ${signedPct(stats.maxDrawdown.value)}, ${month(stats.maxDrawdown.peak)} bis ${month(stats.maxDrawdown.trough)}.`,
    `Largest drop (peak to trough): ${signedPct(stats.maxDrawdown.value)}, ${month(stats.maxDrawdown.peak)} to ${month(stats.maxDrawdown.trough)}.`,
  ))
  detail.push(t(NOT_ADJUSTED, NOT_ADJUSTED_EN))

  const numbers: Record<string, number> = { value: stats.value }
  if (stats.lastMonth !== undefined) numbers.lastMonth = stats.lastMonth
  if (stats.threeMonths !== undefined) numbers.threeMonths = stats.threeMonths
  if (stats.twelveMonths !== undefined) numbers.twelveMonths = stats.twelveMonths
  if (stats.ytd !== undefined) numbers.ytd = stats.ytd
  if (stats.worstMonth) numbers.worstMonth = stats.worstMonth.value
  if (stats.maxDrawdown) numbers.maxDrawdown = stats.maxDrawdown.value

  return {
    id: findingId(CHECK, clientRef, subject), check: CHECK, kind: 'fact', topic: 'performance',
    severity: stats.lastMonth !== undefined && stats.lastMonth <= LIKELY_QUESTION_DROP ? 'warn' : 'info',
    title: `${label}: ${parts.join(', ') || `${t('Wert per', 'Value as of')} ${month(stats.asOf)}`}`,
    detail: detail.join(' '), numbers,
    evidence: [srcOf(lang).history(evidenceRef, stats.asOf)],
  }
}

export const performance: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const out: Finding[] = []
  for (const p of client.portfolios) {
    const stats = performanceStats(p.history)
    if (stats) out.push(finding(client.ref, p.nr, p.nr, stats, p.nr, ctx.lang))
  }
  if (client.portfolios.length > 1) {
    const stats = performanceStats(combinedHistory(client.portfolios))
    if (stats) out.push(finding(client.ref, 'total', pick(ctx.lang)('Gesamtvermögen', 'Total wealth'), stats, client.portfolios.map((p) => p.nr).join(', '), ctx.lang))
  }
  return out
}
