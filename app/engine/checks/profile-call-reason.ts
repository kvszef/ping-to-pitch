// profile.call-reason — the most likely reasons the client calls now, ranked: an open draft proposal, a bond that repays
// soon, a recent note with an open wish, a proposal decided in the last weeks, a weak last month. Each is a guess
// (interpretation) with its source; the ranking score is ours and goes in numbers.
import { combinedHistory, daysBetween } from '../data.ts'
import { dateCh, monthCh, shortName, signedPct } from '../format.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { findingId, SRC } from './common.ts'
import { performanceStats } from './portfolio-performance.ts'
import { ACCEPTED, BAD_MONTH, noteEvidence, proposalDate, proposalEvidence, REJECTED, signalsOf } from './profile-signals.ts'
import { traitsOf } from './profile-traits.ts'

const CHECK = 'profile.call-reason'
const TOPIC = 'call-reason'
const MAX_REASONS = 3
// Windows are our judgement: what a client still has in mind when picking up the phone.
const MATURITY_DAYS = 60
const NOTE_DAYS = 60
const PROPOSAL_DAYS = 30
const THREE_MONTH_DROP = -0.05
const PERPETUAL_FROM_YEAR = 2200

type Reason = { subject: string; score: number; date?: string; title: string; detail?: string; evidence: Evidence[]; numbers?: Record<string, number> }

const REASON_DE: Record<string, string> = {
  'Annual review meeting': 'Jahresgespräch', 'Change of investment strategy': 'Wechsel der Anlagestrategie', 'Change of risk tolerance': 'Geänderte Risikobereitschaft',
  'Client called': 'Anruf des Kunden', 'Client relocation': 'Umzug des Kunden', 'Estate planning discussion': 'Nachlassplanung',
  'Follow-up from prior meeting': 'Nachbereitung des letzten Gesprächs', 'Life event (retirement)': 'Lebensereignis (Pensionierung)',
  'Market volatility follow-up': 'Nachfassen nach Marktschwankungen', 'New deposit received': 'Neue Einzahlung', 'Periodic portfolio review': 'Periodische Portfolioüberprüfung',
  'Portfolio rebalancing': 'Rebalancing des Portfolios', 'Risk profile update': 'Aktualisierung des Risikoprofils', 'Tax year-end rebalancing': 'Steueroptimierung zum Jahresende',
  'Withdrawal request': 'Auszahlungswunsch',
}
const reasonDe = (r: string | undefined) => (r ? REASON_DE[r] ?? r : 'ohne Anlass')

export const callReason: Check = (raw, ctx) => {
  const s = signalsOf(raw, ctx)
  const c = s.client
  const now = ctx.now
  const reasons: Reason[] = []
  const ago = (iso: string | undefined) => (iso ? daysBetween(iso, now) : undefined)

  // Open draft proposal: the client may have received it or be waiting for it.
  s.proposals.drafts.forEach((p, i) => {
    const d = proposalDate(p)
    reasons.push({
      subject: `draft:${p.id ?? `idx${i}`}`, score: 3, date: d,
      title: `Rückfrage zum offenen Vorschlag «${reasonDe(p.reason)}»${d ? ` vom ${dateCh(d)}` : ''}`,
      evidence: [proposalEvidence(p)],
    })
  })

  // Bonds that repay soon: the money needs a new home.
  for (const p of c.portfolios) {
    const soon = p.positions.flatMap((pos) => {
      const m = pos.kind === 'security' ? pos.security?.maturity : undefined
      if (!m || !/^\d{4}-\d{2}-\d{2}/.test(m) || Number(m.slice(0, 4)) >= PERPETUAL_FROM_YEAR || pos.amount <= 0) return []
      const days = daysBetween(now, m.slice(0, 10))
      return Number.isFinite(days) && days >= 0 && days <= MATURITY_DAYS ? [{ pos, days, date: m.slice(0, 10) }] : []
    }).sort((a, b) => a.days - b.days)
    if (!soon.length) continue
    reasons.push({
      subject: `maturity:${p.nr}`, score: soon[0].days <= 30 ? 3 : 2, date: soon[0].date,
      title: soon.length === 1
        ? `Obligation ${shortName(soon[0].pos.name)} wird am ${dateCh(soon[0].date)} fällig: Wiederanlage`
        : `${soon.length} Obligationen werden bis ${dateCh(soon[soon.length - 1].date)} fällig: Wiederanlage`,
      evidence: [SRC.portfolio(p.nr), ...soon.map((x) => SRC.security(x.pos.name))],
      numbers: { count: soon.length, daysToFirst: soon[0].days, share: soon.reduce((a, x) => a + x.pos.weight, 0) },
    })
  }

  // A recent note with an open wish or plan.
  s.notes.forEach((n, i) => {
    const days = ago(n.date)
    if (days === undefined || days < 0 || days > NOTE_DAYS) return
    if (n.signals.includes('ask')) {
      reasons.push({ subject: `note:${n.date}:${i}`, score: days <= 30 ? 3 : 2, date: n.date, title: `Anliegen aus der Notiz vom ${dateCh(n.date)}: ${n.gist}`, evidence: [noteEvidence(n)], numbers: { daysAgo: days } })
    } else if (!n.known && days <= 30) {
      // Unknown wording: not quoted (it may hold names), only pointed to.
      reasons.push({ subject: `note:${n.date}:${i}`, score: 1, date: n.date, title: `Neue Kundennotiz vom ${dateCh(n.date)}: vor dem Gespräch lesen`, evidence: [{ source: 'Kundennotiz', date: n.date }], numbers: { daysAgo: days } })
    }
  })

  // A proposal decided in the last weeks: questions about the execution or the rejection.
  for (const p of s.proposals.all) {
    const d = proposalDate(p)
    const days = ago(d)
    if (days === undefined || days < 0 || days > PROPOSAL_DAYS || (p.status !== ACCEPTED && p.status !== REJECTED)) continue
    const called = p.reason === 'Client called'
    reasons.push({
      subject: `proposal:${p.id ?? d}`, score: 2, date: d,
      title: called
        ? `Hat am ${dateCh(d)} schon angerufen (Vorschlag ${p.status === ACCEPTED ? 'angenommen' : 'abgelehnt'}): Nachfrage wahrscheinlich`
        : `Nachfrage zum Vorschlag «${reasonDe(p.reason)}» vom ${dateCh(d)} (${p.status === ACCEPTED ? 'angenommen, Umsetzung' : 'abgelehnt'})`,
      evidence: [proposalEvidence(p)], numbers: { daysAgo: days },
    })
  }

  // A weak last month or quarter on the total.
  const stats = performanceStats(combinedHistory(c.portfolios))
  if (stats) {
    const month = stats.lastMonth !== undefined && stats.lastMonth <= BAD_MONTH
    const quarter = stats.threeMonths !== undefined && stats.threeMonths <= THREE_MONTH_DROP
    if (month || quarter) {
      const reacts = traitsOf(s).some((t) => t.key === 'loss-reacts')
      const numbers: Record<string, number> = {}
      if (stats.lastMonth !== undefined) numbers.lastMonth = stats.lastMonth
      if (stats.threeMonths !== undefined) numbers.threeMonths = stats.threeMonths
      reasons.push({
        subject: 'performance', score: reacts ? 3 : 2, date: stats.asOf,
        title: month ? `Wertrückgang im letzten Monat (${signedPct(stats.lastMonth!)}, Stand ${monthCh(stats.asOf)})` : `Wertrückgang über 3 Monate (${signedPct(stats.threeMonths!)}, Stand ${monthCh(stats.asOf)})`,
        detail: `Aus Monatswerten, nicht um Ein- und Auszahlungen bereinigt.${reacts ? ' Reagiert erfahrungsgemäss eher auf Verluste.' : ''}`,
        evidence: [SRC.history(c.portfolios.map((p) => p.nr).join(', '), stats.asOf)], numbers,
      })
    }
  }

  reasons.sort((a, b) => b.score - a.score || (b.date ?? '').localeCompare(a.date ?? ''))
  return reasons.slice(0, MAX_REASONS).map((r, i): Finding => ({
    id: findingId(CHECK, c.ref, r.subject), check: CHECK, kind: 'interpretation', severity: 'info', topic: TOPIC,
    title: r.title, detail: r.detail, numbers: { ...r.numbers, rank: i + 1, score: r.score }, evidence: r.evidence,
  }))
}
