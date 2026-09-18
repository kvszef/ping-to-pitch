// STOPGAP until app/engine lands: Finding[] straight from one raw client and reference.json, so the
// briefing writer runs on real data today. Check ids match the engine's (portfolio.*), so replacing
// the portfolio part is one import. Contradictions and notes (E2/E3) stay here until the engine has them.
//
// Pure: no clock (`now` is passed in), no network, no DOM. Null and absent fields both occur; an
// unknown security is counted as "unclassified", never thrown on. Names and IBANs of accounts are never read.

import { factsFromRaw } from '../../src/data/facts.ts'
import { ruleText } from '../../src/data/ruleText.ts'
import { amount, day, pct, type DraftProposal, type Evidence, type Finding } from './findings.ts'
import { addMonths, monthsBetween, readNote, type Exclusion, type ReadNote } from './notes.ts'

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isObj) : [])
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

// ---- reference index ----------------------------------------------------------------------------

export type RefIndex = {
  securities: Map<number, Raw>
  funds: Map<number, Raw[]> // look-through rows per fund, Weight in points 0–100
  riskProfiles: Map<number, Raw>
}

const cache = new WeakMap<object, RefIndex>()

export function indexReference(reference: unknown): RefIndex {
  const r: Raw = isObj(reference) ? reference : {}
  const hit = cache.get(r)
  if (hit) return hit
  const funds = new Map<number, Raw[]>()
  for (const m of list(r.FundUnbundlingMappings)) {
    const id = num(m.FundSecurityId)
    const rows = funds.get(id)
    if (rows) rows.push(m)
    else funds.set(id, [m])
  }
  const index: RefIndex = {
    securities: new Map(list(r.Securities).map((s) => [num(s.Id), s])),
    funds,
    riskProfiles: new Map(list(r.RiskProfiles).map((p) => [num(p.Id), p])),
  }
  cache.set(r, index)
  return index
}

// ---- positions and look-through -----------------------------------------------------------------

type Position = { securityId: number; name: string; share: number; value: number; currency: string }

// Every security position with its share of the client's total wealth (position share × portfolio weight).
function positionsOf(client: Raw): Position[] {
  const portfolios = list(client.Portfolios)
  const total = portfolios.reduce((n, p) => n + num(p.AssetsUnderManagementInDefaultCurrency), 0)
  return portfolios.flatMap((p) => {
    const weight = total > 0 ? num(p.AssetsUnderManagementInDefaultCurrency) / total : portfolios.length === 1 ? 1 : 0
    return list(p.SecurityPositions).map((s) => ({
      securityId: num(s.SecurityId),
      name: shortName(str(s.SecurityName) || str(s.Isin) || 'Position ohne Namen'),
      share: num(s.PortfolioValuePercentage) * weight,
      value: num(s.TotalAmountInPortfolioCurrency),
      currency: str(p.PortfolioCurrency) || str(client.ReportingCurrency) || 'CHF',
    }))
  })
}

// "Anteile -USD- SSgA SPDR ETFs Europe II PLC - SPDR MSCI World Energy UCITS ETF" → "SPDR MSCI World Energy UCITS ETF"
export function shortName(name: string): string {
  const parts = name.split(/\s+-\s+/)
  const last = parts.length > 1 ? parts[parts.length - 1] : name
  return last.replace(/^(Namen-Aktien?|Inhaber-Aktien?|Aktien?|Anteile)\s+(-[^-]+-\s+)?/i, '').replace(/\s{2,}/g, ' ').trim() || name
}

type Holding = Position & { exposure: number; fraction: number; via: 'direkt' | 'Fonds' }
type Exposure = { total: number; direct: number; viaFunds: number; unclassified: number; holdings: Holding[] }

function exposure(positions: Position[], ref: RefIndex, direct: (s: Raw) => boolean, fundRow: (m: Raw) => boolean): Exposure {
  const out: Exposure = { total: 0, direct: 0, viaFunds: 0, unclassified: 0, holdings: [] }
  for (const p of positions) {
    const rows = ref.funds.get(p.securityId)
    const security = ref.securities.get(p.securityId)
    let fraction = 0
    let via: Holding['via'] = 'direkt'
    if (rows?.length) {
      const all = rows.reduce((n, m) => n + num(m.Weight), 0)
      fraction = all > 0 ? rows.filter(fundRow).reduce((n, m) => n + num(m.Weight), 0) / all : 0
      via = 'Fonds'
    } else if (security) {
      fraction = direct(security) ? 1 : 0
    } else {
      out.unclassified += p.share
      continue
    }
    if (fraction <= 0) continue
    const e = p.share * fraction
    out.total += e
    if (via === 'Fonds') out.viaFunds += e
    else out.direct += e
    out.holdings.push({ ...p, exposure: e, fraction, via })
  }
  out.holdings.sort((a, b) => b.exposure - a.exposure)
  return out
}

const EXCLUSIONS: Partial<Record<Exclusion, { label: string; direct: (s: Raw) => boolean; fundRow: (m: Raw) => boolean }>> = {
  fossil: { label: 'Energie', direct: (s) => str(s.SAA_IndustryName) === 'Energy', fundRow: (m) => str(m.IndustryName) === 'Energy' },
  'fossil-direct': { label: 'Energie', direct: (s) => str(s.SAA_IndustryName) === 'Energy', fundRow: (m) => str(m.IndustryName) === 'Energy' },
  'emerging-markets': { label: 'Schwellenländer', direct: (s) => /emerging|emma/i.test(`${str(s.AssetClassName)} ${str(s.CountryGroupName)}`), fundRow: (m) => str(m.CountryGroupName) === 'Equities EmMa' },
}

const UNVERIFIABLE: Partial<Record<Exclusion, string>> = {
  'defense-tobacco': 'Die Daten kennen keine Branche «Rüstung» oder «Tabak»',
  'human-rights': 'Die Daten enthalten keine Angaben zu Menschenrechts-Kontroversen',
}

const noteEvidence = (n: ReadNote): Evidence => ({ source: 'Kundennotiz', quote: n.quote, date: n.date })

// ---- checks -------------------------------------------------------------------------------------

function contradictions(ref: string, note: ReadNote, positions: Position[], index: RefIndex): Finding[] {
  const kind = note.exclusion!
  const id = `contradiction.${kind}:${ref}:${note.date}`
  const unverifiable = UNVERIFIABLE[kind]
  if (unverifiable) {
    return [{ id, check: 'contradiction.unverifiable', kind: 'fact', severity: 'info', topic: note.topic,
      title: `Wunsch «${note.de}» ist vermerkt, lässt sich aber nicht prüfen`, detail: `${unverifiable}. Titel mit dem Kunden durchgehen, nicht raten.`,
      evidence: [noteEvidence(note)] }]
  }
  const rule = EXCLUSIONS[kind]
  if (!rule) return []
  const e = exposure(positions, index, rule.direct, rule.fundRow)
  const directOnly = kind === 'fossil-direct'
  const breached = directOnly ? e.direct > 0.0005 : e.total > 0.0005
  const numbers = { total: e.total, direct: e.direct, viaFunds: e.viaFunds, unclassified: e.unclassified }
  const positionEvidence: Evidence[] = e.holdings.slice(0, 4).map((h) => ({
    source: 'Position', ref: String(h.securityId),
    quote: h.via === 'Fonds' ? `${h.name}: ${pct(h.share)} des Vermögens, davon ${pct(h.fraction)} ${rule.label} = ${pct(h.exposure, 2)}` : `${h.name}: ${pct(h.share)} des Vermögens, direkt`,
  }))
  const unclassifiedNote = e.unclassified > 0.001 ? ` ${pct(e.unclassified)} des Vermögens liegen in Titeln ohne Klassifizierung und sind nicht mitgezählt.` : ''

  if (!breached) {
    return [{ id, check: `contradiction.${kind === 'emerging-markets' ? 'region' : 'fossil-fuel'}`, kind: 'fact', severity: 'ok', topic: note.topic, numbers,
      title: directOnly && e.total > 0 ? `Wunsch «${note.de}» erfüllt: keine Direktanlage, über breite Fonds ${pct(e.total)} ${rule.label}` : `Wunsch «${note.de}» erfüllt`,
      detail: `Direkt ${pct(e.direct)}, über Fonds ${pct(e.viaFunds)}.${unclassifiedNote}`,
      evidence: [noteEvidence(note), ...positionEvidence] }]
  }

  // Smallest fix: sell only what is clearly the problem (a direct holding, or a fund at least half in the excluded area).
  const culprits = e.holdings.filter((h) => (directOnly ? h.via === 'direkt' : h.via === 'direkt' || h.fraction >= 0.5))
  const removed = culprits.reduce((n, h) => n + h.exposure, 0)
  const before = directOnly ? e.direct : e.total
  const after = Math.max(0, before - removed)
  // Proposal shape: the positions to sell, each with its target weight 0 and the amount that goes.
  const fix: DraftProposal | undefined = culprits.length ? {
    Reason: culprits.length === 1 ? `${culprits[0].name} verkaufen` : `${culprits.length} Positionen verkaufen (${culprits.map((h) => h.name).join(', ')})`,
    SecurityPositions: culprits.map((h) => ({ SecurityId: h.securityId, SecurityName: h.name, ProposalValuePercentage: 0, TotalAmountInProposalCurrency: h.value })),
  } : undefined
  const trades: Evidence[] = culprits.map((h) => ({ source: 'Vorschlag', ref: String(h.securityId), quote: `Verkauf ${h.name} über ${h.currency} ${amount(h.value)}` }))
  const funds = e.holdings.filter((h) => h.via === 'Fonds').length
  const where = directOnly ? `${pct(e.direct)} direkt` : e.direct <= 0.0005 ? `${pct(e.total)} ${rule.label}, alles über ${funds} Fonds` : `${pct(e.total)} ${rule.label}, davon ${pct(e.viaFunds)} über Fonds`
  return [{ id, check: `contradiction.${kind === 'emerging-markets' ? 'region' : 'fossil-fuel'}`, kind: 'fact', topic: note.topic,
    numbers: { ...numbers, before, ...(fix ? { after } : {}) },
    severity: culprits.length ? 'risk' : 'warn', fix,
    title: `Widerspruch: Wunsch «${note.de}», Portfolio hält ${where}`,
    detail: (fix ? `Grösster Treiber: ${culprits[0].name} mit ${pct(culprits[0].exposure)}. Nach Verkauf: ${pct(after)}.` : `Nur über breite Indexfonds: ein Ausschluss verlangt Fonds mit ${rule.label}-Ausschluss.`) + unclassifiedNote,
    evidence: [noteEvidence(note), ...positionEvidence, ...trades] }]
}

function noteFindings(ref: string, note: ReadNote, now: Date, liquidity: { share: number; value: number; currency: string }): Finding[] {
  const id = (check: string) => `${check}:${ref}:${note.date}`
  const ev = [noteEvidence(note)]
  const age = monthsBetween(new Date(`${note.date}T00:00:00Z`), now)
  switch (note.category) {
    case 'plan': {
      if (note.horizonMonths) {
        const due = addMonths(note.date, note.horizonMonths)
        const expired = due.getTime() < now.getTime()
        const dueIso = due.toISOString().slice(0, 10)
        if (expired) {
          return [{ id: id('context.stale-note'), check: 'context.stale-note', kind: 'interpretation', severity: 'warn', topic: note.topic,
            numbers: { ageMonths: age, overdueMonths: monthsBetween(due, now) },
            title: `Veraltet: ${note.label ?? `«${note.de}»`} – Zeitfenster lief am ${day(dueIso)} ab (Notiz vom ${day(note.date)})`, detail: note.question, evidence: ev }]
        }
        const left = monthsBetween(now, due)
        return [{ id: id('context.plan'), check: 'context.plan', kind: 'fact', severity: note.topic === 'liquidity' ? 'warn' : 'info', topic: note.topic,
          numbers: { monthsLeft: left, liquidityShare: liquidity.share },
          title: `${note.label ?? note.de}: ${left === 0 ? 'noch weniger als 1 Monat' : left === 1 ? 'noch 1 Monat' : `noch ${left} Monate`} (bis ${day(dueIso)})`,
          detail: [`Notiz: ${note.de}.`, note.topic === 'liquidity' ? `Liquidität heute: ${pct(liquidity.share)} (${liquidity.currency} ${amount(liquidity.value)}).` : '', note.question ?? ''].filter(Boolean).join(' '),
          evidence: ev }]
      }
      const stale = age >= 12
      return [{ id: id(stale ? 'context.stale-note' : 'context.plan'), check: stale ? 'context.stale-note' : 'context.plan', kind: stale ? 'interpretation' : 'fact',
        severity: stale ? 'warn' : 'info', topic: note.topic, numbers: { ageMonths: age },
        title: stale ? `Seit ${age} Monaten offen: ${note.label ?? `«${note.de}»`}` : note.de, detail: note.question, evidence: ev }]
    }
    case 'request':
      return [{ id: id('memory.promise'), check: 'memory.promise', kind: 'action', severity: 'warn', topic: note.topic, numbers: { ageMonths: age },
        title: `Offener Wunsch seit ${day(note.date)}: ${note.label ?? note.de}`,
        detail: 'In den Daten nicht als erledigt vermerkt.', evidence: ev }]
    case 'contact':
    case 'temperament':
      return [{ id: id(`profile.${note.category}`), check: `profile.${note.category}`, kind: 'interpretation', severity: 'info', topic: note.topic, title: note.de, detail: note.avoid, evidence: ev }]
    case 'interest':
      return [{ id: id('profile.interest'), check: 'profile.interest', kind: 'fact', severity: 'info', topic: note.topic, title: note.de, evidence: ev }]
    case 'context':
    case 'other':
      return [{ id: id('context.note'), check: 'context.note', kind: 'fact', severity: 'info', topic: note.topic, title: note.de, evidence: ev }]
    default:
      return []
  }
}

const REASONS: Record<string, string> = {
  'Change of risk tolerance': 'Änderung der Risikobereitschaft', 'Portfolio rebalancing': 'Rebalancing', 'Withdrawal request': 'Auszahlung',
  'Change of investment strategy': 'Strategiewechsel', 'Risk profile update': 'Anpassung Risikoprofil', 'Client relocation': 'Wohnortwechsel',
  'Follow-up from prior meeting': 'Nachfassen nach Gespräch', 'Estate planning discussion': 'Nachlassplanung', 'Tax year-end rebalancing': 'Steuerliches Rebalancing zum Jahresende',
  'Annual review meeting': 'Jahresgespräch', 'Client called': 'Kundenanruf', 'Market volatility follow-up': 'Nachfassen nach Marktschwankung',
  'New deposit received': 'Neue Einzahlung', 'Life event (retirement)': 'Lebensereignis Pensionierung', 'Periodic portfolio review': 'Periodische Überprüfung',
}
export const reasonDe = (reason: string) => REASONS[reason] ?? reason

function proposals(ref: string, client: Raw): Finding[] {
  const all = list(client.Proposals)
  if (!all.length) return []
  const status = (p: Raw) => str(p.ProposalStatusName)
  const rejected = all.filter((p) => status(p) === 'Abgelehnt').sort((a, b) => str(b.ProposedDateUTC).localeCompare(str(a.ProposedDateUTC)))
  const drafts = all.filter((p) => status(p) === 'Entwurf').sort((a, b) => str(b.ProposedDateUTC).localeCompare(str(a.ProposedDateUTC)))
  const accepted = all.filter((p) => status(p) === 'Final').length
  const out: Finding[] = []
  const numbers = { total: all.length, accepted, rejected: rejected.length, draft: drafts.length }
  if (rejected.length) {
    out.push({ id: `portfolio.proposals:${ref}:rejected`, check: 'portfolio.proposals', kind: 'fact', severity: 'info', topic: 'proposals', numbers,
      title: `${rejected.length} von ${all.length} Vorschlägen abgelehnt, zuletzt «${reasonDe(str(rejected[0].Reason))}» am ${day(str(rejected[0].ProposedDateUTC))}`,
      evidence: rejected.slice(0, 5).map((p) => ({ source: 'Vorschlag (abgelehnt)', ref: str(p.ProposalId), quote: reasonDe(str(p.Reason)), date: str(p.ProposedDateUTC).slice(0, 10) })) })
  }
  if (drafts.length) {
    out.push({ id: `portfolio.proposals:${ref}:draft`, check: 'portfolio.proposals', kind: 'action', severity: 'warn', topic: 'proposals', numbers,
      title: `Entwurf vom ${day(str(drafts[0].ProposedDateUTC))} noch offen: «${reasonDe(str(drafts[0].Reason))}»`,
      evidence: drafts.slice(0, 3).map((p) => ({ source: 'Vorschlag (Entwurf)', ref: str(p.ProposalId), quote: reasonDe(str(p.Reason)), date: str(p.ProposedDateUTC).slice(0, 10) })) })
  }
  return out
}

function violations(ref: string, client: Raw): Finding[] {
  const groups = new Map<string, Raw[]>()
  for (const v of list(client.SuitabilityViolations)) {
    const key = str(v.RuleCode) || str(v.RuleDescription) || 'unbekannt'
    groups.set(key, [...(groups.get(key) ?? []), v])
  }
  return [...groups.entries()].map(([code, vs]) => {
    const first = vs[0]
    const severity = first.Severity === 'Error' ? 'risk' : first.Severity === 'Warning' ? 'warn' : 'info'
    const text = ruleText(code) !== code ? ruleText(code) : str(first.RuleDescription) || code
    return { id: `portfolio.violations:${ref}:${code}`, check: 'portfolio.violations', kind: 'fact', severity, topic: 'violations',
      numbers: { count: vs.length }, title: vs.length > 1 ? `${text} (${vs.length}×)` : text,
      evidence: [{ source: 'Regelverletzung', ref: code, quote: text }] } satisfies Finding
  }).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'risk' ? -1 : 1))
}

function risk(ref: string, client: Raw, index: RefIndex): Finding[] {
  const profile = index.riskProfiles.get(num(client.RiskProfileId))
  const max = num(profile?.MaxVola)
  if (!profile || max <= 0) return []
  return list(client.Portfolios).filter((p) => num(p.Volatility) > max).map((p) => ({
    id: `portfolio.risk:${ref}:${str(p.PortfolioNr) || str(p.PortfolioId)}`, check: 'portfolio.risk', kind: 'fact', severity: 'risk', topic: 'risk',
    numbers: { volatility: num(p.Volatility), max },
    title: `Schwankung ${pct(num(p.Volatility))} liegt über dem Maximum von ${str(profile.Name)} (${pct(max)})`,
    evidence: [{ source: 'Portfolio', ref: str(p.PortfolioNr), quote: `Volatilität ${pct(num(p.Volatility))}` }, { source: 'Risikoprofil', ref: str(profile.Name), quote: `Maximale Volatilität ${pct(max)}` }],
  }) satisfies Finding)
}

function performance(ref: string, client: Raw): Finding[] {
  const f = factsFromRaw(client).performance
  if (!f) return []
  const numbers = { month: f.month / 100, ytd: f.ytd / 100, sinceStart: f.sinceStart / 100, worst: f.worst.value / 100 }
  const sign = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
  return [{ id: `portfolio.performance:${ref}:total`, check: 'portfolio.performance', kind: 'fact', topic: 'performance', numbers,
    severity: f.month <= -2 || f.ytd < 0 ? 'warn' : 'info',
    title: `Letzter Monat ${sign(f.month)}, seit Jahresbeginn ${sign(f.ytd)}`,
    detail: `Seit ${f.startLabel} ${sign(f.sinceStart)}. Schwächster Monat: ${f.worst.label} mit ${sign(f.worst.value)}. ${f.note}`,
    evidence: [{ source: 'Wertentwicklung', quote: f.note }] }]
}

function concentration(ref: string, positions: Position[]): Finding[] {
  const top = [...positions].sort((a, b) => b.share - a.share)[0]
  if (!top || top.share < 0.1) return []
  return [{ id: `portfolio.concentration:${ref}:${top.securityId}`, check: 'portfolio.concentration', kind: 'fact', severity: top.share >= 0.2 ? 'risk' : 'warn', topic: 'concentration',
    numbers: { share: top.share }, title: `Klumpenrisiko: ${top.name} macht ${pct(top.share)} des Vermögens aus`,
    evidence: [{ source: 'Position', ref: String(top.securityId), quote: `${top.name}: ${pct(top.share)}` }] }]
}

// ---- entry --------------------------------------------------------------------------------------

export function provisionalFindings(client: unknown, reference: unknown, now: Date): Finding[] {
  const raw: Raw = isObj(client) ? client : {}
  const ref = str(raw.ClientRef) || 'UNBEKANNT'
  const index = indexReference(reference)
  const positions = positionsOf(raw)
  const aum = num(raw.AssetsUnderManagementInDefaultCurrency) || list(raw.Portfolios).reduce((n, p) => n + num(p.AssetsUnderManagementInDefaultCurrency), 0)
  const liquidityValue = num(raw.LiquidityInDefaultCurrency)
  const liquidity = { share: aum > 0 ? liquidityValue / aum : 0, value: liquidityValue, currency: str(raw.ReportingCurrency) || 'CHF' }
  const notes = list(raw.ClientNotes)
    .map((n) => ({ text: str(n.Note), date: str(n.CreatedByDateUTC).slice(0, 10) }))
    .filter((n) => n.text && /^\d{4}-\d{2}-\d{2}$/.test(n.date))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((n) => readNote(n.text, n.date))

  const findings: Finding[] = [
    ...notes.filter((n) => n.exclusion).flatMap((n) => contradictions(ref, n, positions, index)),
    ...risk(ref, raw, index),
    ...violations(ref, raw),
    ...performance(ref, raw),
    ...concentration(ref, positions),
    ...proposals(ref, raw),
    ...notes.filter((n) => !n.exclusion).flatMap((n) => noteFindings(ref, n, now, liquidity)),
  ]
  if (aum > 0) {
    findings.push({ id: `portfolio.liquidity:${ref}:total`, check: 'portfolio.liquidity', kind: 'fact', severity: 'info', topic: 'liquidity',
      numbers: { share: liquidity.share, value: liquidity.value }, title: `Liquidität ${pct(liquidity.share)} (${liquidity.currency} ${amount(liquidity.value)})`,
      evidence: [{ source: 'Kundendatei', quote: 'LiquidityInDefaultCurrency' }] })
  }
  return findings
}
