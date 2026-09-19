// profile.call-reason — the most likely reasons the client calls now, ranked: an open draft proposal, a bond that repays
// soon, a recent note with an open wish, a proposal decided in the last weeks, a weak last month. Each is a guess
// (interpretation) with its source; the ranking score is ours and goes in numbers.
import { combinedHistory, daysBetween } from '../data.ts'
import { dateCh, monthCh, shortName, signedPct } from '../format.ts'
import { pick, sourceName } from '../lang.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { findingId, srcOf } from './common.ts'
import { performanceStats } from './portfolio-performance.ts'
import { ACCEPTED, BAD_MONTH, gistOf, noteEvidence, proposalDate, proposalEvidence, REJECTED, signalsOf } from './profile-signals.ts'
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
// English: the data's own value (ProposalReason is English already).
const reasonEn = (r: string | undefined) => r?.trim() || 'no reason given'

export const callReason: Check = (raw, ctx) => {
  const s = signalsOf(raw, ctx)
  const { lang } = ctx
  const t = pick(lang)
  const SRC = srcOf(lang)
  const c = s.client
  const now = ctx.now
  const reasons: Reason[] = []
  const ago = (iso: string | undefined) => (iso ? daysBetween(iso, now) : undefined)

  // Open draft proposal: the client may have received it or be waiting for it.
  s.proposals.drafts.forEach((p, i) => {
    const d = proposalDate(p)
    reasons.push({
      subject: `draft:${p.id ?? `idx${i}`}`, score: 3, date: d,
      title: t(
        `Rückfrage zum offenen Vorschlag «${reasonDe(p.reason)}»${d ? ` vom ${dateCh(d)}` : ''}`,
        `Question about the open proposal «${reasonEn(p.reason)}»${d ? ` of ${dateCh(d)}` : ''}`,
      ),
      evidence: [proposalEvidence(p, lang)],
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
        ? t(`Obligation ${shortName(soon[0].pos.name)} wird am ${dateCh(soon[0].date)} fällig: Wiederanlage`, `Bond ${shortName(soon[0].pos.name)} matures on ${dateCh(soon[0].date)}: reinvestment`)
        : t(`${soon.length} Obligationen werden bis ${dateCh(soon[soon.length - 1].date)} fällig: Wiederanlage`, `${soon.length} bonds mature by ${dateCh(soon[soon.length - 1].date)}: reinvestment`),
      evidence: [SRC.portfolio(p.nr), ...soon.map((x) => SRC.security(x.pos.name))],
      numbers: { count: soon.length, daysToFirst: soon[0].days, share: soon.reduce((a, x) => a + x.pos.weight, 0) },
    })
  }

  // A recent note with an open wish or plan.
  s.notes.forEach((n, i) => {
    const days = ago(n.date)
    if (days === undefined || days < 0 || days > NOTE_DAYS) return
    if (n.signals.includes('ask')) {
      reasons.push({ subject: `note:${n.date}:${i}`, score: days <= 30 ? 3 : 2, date: n.date, title: t(`Anliegen aus der Notiz vom ${dateCh(n.date)}: ${n.gist}`, `Request from the note of ${dateCh(n.date)}: ${gistOf(n, 'en')}`), evidence: [noteEvidence(n, lang)], numbers: { daysAgo: days } })
    } else if (!n.known && days <= 30) {
      // Unknown wording: not quoted (it may hold names), only pointed to.
      reasons.push({ subject: `note:${n.date}:${i}`, score: 1, date: n.date, title: t(`Neue Kundennotiz vom ${dateCh(n.date)}: vor dem Gespräch lesen`, `New client note of ${dateCh(n.date)}: read it before the call`), evidence: [{ source: sourceName('note', lang), date: n.date }], numbers: { daysAgo: days } })
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
        ? t(
          `Hat am ${dateCh(d)} schon angerufen (Vorschlag ${p.status === ACCEPTED ? 'angenommen' : 'abgelehnt'}): Nachfrage wahrscheinlich`,
          `Already called on ${dateCh(d)} (proposal ${p.status === ACCEPTED ? 'accepted' : 'rejected'}): a follow-up question is likely`,
        )
        : t(
          `Nachfrage zum Vorschlag «${reasonDe(p.reason)}» vom ${dateCh(d)} (${p.status === ACCEPTED ? 'angenommen, Umsetzung' : 'abgelehnt'})`,
          `Follow-up on the proposal «${reasonEn(p.reason)}» of ${dateCh(d)} (${p.status === ACCEPTED ? 'accepted, being carried out' : 'rejected'})`,
        ),
      evidence: [proposalEvidence(p, lang)], numbers: { daysAgo: days },
    })
  }

  // A weak last month or quarter on the total.
  const stats = performanceStats(combinedHistory(c.portfolios))
  if (stats) {
    const month = stats.lastMonth !== undefined && stats.lastMonth <= BAD_MONTH
    const quarter = stats.threeMonths !== undefined && stats.threeMonths <= THREE_MONTH_DROP
    if (month || quarter) {
      const reacts = traitsOf(s, lang).some((x) => x.key === 'loss-reacts')
      const numbers: Record<string, number> = {}
      if (stats.lastMonth !== undefined) numbers.lastMonth = stats.lastMonth
      if (stats.threeMonths !== undefined) numbers.threeMonths = stats.threeMonths
      reasons.push({
        subject: 'performance', score: reacts ? 3 : 2, date: stats.asOf,
        title: month
          ? t(`Wertrückgang im letzten Monat (${signedPct(stats.lastMonth!)}, Stand ${monthCh(stats.asOf)})`, `Portfolio value fell last month (${signedPct(stats.lastMonth!)}, as of ${monthCh(stats.asOf, 'en')})`)
          : t(`Wertrückgang über 3 Monate (${signedPct(stats.threeMonths!)}, Stand ${monthCh(stats.asOf)})`, `Portfolio value fell over 3 months (${signedPct(stats.threeMonths!)}, as of ${monthCh(stats.asOf, 'en')})`),
        detail: t(
          `Aus Monatswerten, nicht um Ein- und Auszahlungen bereinigt.${reacts ? ' Reagiert erfahrungsgemäss eher auf Verluste.' : ''}`,
          `From monthly values, not adjusted for deposits and withdrawals.${reacts ? ' Past behaviour suggests this client tends to react to losses.' : ''}`,
        ),
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
