// Turns the briefing writer's output into the main app's cards (src/types.ts), so the workspace shows
// the engine's briefing through GET /api/briefing/:ref?tier=… with no change on the UI side.
// Key figures and client context come from the UI's own fromRaw, so both paths show the same facts.
//
// Language: the cards are written in the briefing's language (Briefing60.lang, German when absent). Values the
// UI compares stay as they are in both languages: Trade.side ('Verkauf'), holdings[].via ('Fonds' | 'direkt'),
// todos owner ('Berater'), house-view hit kind ('chance' | 'abweichung') and the fact and metric labels from fromRaw.

import { fromRaw } from '../../src/data/fromRaw.ts'
import { houseViewIn } from '../../engine/houseview.ts'
import { hasPrefix, isSource, pick, sourceName, stripPrefix, type Lang, type PrefixKey } from '../../engine/lang.ts'
import { houseView } from '../houseview.ts'
import type { Card, CardOf, Severity, TalkLine } from '../../src/types.ts'
import { PORTFOLIO_PREFIX, type Briefing60, type Line } from './briefing.ts'
import { amount, day, pct, type Finding } from './findings.ts'
import { exclusionHoldings } from './provisional-findings.ts'
import { OPEN_WISH_PREFIX, type Exclusion } from './notes.ts'

const CHECK_SOURCE: Record<string, string> = {
  'portfolio.violations': 'Regelverletzung', 'portfolio.risk': 'Risikoprofil', 'portfolio.performance': 'Wertverlauf des Portfolios',
  'portfolio.concentration': 'Positionen', 'portfolio.allocation': 'Allokation gegen Strategie', 'portfolio.proposals': 'Vorschläge',
  'portfolio.maturities': 'Fälligkeiten', 'portfolio.liquidity': 'Kundendatei', 'context.stale-note': 'Kundennotiz', 'context.plan': 'Kundennotiz',
  'context.note': 'Kundennotiz', 'memory.promise': 'Kundennotiz', 'profile.contact': 'Kundennotiz', 'profile.temperament': 'Kundennotiz',
  'contradiction.fossil-fuel': 'Kundennotiz und Fonds-Durchsicht', 'contradiction.region': 'Kundennotiz und Fonds-Durchsicht', 'contradiction.unverifiable': 'Kundennotiz',
  'memory.call-promise': 'Gesprächsnotiz',
}
const CHECK_SOURCE_EN: Record<string, string> = {
  'portfolio.violations': 'Rule violation', 'portfolio.risk': 'Risk profile', 'portfolio.performance': 'Portfolio value over time',
  'portfolio.concentration': 'Positions', 'portfolio.allocation': 'Allocation against strategy', 'portfolio.proposals': 'Proposals',
  'portfolio.maturities': 'Maturities', 'portfolio.liquidity': 'Client file', 'context.stale-note': 'Client note', 'context.plan': 'Client note',
  'context.note': 'Client note', 'memory.promise': 'Client note', 'profile.contact': 'Client note', 'profile.temperament': 'Client note',
  'contradiction.fossil-fuel': 'Client note and fund look-through', 'contradiction.region': 'Client note and fund look-through', 'contradiction.unverifiable': 'Client note',
  'memory.call-promise': 'Call note',
}
const EXCLUSIONS = new Set<string>(['fossil', 'fossil-direct', 'emerging-markets'])
const sourceOf = (f: Finding, lang?: Lang) => (lang === 'en' ? CHECK_SOURCE_EN : CHECK_SOURCE)[f.check] ?? f.evidence[0]?.source ?? f.check
const clean = (t: string) => { const s = t.replace(PORTFOLIO_PREFIX, ''); return s.charAt(0).toUpperCase() + s.slice(1) }
const dateOf = (f: Finding) => { const d = f.evidence.find((e) => e.date)?.date; return d ? day(d) : undefined }

function talkLine(l: Line, byId: Map<string, Finding>, lang?: Lang): TalkLine {
  const fs = l.findings.map((id) => byId.get(id)).filter((f): f is Finding => !!f)
  const f = fs[0]
  if (!f) return { text: l.text, source: 'Briefing' }
  const severity: Severity | undefined = f.severity === 'risk' || f.severity === 'warn' ? f.severity : undefined
  return { text: l.text, source: sourceOf(f, lang), date: dateOf(f), detail: clean(f.title) === l.text ? f.detail : clean(f.title), severity }
}

export function talkTrackCard(b: Briefing60, findings: Finding[]): CardOf<'talktrack'> {
  const byId = new Map(findings.map((f) => [f.id, f]))
  const t = (l: Line) => talkLine(l, byId, b.lang)
  const p = pick(b.lang)
  return {
    type: 'talktrack', title: b.phrasedBy === 'vorlage' ? p('60-Sekunden-Briefing', '60-second briefing') : p('60-Sekunden-Briefing (KI-formuliert, Zahlen geprüft)', '60-second briefing (phrased by AI, numbers checked)'),
    open: t(b.blocks.open[0]), mention: b.blocks.mention.map(t), ask: b.blocks.ask.map(t), avoid: b.blocks.avoid.map(t), reasons: b.reasons.map(t),
  }
}

function contradictionCard(f: Finding, raw: unknown, reference: unknown, lang?: Lang): CardOf<'contradiction'> | null {
  const t = pick(lang)
  // Stopgap ids: `contradiction.<kind>:<ref>:<date>`; engine ids: `contradiction.fossil-fuel:<ref>:<kind>:<date>`.
  const [head, , subject] = f.id.split(':')
  const kind = (EXCLUSIONS.has(head.split('.')[1]) ? head.split('.')[1] : subject) as Exclusion
  const e = exclusionHoldings(raw, reference, kind)
  if (!e) return null
  const label = kind === 'emerging-markets' ? t('Schwellenländer', 'Emerging markets') : t('Energie', 'Energy')
  const wish = /«(.+?)»/.exec(f.title)?.[1] ?? f.title
  const note = f.evidence.find((x) => isSource(x.source, 'note'))
  const before = f.numbers?.before ?? e.total
  const after = f.numbers?.after
  const byId = new Map(e.holdings.map((h) => [h.securityId, h]))
  const trades = (f.fix?.SecurityPositions ?? []).map((p) => {
    const h = p.SecurityId !== undefined ? byId.get(p.SecurityId) : undefined
    return { side: 'Verkauf' as const, name: p.SecurityName, amount: `${h?.currency ?? 'CHF'} ${amount(p.TotalAmountInProposalCurrency ?? 0)}`, share: h ? `-${pct(h.share)}` : '' }
  })
  return {
    type: 'contradiction', title: t('Wunsch gegen Bestand', 'Wish versus holdings'),
    wish: { quote: wish, date: note?.date ? day(note.date) : '', source: sourceName('note', lang) },
    verdict: f.detail ?? clean(f.title),
    exposure: { label, total: e.total * 100, direct: e.direct * 100, viaFunds: e.viaFunds * 100 },
    holdings: e.holdings.slice(0, 5).map((h) => ({ name: h.name, weight: h.share * 100, exposure: h.exposure * 100, via: h.via })),
    source: t('Fonds-Durchsicht aus reference.json', 'Fund look-through from reference.json'),
    fix: {
      summary: f.fix ? `${t('Kleinste Lösung', 'Smallest fix')}: ${f.fix.Reason}.` : t('Kein einzelner Verkauf löst es: der Anteil steckt in breiten Indexfonds. Varianten mit Ausschluss prüfen.', 'No single sale solves it: the share sits inside broad index funds. Look at fund variants with an exclusion.'),
      trades,
      effects: after !== undefined ? [{ label: t(`${label}-Anteil`, `${label} share`), before: pct(before), after: pct(after), ok: after < before }] : [],
      source: t('Berechnet: Position entfernt, Anteil neu gerechnet', 'Computed: position removed, share recalculated'),
    },
  }
}

function staleCard(f: Finding, lang?: Lang): CardOf<'stalenote'> {
  const t = pick(lang)
  const note = f.evidence.find((x) => isSource(x.source, 'note'))
  const expired = /Zeitfenster lief am ([\d.]+) ab|time window ended on ([\d.]+\d)/.exec(f.title)?.slice(1).find(Boolean)
  const age = f.numbers?.ageMonths
  return {
    type: 'stalenote', title: t('Notiz womöglich veraltet', 'Note may be outdated'),
    note: { quote: note?.quote ?? f.title, date: note?.date ? day(note.date) : '', source: sourceName('note', lang) },
    age: age !== undefined ? t(`${age} Monate alt`, `${age} months old`) : '',
    expired: expired ? t(`Zeitfenster abgelaufen am ${expired}`, `Time window ended on ${expired}`) : t('Seit über einem Jahr nicht bestätigt', 'Not confirmed for over a year'),
    reason: t('Die Notiz beschreibt einen Plan mit Frist. Nicht als Tatsache nennen, sondern nachfragen.', 'The note describes a plan with a deadline. Do not state it as a fact, ask.'),
    question: f.detail ?? t('Ist das noch aktuell?', 'Is this still current?'),
  }
}

function profileCard(b: Briefing60, findings: Finding[]): CardOf<'profile'> | null {
  if (!b.persona) return null
  const t = pick(b.lang)
  const said = findings.filter((f) => f.check === 'profile.contact' || f.check === 'profile.temperament').slice(0, 4).map((f) => ({ text: f.title, date: dateOf(f) ?? '' }))
  const acc = findings.find((f) => f.check === 'portfolio.proposals' && f.numbers?.total !== undefined && f.numbers?.rejected !== undefined)
  const done = acc ? [{ label: t('Vorschläge angenommen', 'Proposals accepted'), value: `${acc.numbers!.accepted ?? acc.numbers!.total - acc.numbers!.rejected} ${t('von', 'of')} ${acc.numbers!.total}`, source: t('Vorschläge', 'Proposals') }] : []
  return { type: 'profile', title: t('So tickt der Kunde', 'How the client ticks'), persona: `${b.persona.text}${b.persona.tone.length ? ` → ${b.persona.tone.join(', ')}` : ''}`, said, done, source: t('Aus Notizen und Vorschlägen abgeleitet, nur für den Berater', 'Derived from notes and proposals, for the advisor only') }
}

const PROMISE_PREFIXES: PrefixKey[] = ['promised', 'openFromCall']
function todosCard(findings: Finding[], lang?: Lang): CardOf<'todos'> | null {
  const t = pick(lang)
  const promises = findings.filter((f) => f.check === 'memory.promise' || f.check === 'memory.call-promise')
  if (!promises.length) return null
  const what = (title: string) => { const key = PROMISE_PREFIXES.find((k) => hasPrefix(title, k)); return key ? stripPrefix(title, key) : title.replace(OPEN_WISH_PREFIX, '') }
  return {
    type: 'todos', title: t('Offene Zusagen', 'Open promises'),
    items: promises.map((f) => ({
      text: what(f.title), owner: 'Berater' as const, done: false,
      overdue: f.check === 'memory.call-promise' ? f.severity === 'warn' : (f.numbers?.ageMonths ?? 0) >= 3,
      source: f.check === 'memory.call-promise' ? t(`Gesprächsnotiz vom ${dateOf(f) ?? '–'}`, `Call note of ${dateOf(f) ?? '–'}`) : t(`Kundennotiz vom ${dateOf(f) ?? '–'}`, `Client note of ${dateOf(f) ?? '–'}`),
    })),
  }
}

function flagsCard(findings: Finding[], lang?: Lang): CardOf<'flags'> {
  const t = pick(lang)
  const shown = findings.filter((f) => (f.severity === 'risk' || f.severity === 'warn') && f.check.startsWith('portfolio.')).slice(0, 8)
  return {
    type: 'flags', title: t('Befunde aus der Engine', 'Findings from the engine'),
    items: shown.length ? shown.map((f) => ({ severity: f.severity, text: clean(f.title), source: sourceOf(f, lang) })) : [{ severity: 'ok', text: t('Die Engine meldet keine Risiken oder Warnungen.', 'The engine reports no risks or warnings.'), source: 'Engine' }],
  }
}

// The bank's investment view with this client's points (engine check cio.house-view). No findings: no card.
function houseViewCard(findings: Finding[], lang?: Lang): CardOf<'houseview'> | null {
  const mine = findings.filter((f) => f.check === 'cio.house-view')
  const summary = mine.find((f) => f.id.endsWith(':summary'))
  if (!summary) return null
  const view = houseViewIn(houseView(), lang) // the example view exists in both languages; a bank's own view stays as written
  return {
    type: 'houseview', title: view.example ? sourceName('houseView', lang) : pick(lang)('Hausmeinung', 'House view'), date: `${view.date.slice(8, 10)}.${view.date.slice(5, 7)}.${view.date.slice(0, 4)}`,
    example: view.example, summary: view.summary,
    stances: view.stances.map((s) => ({ label: s.label, rating: s.rating, why: s.why })),
    hits: mine.filter((f) => f !== summary).map((f) => ({ kind: f.kind === 'action' ? 'chance' as const : 'abweichung' as const, text: stripPrefix(f.title, 'opportunity'), detail: f.detail })),
    inLine: summary.numbers?.inLine, measured: summary.numbers?.measured,
  }
}

/** Every card except the talk track, which the route sends once it is phrased (or right away without a model). */
export function factCards(raw: unknown, reference: unknown, findings: Finding[], b: Briefing60, now: Date): Card[] {
  const lang = b.lang
  const t = pick(lang)
  // Key figures and client context in the same language; their fact and metric labels stay German keys (src/data/fromRaw.ts).
  const base = fromRaw(raw, now, lang ?? 'de').briefing.filter((c) => c.type === 'metrics' || c.type === 'context')
  const byId = new Map(findings.map((f) => [f.id, f]))
  const contradictions = findings
    .filter((f) => f.check.startsWith('contradiction.') && f.check !== 'contradiction.unverifiable' && (f.severity === 'risk' || f.severity === 'warn'))
    .map((f) => contradictionCard(f, raw, reference, lang)).filter((c): c is CardOf<'contradiction'> => !!c)
  const instant: Card[] = [
    ...base, flagsCard(findings, lang), ...contradictions,
    ...findings.filter((f) => f.check === 'context.stale-note').slice(0, 2).map((f) => staleCard(f, lang)),
    ...([profileCard(b, findings), todosCard(findings, lang), houseViewCard(findings, lang)] as (Card | null)[]).filter((c): c is Card => c !== null),
    { type: 'questions', title: t('Wahrscheinliche Fragen', 'Likely questions'), items: b.questions.map((q) => ({ q: q.q, a: q.a })) },
    { type: 'actions', title: t('Nächste Schritte', 'Next steps'), items: b.actions.map((a) => {
      const f = a.findings.map((id) => byId.get(id)).find((x): x is Finding => !!x)
      return { text: a.text, why: f ? `${t('Quelle', 'Source')}: ${sourceOf(f, lang)}${dateOf(f) ? `, ${dateOf(f)}` : ''}` : t('Nach jedem Gespräch', 'After every call') }
    }) },
  ]
  return instant
}
