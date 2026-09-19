// portfolio.proposals — open drafts, drafts that repeat a rejected idea, the rejected history and the acceptance ratio.
import type { Proposal } from '../data.ts'
import { dateCh, pct, shortName } from '../format.ts'
import { pick, prefix, rejectedTitle, type Lang } from '../lang.ts'
import type { Check, Finding } from '../types.ts'
import { clientOf, findingId, srcOf } from './common.ts'

const CHECK = 'portfolio.proposals'
const TOPIC = 'proposals'
// ProposalStatusName values in clients.json (reference.json → ProposalStatuses).
const ACCEPTED = 'Final', REJECTED = 'Abgelehnt', DRAFT = 'Entwurf'
// A draft resembles a rejected proposal when at least half its securities were in it (judgement call). Proposals list the
// whole target portfolio, not only the trades, so overlap is common: this is context for the advisor, not a warning.
const REPEAT_OVERLAP = 0.5
// Securities named in a title: enough to recognise the proposal, short enough for one line.
const TOP_SECURITIES = 3
// Rejected proposals listed in the summary ("do not bring up again").
const RECENT_REJECTED = 3
// The acceptance ratio says little below this many decided proposals.
const MIN_DECIDED = 3

// Reason texts in clients.json are English and a finite set (15 values): translated here, unknown ones pass through.
// The English run shows the data's own text.
const REASON_DE: Record<string, string> = {
  'Annual review meeting': 'Jahresgespräch', 'Change of investment strategy': 'Wechsel der Anlagestrategie', 'Change of risk tolerance': 'Geänderte Risikobereitschaft',
  'Client called': 'Anruf des Kunden', 'Client relocation': 'Umzug des Kunden', 'Estate planning discussion': 'Nachlassplanung',
  'Follow-up from prior meeting': 'Nachbereitung des letzten Gesprächs', 'Life event (retirement)': 'Lebensereignis (Pensionierung)',
  'Market volatility follow-up': 'Nachfassen nach Marktschwankungen', 'New deposit received': 'Neue Einzahlung', 'Periodic portfolio review': 'Periodische Portfolioüberprüfung',
  'Portfolio rebalancing': 'Rebalancing des Portfolios', 'Risk profile update': 'Aktualisierung des Risikoprofils', 'Tax year-end rebalancing': 'Steueroptimierung zum Jahresende',
  'Withdrawal request': 'Auszahlungswunsch',
}
const reasonDe = (p: Proposal, lang?: Lang) => (lang === 'en' ? p.reason ?? 'no reason given' : p.reason ? REASON_DE[p.reason] ?? p.reason : 'ohne Anlass')
const dateOf = (p: Proposal) => p.proposed ?? p.finalized ?? p.submitted
const vom = (p: Proposal, lang?: Lang) => (dateOf(p) ? ` ${lang === 'en' ? 'of' : 'vom'} ${dateCh(dateOf(p), lang)}` : '')
const keyOf = (s: Proposal['securities'][number]) => s.isin ?? s.name
const subject = (p: Proposal, i: number) => (p.id !== undefined ? String(p.id) : `idx${i}`)

const topSecurities = (p: Proposal) =>
  [...p.securities].sort((a, b) => (b.weight ?? b.amount ?? 0) - (a.weight ?? a.amount ?? 0)).slice(0, TOP_SECURITIES).map((s) => shortName(s.name)).join(', ')

export const proposals: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const t = pick(ctx.lang)
  const SRC = srcOf(ctx.lang)
  const reason = (p: Proposal) => reasonDe(p, ctx.lang)
  const all = client.proposals
  const out: Finding[] = []
  const base = (subj: string) => ({ id: findingId(CHECK, client.ref, subj), check: CHECK, topic: TOPIC })
  const ev = (p: Proposal) => SRC.proposal(p.id, dateOf(p))

  const rejected = all.filter((p) => p.status === REJECTED)
  // Newest first; undated ones last.
  const rejectedByDate = [...rejected].sort((a, b) => (dateOf(b) ?? '').localeCompare(dateOf(a) ?? ''))

  all.forEach((p, i) => {
    if (p.status !== DRAFT) return
    const tops = topSecurities(p)
    out.push({
      ...base(`draft:${subject(p, i)}`), kind: 'action', severity: 'warn',
      title: `${prefix('draft', ctx.lang)}«${reason(p)}»${vom(p, ctx.lang)}${tops ? ` ${t('mit', 'with')} ${tops}` : ''}`,
      numbers: { positions: p.securities.length },
      evidence: [ev(p)],
    })
    // The best-matching rejected proposal, if it covers enough of the draft's securities.
    const mine = new Set(p.securities.map(keyOf))
    let best: { r: Proposal; overlap: number } | undefined
    for (const r of rejectedByDate) {
      if (!mine.size) break
      const theirs = new Set(r.securities.map(keyOf))
      const overlap = [...mine].filter((k) => theirs.has(k)).length / mine.size
      if (overlap >= REPEAT_OVERLAP && (!best || overlap > best.overlap)) best = { r, overlap }
    }
    if (best) {
      out.push({
        ...base(`repeat:${subject(p, i)}`), kind: 'interpretation', severity: 'info',
        title: t(
          `Entwurf ähnelt abgelehntem Vorschlag${vom(best.r)} («${reasonDe(best.r)}»): ${pct(best.overlap, 0)} gleiche Titel`,
          `Draft resembles the rejected proposal${vom(best.r, 'en')} («${reason(best.r)}»): ${pct(best.overlap, 0)} of its securities are the same`,
        ),
        detail: t(
          `Der Kunde hat einen Vorschlag mit weitgehend denselben Titeln abgelehnt. Vorschläge enthalten das ganze Zielportfolio, ein Teil der Übereinstimmung sind also bestehende Positionen. Vor dem Gespräch prüfen, was sich seither geändert hat.`,
          `The client rejected a proposal with largely the same securities. Proposals list the whole target portfolio, so part of the overlap is existing positions. Before the call, check what has changed since.`,
        ),
        numbers: { overlap: best.overlap, positions: p.securities.length },
        evidence: [ev(p), ev(best.r)],
      })
    }
  })

  if (rejected.length) {
    const recent = rejectedByDate.slice(0, RECENT_REJECTED)
    out.push({
      ...base('rejected-summary'), kind: 'fact', severity: 'info',
      title: t(
        `${rejected.length} ${rejected.length === 1 ? 'Vorschlag' : 'Vorschläge'} abgelehnt, zuletzt${vom(recent[0]) || ' ohne Datum'}: «${reasonDe(recent[0])}»`,
        `${rejected.length} ${rejected.length === 1 ? 'proposal' : 'proposals'} rejected, the latest${vom(recent[0], 'en') || ' undated'}: «${reason(recent[0])}»`,
      ),
      detail: recent.map((p) => t(
        `${dateOf(p) ? dateCh(dateOf(p)) : 'ohne Datum'}: «${reasonDe(p)}» mit ${topSecurities(p) || 'keinen Titeln'}`,
        `${dateOf(p) ? dateCh(dateOf(p), 'en') : 'undated'}: «${reason(p)}» with ${topSecurities(p) || 'no securities'}`,
      )).join('; '),
      numbers: { rejected: rejected.length },
      evidence: recent.map(ev),
    })
    all.forEach((p, i) => {
      if (p.status !== REJECTED) return
      out.push({
        ...base(`rejected:${subject(p, i)}`), kind: 'fact', severity: 'info',
        title: rejectedTitle(dateOf(p) ? dateCh(dateOf(p), ctx.lang) : undefined, reason(p), ctx.lang),
        detail: topSecurities(p) || undefined,
        numbers: { positions: p.securities.length },
        evidence: [ev(p)],
      })
    })
  }

  const accepted = all.filter((p) => p.status === ACCEPTED).length
  const decided = accepted + rejected.length
  if (decided >= MIN_DECIDED) {
    out.push({
      ...base('acceptance'), kind: 'fact', severity: 'info',
      title: t(`${accepted} von ${all.length} Vorschlägen angenommen, ${rejected.length} abgelehnt`, `${accepted} of ${all.length} proposals accepted, ${rejected.length} rejected`),
      numbers: { accepted, rejected: rejected.length, total: all.length, acceptanceRate: accepted / decided },
      evidence: all.filter((p) => p.status === ACCEPTED || p.status === REJECTED).slice(0, 5).map(ev),
    })
  }
  return out
}
