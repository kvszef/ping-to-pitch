// A1 briefing writer. Findings in, a 60-second talk track out: four blocks (open with, must
// mention, ask, don't bring up), likely client questions, next actions and a guess at why the
// client is calling. Every line keeps the ids of the findings it stands on, so the UI can show the
// source of each sentence.
//
// composeBriefing is deterministic and needs no LLM: it is the fallback when no model is configured or it
// fails. writeBriefing lets a model write the talk track from the findings; see its comment for the checks.

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
  // E4 ranks the remaining guesses (draft, maturing bonds, recent note or proposal, weak month); without it, the old two.
  const callReasons = of('profile.call-reason').sort((a, b) => (a.numbers?.rank ?? 9) - (b.numbers?.rank ?? 9))
  if (callReasons.length) {
    // A note already turned into a plan, promise or stale-note reason above is not repeated.
    const notesUsed = new Set([liquidityPlan, promises[0], stale[0]].flatMap((f) => f?.evidence.map((e) => e.date) ?? []))
    for (const f of callReasons) {
      const subject = f.id.split(':')[2] ?? f.id
      if (subject === 'note' && f.evidence.some((e) => e.date && notesUsed.has(e.date))) continue
      reasons.push(line(subject === 'performance' ? 'reason-perf' : subject === 'draft' ? 'reason-draft' : `reason-${subject}`, f.title, 'interpretation', [f]))
    }
  } else {
    if (draft) reasons.push(line('reason-draft', `Rückfrage zum offenen Vorschlag`, 'interpretation', [draft]))
    // A monthly loss hit almost every portfolio in the same month: a weaker guess than the client's own plans.
    if (perfMonth !== undefined && perfMonth <= -0.02) reasons.push(line('reason-perf', `Wertverlust im letzten Monat (${sign(perfMonth)})`, 'interpretation', [perf]))
  }
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
  // E4: the engine's persona line and tone (register first, then hints) replace the note-based fallback when present.
  const enginePersona = of('profile.persona')[0]
  const engineTone = of('profile.tone').sort((a, b) => Number(b.id.endsWith(':register')) - Number(a.id.endsWith(':register')))
  const toneText = engineTone.length ? engineTone.map((f) => f.title.replace(/^Ton: /, '')) : tone
  const persona = enginePersona
    ? { ...line('persona', enginePersona.title.replace(/\.$/, ''), 'interpretation', [enginePersona, ...engineTone]), tone: [...new Set(toneText)] }
    : personaParts.length ? { ...line('persona', personaParts.join('; '), 'interpretation', [...personaSources, ...engineTone]), tone: [...new Set(toneText)] } : null

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

// ---- LLM writing --------------------------------------------------------------------------------
// The model writes the whole talk track from the findings (Arash's call: 10–20 s of model time is fine for
// better wording). Grounding stays deterministic: every line must cite finding ids that exist, and every
// number in it must stand in the title or detail of the findings it cites. A line that fails is dropped;
// a block left empty keeps the template's lines. Reasons and persona stay deterministic.

export type Complete = (messages: { role: 'system' | 'user'; content: string }[]) => Promise<unknown>

const MAX_FINDINGS = 40 // most severe first; keeps the prompt small enough for a fast answer
const MAX_LINE_WORDS = 30

const WRITE_RULES = `Du schreibst das 60-Sekunden-Briefing für einen Kundenberater einer Schweizer Bank, kurz bevor er mit dem Kunden spricht. Deutsch, Schweizer Schreibweise (ss statt ß).
Du bekommst BEFUNDE aus der Analyse des Kundenportfolios, jeder mit id, Art (fact/interpretation/action), Schwere (risk/warn/info/ok), Titel und Detail. Nur diese Befunde sind wahr; es gibt keine anderen Daten.
Schreibe:
- "open": EIN Satz, den der Berater wörtlich zum Kunden sagt, Sie-Form, höchstens 25 Wörter, im Ton unter TON.
- "mention": höchstens 3 Punkte, die der Berater unbedingt ansprechen muss (Risiken, Regelverletzungen, offene Vorschläge, Widersprüche zu Kundenwünschen), wichtigstes zuerst.
- "ask": höchstens 3 Fragen an den Kunden (veraltete Notizen, Pläne, was die Daten nicht beantworten).
- "avoid": höchstens 3 Themen, die der Berater NICHT anbringen soll (abgelehnte Vorschläge, Kontaktwünsche).
- "questions": höchstens 4 Fragen, die der Kunde wahrscheinlich stellt, je mit kurzer Antwort ("q", "a").
- "actions": 3 bis 5 nächste Schritte, jeder beginnt mit einem Verb und nennt Gegenstand und Grösse.
Regeln:
- Jede Zeile nennt in "findings" die ids der Befunde, auf denen sie beruht. Ohne passenden Befund keine Zeile.
- Übernimm Zahlen, Daten und Titelnamen exakt aus den zitierten Befunden. Keine neue Zahl, nicht rechnen, nicht runden.
- Stichworte für den Berater höchstens 22 Wörter. Keine Floskeln, nichts erfinden.
- Nenne keine Ursache für Gewinne oder Verluste einzelner Positionen: die Daten enthalten keine Einstandspreise.
- "kind": "fact" für Gemessenes, "interpretation" für Einschätzungen, "action" für Schritte.
Antworte als ein JSON-Objekt:
{"open": {"text": string, "findings": string[]}, "mention": [{"text": string, "kind": string, "findings": string[]}], "ask": [...], "avoid": [...], "questions": [{"q": string, "a": string, "findings": string[]}], "actions": [{"text": string, "findings": string[]}]}`

type ModelLine = { text?: unknown; kind?: unknown; findings?: unknown; q?: unknown; a?: unknown }
const asLines = (v: unknown): ModelLine[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'object' && x !== null) : typeof v === 'object' && v !== null ? [v as ModelLine] : [])
const KINDS = new Set<Kind>(['fact', 'interpretation', 'action'])

/** Writes the talk track with a model from the findings. The template supplies reasons, persona and any block the model leaves empty. */
export async function writeBriefing(template: Briefing60, findings: Finding[], complete: Complete, provider: 'openai' | 'apertus'): Promise<Briefing60> {
  const byId = new Map(findings.map((f) => [f.id, f]))
  const input = [...findings].sort(bySeverity).slice(0, MAX_FINDINGS)
    .map((f) => ({ id: f.id, art: f.kind, schwere: f.severity, titel: f.title, ...(f.detail ? { detail: f.detail } : {}) }))
  const answer = await complete([
    { role: 'system', content: WRITE_RULES },
    { role: 'user', content: `TON: ${template.persona ? `${template.persona.text}. ${template.persona.tone.join(', ')}` : 'neutral, sachlich'}\n\nBEFUNDE:\n${JSON.stringify(input)}` },
  ])
  const a = (typeof answer === 'object' && answer !== null ? answer : {}) as Record<string, unknown>
  const rejected: Briefing60['rejected'] = []

  // A model line survives only if it cites real findings and every number in it stands in them.
  const accept = (id: string, text: string, cited: unknown, open = false): string[] | null => {
    const ids = (Array.isArray(cited) ? cited : []).filter((x): x is string => typeof x === 'string' && byId.has(x))
    const evidence = ids.map((x) => `${byId.get(x)!.title} ${byId.get(x)!.detail ?? ''}`).join(' ')
    const bad = unsupportedNumbers(text, evidence)
    if (!text || (!ids.length && !open) || bad.length || words(text) > MAX_LINE_WORDS) {
      if (text) rejected.push({ id, text, numbers: bad })
      return null
    }
    return ids
  }
  const lines = (block: string, v: unknown, fallbackKind: Kind): Line[] => asLines(v).flatMap((m, i) => {
    const text = typeof m.text === 'string' ? m.text.trim() : ''
    const id = `${block}-${i + 1}`
    const ids = accept(id, text, m.findings, block === 'open')
    return ids ? [{ id, text, kind: KINDS.has(m.kind as Kind) ? (m.kind as Kind) : fallbackKind, findings: ids }] : []
  })

  const written: Record<Block, Line[]> = {
    open: lines('open', a.open, 'action').slice(0, 1).map((l) => ({ ...l, id: 'open', kind: 'action' as const })),
    mention: lines('mention', a.mention, 'fact'),
    ask: lines('ask', a.ask, 'action'),
    avoid: lines('avoid', a.avoid, 'action'),
  }
  const blocks = fitBudget(Object.fromEntries((Object.keys(written) as Block[]).map((k) => [k, written[k].length ? written[k] : template.blocks[k]])) as Record<Block, Line[]>)

  const questions = asLines(a.questions).flatMap((m, i) => {
    const q = typeof m.q === 'string' ? m.q.trim() : '', ans = typeof m.a === 'string' ? m.a.trim() : ''
    const ids = q && ans ? accept(`q-${i + 1}`, ans, m.findings) : null
    return ids && !unsupportedNumbers(q, ids.map((x) => byId.get(x)!.title).join(' ')).length ? [{ id: `q-${i + 1}`, q, a: ans, findings: ids }] : []
  }).slice(0, 4)
  const actions = lines('act', a.actions, 'action').map((l) => ({ ...l, kind: 'action' as const }))

  const count = Object.values(blocks).flat().reduce((n, l) => n + words(l.text), 0)
  return {
    ...template, blocks,
    questions: questions.length ? questions : template.questions,
    // The call note is a legal duty (FIDLEG), so it stays the last step whatever the model wrote.
    actions: actions.length ? [...actions.slice(0, 4), ...template.actions.filter((l) => l.id === 'act-note')] : template.actions,
    words: count, seconds: Math.round((count / READ_WPM) * 60), phrasedBy: provider, rejected,
  }
}
