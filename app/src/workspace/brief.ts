import { briefs } from '../data/workspace'
import type { Client, EngineFinding, Severity } from '../types'
import { pick, REJECTED_TITLE, type Lang } from '../../engine/lang.ts'
import { uiLang } from '../data/uiLang'

// The 60-second brief inside the conversation tile: few, short items in speaking order. Positions,
// past activity and the client's own precedents, each with one figure and its source. Built from
// the computed facts for real client files; the sample clients have hand-written ones.
// Sentences and sources are written in `lang`. `group` stays German in both languages: it is a key that
// code compares; the screen shows it through the label dictionary (data/i18n-static.ts).

export type BriefGroup = 'Anlass' | 'Positionen' | 'Hausmeinung' | 'Verlauf' | 'Kunde' | 'Frühere Fälle' | 'Vorschlag' | 'Aus dem Chat'
export type BriefItem = { id: string; topics?: string[]; group: BriefGroup; figure?: string; text: string; source: string; severity?: Severity }

export const WORDS_PER_SECOND = 2.5 // 150 words per minute
export const readSeconds = (item: BriefItem) => `${item.figure ?? ''} ${item.text}`.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`
const share = (v: number) => `${v.toFixed(1)}%`
// What followed an earlier drop: back at the old level, the figure three months on, or still open.
type Incident = NonNullable<Client['facts']>['incidents'][number]
const outcomeOf = (x: Incident, lang: Lang) => x.recoveredMonths
  ? pick(lang)(`nach ${x.recoveredMonths} Monat${x.recoveredMonths > 1 ? 'en' : ''} wieder auf Vorniveau`, `back at the earlier level after ${x.recoveredMonths} month${x.recoveredMonths > 1 ? 's' : ''}`)
  : x.after3 !== undefined ? pick(lang)(`drei Monate später ${signed(x.after3)}`, `${signed(x.after3)} three months later`) : pick(lang)('Erholung noch offen', 'recovery still open')

// Engine topic → the conversation topics the transcript and the chat use, so they find the tile.
const TOPICS: Record<string, string[]> = {
  performance: ['wertentwicklung'], violations: ['regeln'], concentration: ['konzentration', 'waehrungen'], allocation: ['waehrungen', 'regeln'],
  liquidity: ['liquiditaet', 'notizen'], proposals: ['vorschlaege'], 'house-view': ['hausmeinung', 'cio', 'markt'], esg: ['nachhaltig', 'regeln'], risk: ['wertentwicklung'],
}
const GROUP: [RegExp, BriefGroup][] = [
  [/^portfolio\.performance/, 'Anlass'],
  [/^(contradiction\.|portfolio\.(violations|concentration|allocation|liquidity))/, 'Positionen'],
  [/^(portfolio\.(proposals|maturities)|memory\.)/, 'Verlauf'],
  [/^(context\.|profile\.)/, 'Kunde'],
  [/^cio\./, 'Hausmeinung'],
]
const rank: Record<Severity, number> = { risk: 0, warn: 1, info: 2, ok: 3 }
const LIMIT: Partial<Record<BriefGroup, number>> = { Anlass: 1, Positionen: 4, Hausmeinung: 2, Verlauf: 2, Kunde: 2 }

// Tiles from the engine: its findings, most serious first within each group, trimmed to fit 60 s.
// Titles lose the portfolio prefix; a leading figure becomes the tile's big number.
function fromFindings(client: Client, findings: EngineFinding[], lang: Lang): BriefItem[] {
  const t = pick(lang)
  const picked = new Map<BriefGroup, EngineFinding[]>()
  // Same severity: the more telling check first (a currency share says more than the asset mix).
  const prefer = (f: EngineFinding) => ['contradiction', 'portfolio.violations', 'portfolio.concentration', 'portfolio.liquidity', 'portfolio.allocation'].findIndex((c) => f.check.startsWith(c)) >>> 0
  const usable = findings.filter((f) => (f.severity !== 'ok' || f.check.startsWith('cio.')) && !(f.check.startsWith('cio.') && f.id.endsWith(':summary')) && !REJECTED_TITLE.test(f.title)).sort((a, b) => rank[a.severity] - rank[b.severity] || prefer(a) - prefer(b))
  for (const f of usable) {
    const group = GROUP.find(([re]) => re.test(f.check))?.[1] ?? (f.kind === 'action' ? 'Vorschlag' : undefined)
    if (!group) continue
    const list = picked.get(group) ?? []
    if (list.length < (LIMIT[group] ?? 1)) picked.set(group, [...list, f])
  }
  const out: BriefItem[] = []
  for (const group of ['Anlass', 'Positionen', 'Hausmeinung', 'Verlauf', 'Kunde', 'Vorschlag'] as BriefGroup[]) {
    for (const f of picked.get(group) ?? []) {
      const title = f.title.replace(/^CASE-[\w-]+:\s*/, '')
      const lead = /^([−+-]?\d[\d'.,]*\s?%)\s+(.+)$/.exec(title)
      out.push({ id: f.id, group, topics: [...(TOPICS[f.topic ?? ''] ?? []), ...(f.topic ? [f.topic] : [])], figure: lead?.[1], text: lead ? lead[2] : title, source: f.evidence[0]?.source ?? 'Engine', severity: f.severity })
    }
  }
  // The engine has no precedents yet (E3): the client's own earlier drops come from the computed facts.
  const x = client.facts?.incidents[0]
  if (x) out.splice(out.findIndex((i) => i.group === 'Vorschlag') < 0 ? out.length : out.findIndex((i) => i.group === 'Vorschlag'), 0, {
    id: 'incident', group: 'Frühere Fälle', topics: ['wertentwicklung'], figure: signed(x.change), severity: 'info', source: t('Eigener Wertverlauf', 'Own value history'),
    text: t(`im ${x.label}, ${outcomeOf(x, lang)}.`, `in ${x.label}, ${outcomeOf(x, lang)}.`),
  })
  return out
}

export function briefFor(client: Client, lang: Lang = uiLang()): BriefItem[] {
  if (briefs[client.ref]) return briefs[client.ref]
  if (client.findings?.length) return fromFindings(client, client.findings, lang)
  const f = client.facts
  if (!f) return []
  const t = pick(lang)
  const asOf = t(`Wertverlauf, Stand ${f.asOf ?? '–'}`, `Value history, as of ${f.asOf ?? '–'}`)
  const proposalsSrc = t('Vorschläge', 'Proposals'), ownHistory = t('Eigener Wertverlauf', 'Own value history')
  const out: BriefItem[] = []
  const add = (item: Omit<BriefItem, 'id'>) => out.push({ ...item, id: `${item.group}-${out.length}` })
  const p = f.performance
  const flags = client.briefing.flatMap((c) => (c.type === 'flags' ? c.items : [])).filter((x) => x.severity === 'risk' || x.severity === 'warn')

  // Why now: the largest recent move, otherwise the most serious rule breach.
  if (p && p.month <= -2) add({ topics: ['wertentwicklung'], group: 'Anlass', figure: signed(p.month), text: t(`im letzten Monat. Seit Jahresbeginn ${signed(p.ytd)}.`, `last month. Since the start of the year ${signed(p.ytd)}.`), source: asOf, severity: 'risk' })
  else if (p) add({ topics: ['wertentwicklung'], group: 'Anlass', figure: signed(p.ytd), text: t(`seit Jahresbeginn, letzter Monat ${signed(p.month)}.`, `since the start of the year, last month ${signed(p.month)}.`), source: asOf, severity: p.month < 0 ? 'warn' : 'ok' })

  if (flags[0]) add({ topics: ['regeln'], group: 'Positionen', text: `${flags[0].text}${flags.length > 1 ? t(`, dazu ${flags.length - 1} weitere Regelverletzung${flags.length > 2 ? 'en' : ''}`, `, plus ${flags.length - 1} more rule violation${flags.length > 2 ? 's' : ''}`) : ''}.`, source: t('Eignungsprüfung', 'Suitability check'), severity: flags[0].severity })
  const top = f.positions[0]
  if (top) add({ topics: ['konzentration'], group: 'Positionen', figure: share(top.share), text: `${top.name}${top.riskShare ? t(`, trägt ${share(top.riskShare)} des Risikos`, `, carries ${share(top.riskShare)} of the risk`) : ''}.`, source: t(`Grösste von ${f.positionCount} Positionen`, `Largest of ${f.positionCount} positions`), severity: top.share >= 10 ? 'warn' : 'info' })
  const foreign = f.currencies.find((c) => c.label !== 'CHF')
  if (foreign && foreign.share >= 20) add({ topics: ['waehrungen'], group: 'Positionen', figure: share(foreign.share), text: t(`in ${foreign.label}. Wechselkurse bewegen diesen Teil direkt.`, `in ${foreign.label}. Exchange rates move this part directly.`), source: t('Positions- und Kontowährungen', 'Position and account currencies'), severity: foreign.share >= 40 ? 'warn' : 'info' })

  const last = f.history[0]
  if (last) add({ topics: ['vorschlaege'], group: 'Verlauf', text: t(
    `Letzter Vorschlag ${last.date}${last.reason ? ` «${last.reason}»` : ''}: ${last.status === 'Final' ? `umgesetzt${last.trades ? `, ${last.trades} Transaktionen` : ''}` : last.status === 'Abgelehnt' ? 'abgelehnt' : 'noch im Entwurf'}.`,
    `Last proposal ${last.date}${last.reason ? ` «${last.reason}»` : ''}: ${last.status === 'Final' ? `implemented${last.trades ? `, ${last.trades} transactions` : ''}` : last.status === 'Abgelehnt' ? 'rejected' : 'still a draft'}.`,
  ), source: proposalsSrc, severity: last.status === 'Abgelehnt' ? 'warn' : 'info' })
  if (f.proposals.total > 1) add({ topics: ['vorschlaege'], group: 'Verlauf', figure: `${f.proposals.accepted}/${f.proposals.total}`, text: t(
    `Vorschlägen umgesetzt, ${f.proposals.rejected} abgelehnt.${f.proposals.rejected > f.proposals.accepted ? ' Zwei Optionen anbieten statt einer Empfehlung.' : ''}`,
    `proposals implemented, ${f.proposals.rejected} rejected.${f.proposals.rejected > f.proposals.accepted ? ' Offer two options instead of one recommendation.' : ''}`,
  ), source: proposalsSrc, severity: f.proposals.rejected > f.proposals.accepted ? 'warn' : 'info' })

  for (const x of f.incidents.slice(0, 2)) {
    add({ topics: ['wertentwicklung'], group: 'Frühere Fälle', figure: signed(x.change), text: t(`im ${x.label}, ${outcomeOf(x, lang)}.`, `in ${x.label}, ${outcomeOf(x, lang)}.`), source: ownHistory, severity: 'info' })
  }
  if (!f.incidents.length && p) add({ topics: ['wertentwicklung'], group: 'Frühere Fälle', figure: signed(p.worst.value), text: t(`war der schwächste Monat seit ${p.startLabel} (${p.worst.label}). Kein Rückgang über 3%.`, `was the weakest month since ${p.startLabel} (${p.worst.label}). No drop of more than 3%.`), source: ownHistory, severity: 'ok' })
  const rejected = f.history.find((h) => h.status === 'Abgelehnt' && h.reason && h !== last)
  if (rejected) add({ topics: ['vorschlaege'], group: 'Frühere Fälle', text: t(`«${rejected.reason}» am ${rejected.date} abgelehnt: nicht erneut vorschlagen.`, `«${rejected.reason}» rejected on ${rejected.date}: do not propose again.`), source: t('Abgelehnter Vorschlag', 'Rejected proposal'), severity: 'warn' })

  const track = client.briefing.find((c) => c.type === 'talktrack')
  const ask = track?.type === 'talktrack' ? track.ask[0] : undefined
  if (ask) add({ topics: ['notizen'], group: 'Vorschlag', text: ask.text, source: ask.source, severity: 'info' })
  return out
}
