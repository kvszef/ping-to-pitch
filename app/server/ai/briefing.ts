// A1 briefing writer. Findings in, a 60-second talk track out: four blocks (open with, must
// mention, ask, don't bring up), likely client questions, next actions and a guess at why the
// client is calling. Every line keeps the ids of the findings it stands on, so the UI can show the
// source of each sentence.
//
// composeBriefing is deterministic and needs no LLM: it is the fallback and the baseline. phraseBriefing
// lets a model reword the lines in the client's tone; a reworded line survives only if every number
// in it already stands in the template line, otherwise the template line stays.

import { unsupportedNumbers } from '../../src/workspace/grounding.ts'
import { pct, type Finding } from './findings.ts'
import { accusativeOf } from './notes.ts'

export type Kind = Finding['kind']
export type Line = { id: string; text: string; kind: Kind; findings: string[] }
export type Block = 'open' | 'mention' | 'ask' | 'avoid'

export type Briefing60 = {
  ref: string
  reasons: Line[] // why the client is probably calling, ranked, always an interpretation
  persona: (Line & { tone: string[] }) | null
  blocks: Record<Block, Line[]>
  questions: { id: string; q: string; a: string; findings: string[] }[]
  actions: Line[]
  words: number
  seconds: number // reading time of the four blocks
  budget: number
  phrasedBy: 'vorlage' | 'openai' | 'apertus'
  rejected: { id: string; text: string; numbers: string[] }[] // model lines dropped by the number check
}

export const BLOCK_TITLES: Record<Block, string> = { open: 'Einstieg', mention: 'Unbedingt ansprechen', ask: 'Nachfragen', avoid: 'Nicht ansprechen' }

const READ_WPM = 180 // silent reading, German, with numbers in every line
const BUDGET_SECONDS = 60
const MAX_WORDS = Math.round((READ_WPM * BUDGET_SECONDS) / 60) // 180
const LIMITS: Record<Block, number> = { open: 1, mention: 3, ask: 3, avoid: 3 }

const words = (text: string) => text.split(/\s+/).filter(Boolean).length
const sign = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
const rank = { risk: 0, warn: 1, info: 2, ok: 3 } as const
const bySeverity = (a: Finding, b: Finding) => rank[a.severity] - rank[b.severity]
// A fix in the engine's proposal shape, with the before and after share when the finding has them.
function fixOf(f: Finding): { summary: string; count: number; change: string } | null {
  if (!f.fix) return null
  const names = f.fix.SecurityPositions.map((p) => p.SecurityName)
  const summary = f.fix.Reason || (names.length === 1 ? `${names[0]} verkaufen` : `${names.length} Positionen anpassen`)
  const { before, after } = f.numbers ?? {}
  return { summary, count: names.length, change: before !== undefined && after !== undefined ? `, ${pct(before)} → ${pct(after)}` : '' }
}
// 'Pensionierung: noch 20 Monate …' → 'Pensionierung'; 'Veraltet: Immobilienkauf – …' → 'Immobilienkauf'
const labelOf = (f: Finding) => f.title.replace(/^(Veraltet|Offener Wunsch seit [^:]+|Seit \d+ Monaten offen): /, '').split(/: | – /)[0].replace(/^«|»$/g, '')
const line = (id: string, text: string, kind: Kind, findings: Finding[]): Line => ({ id, text, kind, findings: findings.map((f) => f.id) })
// The engine prefixes portfolio findings with the portfolio number; the talk track does not need it.
const clean = (title: string) => {
  const t = title.replace(/^[A-Z]+-\d+(?:-\d+)?: /, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const inMonths = (n?: number) => (n === undefined ? '' : n === 0 ? ' in weniger als einem Monat' : n === 1 ? ' in 1 Monat' : ` in ${n} Monaten`)
const day = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

// Rejected proposals, newest first, from either shape: the engine's one finding per proposal
// ("Abgelehnt vom 20.08.2024: «Reason»") or the stopgap's summary with the proposals as evidence.
function rejectedList(proposals: Finding[]): { reason: string; date: string; finding: Finding }[] {
  const out: { reason: string; date: string; finding: Finding }[] = []
  for (const f of proposals) {
    if (f.id.endsWith(':rejected')) for (const e of f.evidence) if (e.quote) out.push({ reason: e.quote, date: e.date ?? '', finding: f })
    const m = /^Abgelehnt(?: vom (\d{2})\.(\d{2})\.(\d{4}))?: «(.+)»/.exec(f.title)
    if (m) out.push({ reason: m[4], date: m[3] ? `${m[3]}-${m[2]}-${m[1]}` : '', finding: f })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

export function composeBriefing(ref: string, findings: Finding[]): Briefing60 {
  const of = (prefix: string) => findings.filter((f) => f.check === prefix || f.check.startsWith(`${prefix}.`))
  const contradictions = of('contradiction').filter((f) => f.severity === 'risk' || f.severity === 'warn').sort(bySeverity)
  const violations = of('portfolio.violations').sort(bySeverity)
  // The profile ceiling is the one the client signed; the strategy band comes second.
  const risks = of('portfolio.risk').filter((f) => f.severity === 'risk').sort((a, b) => Number(b.id.endsWith(':profile')) - Number(a.id.endsWith(':profile')))
  const perf = of('portfolio.performance')[0]
  const perfMonth = perf?.numbers?.lastMonth ?? perf?.numbers?.month
  const concentration = of('portfolio.concentration').find((f) => f.severity === 'risk')
  const allocationRisk = of('portfolio.allocation').find((f) => f.severity === 'risk')
  const promises = of('memory.promise')
  const stale = of('context.stale-note')
  const plans = of('context.plan')
  const liquidity = of('portfolio.liquidity')[0]
  const proposals = of('portfolio.proposals')
  const rejectedIdeas = rejectedList(proposals)
  const acceptance = proposals.find((f) => f.numbers?.total !== undefined && f.numbers?.rejected !== undefined)
  const draft = proposals.find((f) => /:draft/.test(f.id))
  const contact = of('profile.contact')
  const temperament = of('profile.temperament')

  // ---- why is the client calling --------------------------------------------------------------
  const reasons: Line[] = []
  const liquidityPlan = plans.find((f) => f.topic === 'liquidity')
  if (liquidityPlan) reasons.push(line('reason-plan', `Liquiditätsbedarf: ${labelOf(liquidityPlan)}${inMonths(liquidityPlan.numbers?.monthsLeft)}`, 'interpretation', [liquidityPlan]))
  if (promises[0]) reasons.push(line('reason-promise', `Wartet auf: ${labelOf(promises[0])}`, 'interpretation', [promises[0]]))
  if (stale[0]) reasons.push(line('reason-stale', `Vielleicht schon erledigt: ${labelOf(stale[0])} (Zeitfenster abgelaufen)`, 'interpretation', [stale[0]]))
  if (contradictions[0]?.severity === 'risk') reasons.push(line('reason-esg', 'Fragt nach dem Ausschluss, der im Portfolio nicht umgesetzt ist', 'interpretation', [contradictions[0]]))
  if (draft) reasons.push(line('reason-draft', `Rückfrage zum offenen Vorschlag`, 'interpretation', [draft]))
  // A monthly loss hit almost every portfolio in the same month: a weaker guess than the client's own plans.
  if (perfMonth !== undefined && perfMonth <= -0.02) reasons.push(line('reason-perf', `Wertverlust im letzten Monat (${sign(perfMonth)})`, 'interpretation', [perf]))
  if (!reasons.length && violations[0]) reasons.push(line('reason-violation', 'Allgemeine Überprüfung, offene Regelverletzungen', 'interpretation', [violations[0]]))

  // ---- persona and tone -----------------------------------------------------------------------
  const tone: string[] = []
  const said = [...contact, ...temperament]
  const has = (re: RegExp) => said.some((f) => re.test(f.title))
  if (has(/E-Mail|schwer erreichbar|18 Uhr|Bürozeiten/)) tone.push('kurz halten')
  if (has(/schriftliche Zusammenfassung/)) tone.push('Zusammenfassung zusagen')
  if (has(/wenig Schriftliches/)) tone.push('mündlich, diskret')
  if (has(/lehnt die meisten Vorschläge/)) tone.push('Optionen statt Empfehlung')
  if (has(/risikoscheu|defensiv/)) tone.push('beruhigend, defensiv')
  if (has(/geduldig|gelassen|Horizont/)) tone.push('sachlich, langfristig')
  const acc = acceptance?.numbers
  const declines = !!acc && acc.total >= 3 && acc.rejected / acc.total >= 0.5
  if (declines) tone.push('Optionen statt Empfehlung')
  const personaParts = said.slice(0, 2).map((f) => f.title)
  if (declines) personaParts.push(`lehnte ${acc.rejected} von ${acc.total} Vorschlägen ab`)
  const personaSources = [...said.slice(0, 2), ...(declines ? [acceptance!] : [])]
  const persona = personaParts.length ? { ...line('persona', personaParts.join('; '), 'interpretation', personaSources), tone: [...new Set(tone)] } : null

  // ---- the four blocks ------------------------------------------------------------------------
  const open: Line[] = []
  const lead = contradictions[0]
  if (reasons[0]?.id === 'reason-perf' && perf?.numbers?.ytd !== undefined) {
    open.push(line('open', `Schön, dass Sie anrufen. Ich habe Ihr Portfolio vor mir: letzter Monat ${sign(perfMonth ?? 0)}, seit Jahresbeginn ${sign(perf.numbers.ytd)}. Was beschäftigt Sie?`, 'action', [perf]))
  } else if (liquidityPlan) {
    open.push(line('open', `Schön, dass Sie anrufen. Geht es um ${accusativeOf(labelOf(liquidityPlan))}? Ich habe mir Ihre Pläne dazu notiert.`, 'action', [liquidityPlan]))
  } else if (lead?.severity === 'risk' && fixOf(lead)) {
    open.push(line('open', 'Gut, dass Sie anrufen – ich wollte mich ohnehin melden: Ihr Ausschlusswunsch ist im Portfolio noch nicht ganz umgesetzt, und ich habe eine einfache Lösung.', 'action', [lead]))
  } else if (perf?.numbers?.ytd !== undefined) {
    open.push(line('open', `Schön, von Ihnen zu hören. Ihr Portfolio steht seit Jahresbeginn bei ${sign(perf.numbers.ytd)}. Worum geht es heute?`, 'action', [perf]))
  } else {
    open.push(line('open', 'Schön, von Ihnen zu hören. Worum geht es heute?', 'action', []))
  }

  const mention: Line[] = []
  for (const c of contradictions.slice(0, 2)) {
    const fix = fixOf(c)
    mention.push(line(`mention-${c.id}`, fix
      ? `${c.title.replace(/^Widerspruch: /, '')}. Kleinste Lösung: ${fix.summary}${fix.change}.`
      : `${c.title.replace(/^Widerspruch: /, '')}. ${c.detail?.split('.')[0] ?? ''}.`, 'fact', [c]))
  }
  for (const r of risks.slice(0, 1)) mention.push(line(`mention-${r.id}`, clean(r.title), 'fact', [r]))
  const hardViolations = violations.filter((v) => v.severity === 'risk')
  const n = hardViolations.reduce((s, v) => s + (v.numbers?.count ?? 1), 0)
  // The allocation finding is computed from today's positions; the bank's violation list is an older snapshot of the same issue.
  if (allocationRisk) {
    const confirmed = !!allocationRisk.numbers?.bankFlagged
    mention.push(line(`mention-${allocationRisk.id}`, `${clean(allocationRisk.title)}${confirmed ? `; ${n} Regelverletzung${n === 1 ? '' : 'en'} der Bank offen` : ''}`, 'fact', confirmed ? [allocationRisk, ...hardViolations] : [allocationRisk]))
  }
  if (hardViolations.length && !allocationRisk?.numbers?.bankFlagged) {
    const top = hardViolations[0]
    mention.push(line('mention-violations', n > 1 ? `${n} Regelverletzungen offen, wichtigste: ${clean(top.title)}` : `Regelverletzung offen: ${clean(top.title)}`, 'fact', hardViolations))
  }
  for (const p of promises) mention.push(line(`mention-${p.id}`, p.title, 'action', [p]))
  if (concentration) mention.push(line(`mention-${concentration.id}`, clean(concentration.title), 'fact', [concentration]))
  if (draft) mention.push(line(`mention-${draft.id}`, clean(draft.title), 'action', [draft]))
  if (perf && perf.severity === 'warn' && reasons[0]?.id !== 'reason-perf') mention.push(line('mention-perf', clean(perf.title), 'fact', [perf]))

  const ask: Line[] = []
  for (const s of stale) ask.push(line(`ask-${s.id}`, s.detail ?? `Ist «${s.title}» noch aktuell?`, 'action', [s]))
  for (const p of plans.filter((f) => f.detail)) {
    const q = p.detail!.split('. ').filter((part) => part.endsWith('?')).join(' ') || p.detail!
    const withLiquidity = p.topic === 'liquidity' && liquidity?.numbers?.share !== undefined ? `${q} (Liquidität heute ${pct(liquidity.numbers.share)})` : q
    ask.push(line(`ask-${p.id}`, withLiquidity, 'action', p.topic === 'liquidity' && liquidity ? [p, liquidity] : [p]))
  }
  for (const u of of('contradiction.unverifiable')) ask.push(line(`ask-${u.id}`, `${u.title.replace(/ ist vermerkt, lässt sich aber nicht prüfen$/, '')}: Titel gemeinsam durchgehen, die Daten reichen nicht zur Prüfung.`, 'action', [u]))

  const avoid: Line[] = []
  const reasonsSeen = new Set<string>()
  for (const r of rejectedIdeas) {
    if (reasonsSeen.has(r.reason) || reasonsSeen.size >= 2) continue
    reasonsSeen.add(r.reason)
    const same = rejectedIdeas.filter((x) => x.reason === r.reason).length
    const when = r.date ? ` am ${day(r.date)}` : ''
    avoid.push(line(`avoid-rejected-${reasonsSeen.size}`, `Nicht erneut vorschlagen: «${r.reason}» (abgelehnt${when}${same > 1 ? `, ${same}× insgesamt` : ''})`, 'action', rejectedIdeas.filter((x) => x.reason === r.reason).map((x) => x.finding)))
  }
  for (const f of said.filter((f) => f.detail)) avoid.push(line(`avoid-${f.id}`, f.detail!, 'action', [f]))

  const blocks = fitBudget({ open, mention, ask, avoid })

  // ---- likely questions and next actions ------------------------------------------------------
  const questions: Briefing60['questions'] = []
  if (perf) questions.push({ id: 'q-perf', q: 'Wie hat sich mein Portfolio entwickelt?', a: `${clean(perf.title)}. ${perf.detail?.split('. ').slice(0, 2).join('. ') ?? ''}.`.replace(/\.\.$/, '.').trim(), findings: [perf.id] })
  if (lead) {
    const n = lead.numbers ?? {}
    const top = lead.evidence.find((e) => e.source === 'Position')?.quote?.split(':')[0]
    questions.push({ id: 'q-esg', q: 'Habe ich trotz meines Wunsches Energie- oder Öltitel?', a: `Ja: ${pct(n.total ?? 0)} des Vermögens, ${(n.direct ?? 0) <= 0.0005 ? 'alles' : `davon ${pct(n.viaFunds ?? 0)}`} über Fonds${top ? `, grösster Anteil über ${top}` : ''}.`, findings: [lead.id] })
  } else {
    const ok = of('contradiction').find((f) => f.severity === 'ok')
    if (ok) questions.push({ id: 'q-esg', q: 'Wird mein Ausschlusswunsch eingehalten?', a: ok.title.replace(/^Wunsch /, 'Ja, Wunsch '), findings: [ok.id] })
  }
  if (liquidityPlan && liquidity) questions.push({ id: 'q-liquidity', q: 'Wie viel kann ich kurzfristig beziehen?', a: `${liquidity.title}. ${liquidityPlan.title}.`, findings: [liquidity.id, liquidityPlan.id] })
  if (hardViolations.length) questions.push({ id: 'q-ok', q: 'Ist mit meinem Portfolio alles in Ordnung?', a: `Es gibt ${hardViolations.length} offene Regelverletzung${hardViolations.length > 1 ? 'en' : ''}, u. a.: ${clean(hardViolations[0].title)}.`, findings: hardViolations.map((f) => f.id) })
  if (risks[0]) questions.push({ id: 'q-risk', q: 'Warum schwankt mein Portfolio so stark?', a: `${clean(risks[0].title)}.${risks[0].detail ? ` ${risks[0].detail}` : ''}`, findings: [risks[0].id] })

  const actions: Line[] = []
  const leadFix = lead && fixOf(lead)
  if (lead && leadFix) {
    const sale = lead.evidence.find((e) => e.source === 'Vorschlag')?.quote
    actions.push(line('act-fix', `${sale && leadFix.count === 1 ? sale : leadFix.summary} vorschlagen${leadFix.change ? `: Anteil${leadFix.change.replace(/^, /, ' ')}` : ''}`, 'action', [lead]))
  }
  const maxVola = risks[0]?.numbers?.maxVola ?? risks[0]?.numbers?.volaMax ?? risks[0]?.numbers?.max
  if (maxVola !== undefined) actions.push(line('act-risk', `Risiko senken: Volatilität auf höchstens ${pct(maxVola)} zurückführen`, 'action', [risks[0]]))
  if (hardViolations[0]) actions.push(line('act-violations', `Regelverletzungen bereinigen, zuerst: ${clean(hardViolations[0].title)}`, 'action', hardViolations))
  for (const m of of('portfolio.maturities').filter((f) => f.kind === 'action').slice(0, 1)) actions.push(line(`act-${m.id}`, clean(m.title), 'action', [m]))
  for (const p of promises) actions.push(line(`act-${p.id}`, `${labelOf(p)} vorbereiten und nachreichen`, 'action', [p]))
  for (const s of stale.slice(0, 1)) actions.push(line(`act-${s.id}`, 'Veraltete Kundennotiz nach dem Gespräch aktualisieren', 'action', [s]))
  if (has(/schriftliche Zusammenfassung/)) actions.push(line('act-summary', 'Schriftliche Zusammenfassung nach dem Gespräch senden', 'action', contact.filter((f) => /schriftliche Zusammenfassung/.test(f.title))))
  actions.push(line('act-note', 'Gesprächsnotiz nach dem Anruf bestätigen', 'action', []))

  const all = [...blocks.open, ...blocks.mention, ...blocks.ask, ...blocks.avoid]
  const count = all.reduce((n, l) => n + words(l.text), 0)
  return {
    ref, reasons: reasons.slice(0, 3), persona, blocks, questions: questions.slice(0, 4), actions: actions.slice(0, 5),
    words: count, seconds: Math.round((count / READ_WPM) * 60), budget: BUDGET_SECONDS, phrasedBy: 'vorlage', rejected: [],
  }
}

// Keeps each block within its line limit, then drops the last lines of the longest blocks until the
// whole track fits the reading budget. The first line of every block always stays.
function fitBudget(blocks: Record<Block, Line[]>): Record<Block, Line[]> {
  const out = Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, v.slice(0, LIMITS[k as Block])])) as Record<Block, Line[]>
  const total = () => Object.values(out).flat().reduce((n, l) => n + words(l.text), 0)
  const order: Block[] = ['avoid', 'ask', 'mention']
  while (total() > MAX_WORDS) {
    const block = order.find((b) => out[b].length > 1)
    if (!block) break
    out[block] = out[block].slice(0, -1)
  }
  return out
}

// ---- LLM phrasing -------------------------------------------------------------------------------

export type Complete = (messages: { role: 'system' | 'user'; content: string }[]) => Promise<unknown>

const PHRASE_RULES = `Du formulierst das Gesprächs-Briefing für einen Kundenberater einer Schweizer Bank um. Deutsch, Schweizer Schreibweise (ss statt ß).
Du bekommst Zeilen mit id und text. Formuliere jede Zeile natürlicher und knapper, so wie ein erfahrener Berater sie sich notieren würde.
- "open" ist ein Satz, den der Berater wörtlich zum Kunden sagt: Sie-Form, höchstens 25 Wörter, im Ton der Angaben unter TON.
- Alle anderen Zeilen sind Stichworte für den Berater, höchstens 22 Wörter.
- Übernimm jede Zahl, jedes Datum und jeden Titelnamen exakt so, wie er in der Zeile steht. Füge KEINE neue Zahl hinzu und rechne nicht.
- Erfinde nichts dazu. Keine Floskeln.
- Nenne keine Ursache für Gewinne oder Verluste einzelner Positionen: die Daten enthalten keine Einstandspreise.
Antworte als JSON: {"lines": [{"id": string, "text": string}]}, gleiche ids, gleiche Reihenfolge.`

/** Rewords the lines with a model. Lines that fail the number check keep their template text. */
export async function phraseBriefing(b: Briefing60, complete: Complete, provider: 'openai' | 'apertus'): Promise<Briefing60> {
  const targets: { id: string; text: string }[] = [
    ...(Object.entries(b.blocks) as [Block, Line[]][]).flatMap(([block, ls]) => ls.map((l) => ({ id: block === 'open' ? 'open' : `${block}:${l.id}`, text: l.text }))),
    ...b.actions.map((l) => ({ id: `actions:${l.id}`, text: l.text })),
  ]
  const answer = await complete([
    { role: 'system', content: PHRASE_RULES },
    { role: 'user', content: `TON: ${b.persona ? `${b.persona.text}. ${b.persona.tone.join(', ')}` : 'neutral, sachlich'}\n\nZEILEN:\n${JSON.stringify(targets)}` },
  ])
  const lines = (answer as { lines?: unknown }).lines
  const byId = new Map(Array.isArray(lines) ? lines.filter((l): l is { id: string; text: string } => typeof l?.id === 'string' && typeof l?.text === 'string').map((l) => [l.id, l.text.trim()]) : [])
  const rejected: Briefing60['rejected'] = []
  const pick = (key: string, original: Line): Line => {
    const text = byId.get(key)
    if (!text) return original
    const bad = unsupportedNumbers(text, original.text)
    if (bad.length || words(text) > words(original.text) * 1.4 + 4) {
      rejected.push({ id: original.id, text, numbers: bad })
      return original
    }
    return { ...original, text }
  }
  const blocks = Object.fromEntries((Object.entries(b.blocks) as [Block, Line[]][]).map(([block, ls]) => [block, ls.map((l) => pick(block === 'open' ? 'open' : `${block}:${l.id}`, l))])) as Record<Block, Line[]>
  const actions = b.actions.map((l) => pick(`actions:${l.id}`, l))
  const count = Object.values(blocks).flat().reduce((n, l) => n + words(l.text), 0)
  return { ...b, blocks, actions, words: count, seconds: Math.round((count / READ_WPM) * 60), phrasedBy: provider, rejected }
}
