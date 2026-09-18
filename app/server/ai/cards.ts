// Turns the briefing writer's output into the main app's cards (src/types.ts), so the workspace shows
// the engine's briefing through GET /api/briefing/:ref?tier=… with no change on the UI side.
// Key figures and client context come from the UI's own fromRaw, so both paths show the same facts.

import { fromRaw } from '../../src/data/fromRaw.ts'
import type { Card, CardOf, Severity, TalkLine } from '../../src/types.ts'
import type { Briefing60, Line } from './briefing.ts'
import { amount, day, pct, type Finding } from './findings.ts'
import { exclusionHoldings } from './provisional-findings.ts'
import type { Exclusion } from './notes.ts'

const CHECK_SOURCE: Record<string, string> = {
  'portfolio.violations': 'Regelverletzung', 'portfolio.risk': 'Risikoprofil', 'portfolio.performance': 'Wertverlauf des Portfolios',
  'portfolio.concentration': 'Positionen', 'portfolio.allocation': 'Allokation gegen Strategie', 'portfolio.proposals': 'Vorschläge',
  'portfolio.maturities': 'Fälligkeiten', 'portfolio.liquidity': 'Kundendatei', 'context.stale-note': 'Kundennotiz', 'context.plan': 'Kundennotiz',
  'context.note': 'Kundennotiz', 'memory.promise': 'Kundennotiz', 'profile.contact': 'Kundennotiz', 'profile.temperament': 'Kundennotiz',
  'contradiction.fossil-fuel': 'Kundennotiz und Fonds-Durchsicht', 'contradiction.region': 'Kundennotiz und Fonds-Durchsicht', 'contradiction.unverifiable': 'Kundennotiz',
}
const sourceOf = (f: Finding) => CHECK_SOURCE[f.check] ?? f.evidence[0]?.source ?? f.check
const clean = (t: string) => { const s = t.replace(/^[A-Z]+-\d+(?:-\d+)?: /, ''); return s.charAt(0).toUpperCase() + s.slice(1) }
const dateOf = (f: Finding) => { const d = f.evidence.find((e) => e.date)?.date; return d ? day(d) : undefined }

function talkLine(l: Line, byId: Map<string, Finding>): TalkLine {
  const fs = l.findings.map((id) => byId.get(id)).filter((f): f is Finding => !!f)
  const f = fs[0]
  if (!f) return { text: l.text, source: 'Briefing' }
  const severity: Severity | undefined = f.severity === 'risk' || f.severity === 'warn' ? f.severity : undefined
  return { text: l.text, source: sourceOf(f), date: dateOf(f), detail: clean(f.title) === l.text ? f.detail : clean(f.title), severity }
}

export function talkTrackCard(b: Briefing60, findings: Finding[]): CardOf<'talktrack'> {
  const byId = new Map(findings.map((f) => [f.id, f]))
  const t = (l: Line) => talkLine(l, byId)
  return {
    type: 'talktrack', title: b.phrasedBy === 'vorlage' ? '60-Sekunden-Briefing' : '60-Sekunden-Briefing (KI-formuliert, Zahlen geprüft)',
    open: t(b.blocks.open[0]), mention: b.blocks.mention.map(t), ask: b.blocks.ask.map(t), avoid: b.blocks.avoid.map(t), reasons: b.reasons.map(t),
  }
}

function contradictionCard(f: Finding, raw: unknown, reference: unknown): CardOf<'contradiction'> | null {
  const kind = f.id.split(':')[0].split('.')[1] as Exclusion
  const e = exclusionHoldings(raw, reference, kind)
  if (!e) return null
  const label = kind === 'emerging-markets' ? 'Schwellenländer' : 'Energie'
  const wish = /«(.+?)»/.exec(f.title)?.[1] ?? f.title
  const note = f.evidence.find((x) => x.source === 'Kundennotiz')
  const before = f.numbers?.before ?? e.total
  const after = f.numbers?.after
  const byId = new Map(e.holdings.map((h) => [h.securityId, h]))
  const trades = (f.fix?.SecurityPositions ?? []).map((p) => {
    const h = p.SecurityId !== undefined ? byId.get(p.SecurityId) : undefined
    return { side: 'Verkauf' as const, name: p.SecurityName, amount: `${h?.currency ?? 'CHF'} ${amount(p.TotalAmountInProposalCurrency ?? 0)}`, share: h ? `-${pct(h.share)}` : '' }
  })
  return {
    type: 'contradiction', title: 'Wunsch gegen Bestand',
    wish: { quote: wish, date: note?.date ? day(note.date) : '', source: 'Kundennotiz' },
    verdict: f.detail ?? clean(f.title),
    exposure: { label, total: e.total * 100, direct: e.direct * 100, viaFunds: e.viaFunds * 100 },
    holdings: e.holdings.slice(0, 5).map((h) => ({ name: h.name, weight: h.share * 100, exposure: h.exposure * 100, via: h.via })),
    source: 'Fonds-Durchsicht aus reference.json',
    fix: {
      summary: f.fix ? `Kleinste Lösung: ${f.fix.Reason}.` : 'Kein einzelner Verkauf löst es: der Anteil steckt in breiten Indexfonds. Varianten mit Ausschluss prüfen.',
      trades,
      effects: after !== undefined ? [{ label: `${label}-Anteil`, before: pct(before), after: pct(after), ok: after < before }] : [],
      source: 'Berechnet: Position entfernt, Anteil neu gerechnet',
    },
  }
}

function staleCard(f: Finding): CardOf<'stalenote'> {
  const note = f.evidence.find((x) => x.source === 'Kundennotiz')
  const expired = /Zeitfenster lief am ([\d.]+) ab/.exec(f.title)?.[1]
  const age = f.numbers?.ageMonths
  return {
    type: 'stalenote', title: 'Notiz womöglich veraltet',
    note: { quote: note?.quote ?? f.title, date: note?.date ? day(note.date) : '', source: 'Kundennotiz' },
    age: age !== undefined ? `${age} Monate alt` : '',
    expired: expired ? `Zeitfenster abgelaufen am ${expired}` : 'Seit über einem Jahr nicht bestätigt',
    reason: 'Die Notiz beschreibt einen Plan mit Frist. Nicht als Tatsache nennen, sondern nachfragen.',
    question: f.detail ?? 'Ist das noch aktuell?',
  }
}

function profileCard(b: Briefing60, findings: Finding[]): CardOf<'profile'> | null {
  if (!b.persona) return null
  const said = findings.filter((f) => f.check === 'profile.contact' || f.check === 'profile.temperament').slice(0, 4).map((f) => ({ text: f.title, date: dateOf(f) ?? '' }))
  const acc = findings.find((f) => f.check === 'portfolio.proposals' && f.numbers?.total !== undefined && f.numbers?.rejected !== undefined)
  const done = acc ? [{ label: 'Vorschläge angenommen', value: `${acc.numbers!.accepted ?? acc.numbers!.total - acc.numbers!.rejected} von ${acc.numbers!.total}`, source: 'Vorschläge' }] : []
  return { type: 'profile', title: 'So tickt der Kunde', persona: `${b.persona.text}${b.persona.tone.length ? ` → ${b.persona.tone.join(', ')}` : ''}`, said, done, source: 'Aus Notizen und Vorschlägen abgeleitet, nur für den Berater' }
}

function todosCard(findings: Finding[]): CardOf<'todos'> | null {
  const promises = findings.filter((f) => f.check === 'memory.promise')
  if (!promises.length) return null
  return {
    type: 'todos', title: 'Offene Zusagen',
    items: promises.map((f) => ({ text: f.title.replace(/^Offener Wunsch seit [^:]+: /, ''), owner: 'Berater' as const, done: false, overdue: (f.numbers?.ageMonths ?? 0) >= 3, source: `Kundennotiz vom ${dateOf(f) ?? '–'}` })),
  }
}

function flagsCard(findings: Finding[]): CardOf<'flags'> {
  const shown = findings.filter((f) => (f.severity === 'risk' || f.severity === 'warn') && f.check.startsWith('portfolio.')).slice(0, 8)
  return {
    type: 'flags', title: 'Befunde aus der Engine',
    items: shown.length ? shown.map((f) => ({ severity: f.severity, text: clean(f.title), source: sourceOf(f) })) : [{ severity: 'ok', text: 'Die Engine meldet keine Risiken oder Warnungen.', source: 'Engine' }],
  }
}

/** Every card except the talk track, which the route sends once it is phrased (or right away without a model). */
export function factCards(raw: unknown, reference: unknown, findings: Finding[], b: Briefing60, now: Date): Card[] {
  const base = fromRaw(raw, now).briefing.filter((c) => c.type === 'metrics' || c.type === 'context')
  const byId = new Map(findings.map((f) => [f.id, f]))
  const contradictions = findings
    .filter((f) => f.check.startsWith('contradiction.') && f.check !== 'contradiction.unverifiable' && (f.severity === 'risk' || f.severity === 'warn'))
    .map((f) => contradictionCard(f, raw, reference)).filter((c): c is CardOf<'contradiction'> => !!c)
  const instant: Card[] = [
    ...base, flagsCard(findings), ...contradictions,
    ...findings.filter((f) => f.check === 'context.stale-note').slice(0, 2).map(staleCard),
    ...([profileCard(b, findings), todosCard(findings)] as (Card | null)[]).filter((c): c is Card => c !== null),
    { type: 'questions', title: 'Wahrscheinliche Fragen', items: b.questions.map((q) => ({ q: q.q, a: q.a })) },
    { type: 'actions', title: 'Nächste Schritte', items: b.actions.map((a) => {
      const f = a.findings.map((id) => byId.get(id)).find((x): x is Finding => !!x)
      return { text: a.text, why: f ? `Quelle: ${sourceOf(f)}${dateOf(f) ? `, ${dateOf(f)}` : ''}` : 'Nach jedem Gespräch' }
    }) },
  ]
  return instant
}
