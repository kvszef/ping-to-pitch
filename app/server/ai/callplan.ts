// Call plan for an OUTBOUND call ("Heute anrufen"): why we call, what we want out of the call, and
// which arguments work for this client. The 60-second briefing (briefing.ts) answers the other
// direction: the client calls us and the advisor needs the key facts at a glance.
//
// composeCallPlan is deterministic and needs no LLM: every line is built from findings (and from
// today's ranked reasons, server/market/route.ts) and keeps their ids. writeCallPlan lets a model
// rephrase goal, arguments and opener; a line with a number that is not in its findings is dropped
// and the template's line stays.

import { unsupportedNumbers } from '../../src/workspace/grounding.ts'
import { composeBriefing, type Complete, type Kind } from './briefing.ts'
import type { CallPlan, CallReason, PlanLine } from './callplan-types.ts'
import { day, pct, type Finding } from './findings.ts'

export type { CallPlan, CallReason, PlanLine }

const MAX_REASONS = 3
const MAX_ARGUMENTS = 4
const MAX_LINE_WORDS = 32

const rank = { risk: 0, warn: 1, info: 2, ok: 3 } as const
const clean = (title: string) => { const t = title.replace(/^[A-Z]+-\d+(?:-\d+)?: /, ''); return t.charAt(0).toUpperCase() + t.slice(1) }
const sourceOf = (f: Finding) => f.evidence[0]?.source ?? f.check
const dateOf = (f: Finding) => { const d = f.evidence.find((e) => e.date)?.date; return d ? day(d) : undefined }
const words = (text: string) => text.split(/\s+/).filter(Boolean).length
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)
// "Nestle SA (6.2%): Headline" → the holding's label, as the outbound ranking writes news reasons.
const holdingOf = (title: string) => /^(.+?) \([\d.,]+%\): /.exec(title)?.[1]

const fromFinding = (id: string, f: Finding, text = clean(f.title), extra: Partial<PlanLine> = {}): PlanLine =>
  ({ id, text, kind: f.kind, source: sourceOf(f), date: dateOf(f), severity: f.severity, findings: [f.id], ...extra })

export function composeCallPlan(ref: string, findings: Finding[], ranked: CallReason[] = []): CallPlan {
  const byId = new Map(findings.map((f) => [f.id, f]))
  const of = (prefix: string) => findings.filter((f) => f.check === prefix || f.check.startsWith(`${prefix}.`))
  const briefing = composeBriefing(ref, findings)

  // ---- why we call ------------------------------------------------------------------------------
  // Today's ranking first (news on holdings, hard findings). Then what the ranking does not score but
  // is a good reason to pick up the phone: something we promised, an open draft, a bond running out,
  // a plan of the client that needs cash. Without a ranking (list not loaded, uploaded file) the same
  // rule as the ranking applies to the findings.
  const reasons: PlanLine[] = []
  const used = new Set<string>()
  const add = (l: PlanLine) => { const key = l.findings[0] ?? l.text; if (!used.has(key) && reasons.length < MAX_REASONS) { used.add(key); reasons.push(l) } }
  ranked.forEach((r, i) => {
    const f = r.findingId ? byId.get(r.findingId) : undefined
    if (f) add(fromFinding(`reason-${i + 1}`, f))
    else if (!r.findingId && r.title) add({ id: `reason-${i + 1}`, text: r.title, kind: 'fact', source: r.kind === 'opportunity' ? 'Nachrichten: Chance' : 'Nachrichten: Risiko', severity: r.severity, findings: [], url: r.url })
  })
  if (!ranked.length) {
    const hard = findings.filter((f) => f.severity === 'risk' || (f.severity === 'warn' && f.kind === 'action')).sort((a, b) => rank[a.severity] - rank[b.severity])
    hard.slice(0, 2).forEach((f, i) => add(fromFinding(`reason-${i + 1}`, f)))
  }
  const promises = [...of('memory.promise'), ...of('memory.call-promise')]
  const draft = of('portfolio.proposals').find((f) => /:draft/.test(f.id))
  const maturing = of('portfolio.maturities').find((f) => f.kind === 'action')
  const liquidityPlan = of('context.plan').find((f) => f.topic === 'liquidity')
  const liquidity = of('portfolio.liquidity')[0]
  for (const f of [promises[0], draft, maturing, liquidityPlan]) if (f) add(fromFinding(`reason-${f.id}`, f))

  // ---- what the call should achieve ------------------------------------------------------------
  // The briefing writer already derives next steps from the findings; the goal is the step that
  // belongs to the lead reason. A news-led call first informs, then decides.
  const lead = reasons[0]
  const leadFinding = lead?.findings[0] ? byId.get(lead.findings[0]) : undefined
  const steps = briefing.actions.filter((a) => !['act-note', 'act-summary'].includes(a.id) && !a.id.startsWith('act-context.stale-note'))
  const stepLine = (a: (typeof steps)[number]): PlanLine => {
    const f = a.findings[0] ? byId.get(a.findings[0]) : undefined
    return { id: `goal-${a.id}`, text: a.text, kind: 'action', source: f ? sourceOf(f) : 'Briefing', date: f ? dateOf(f) : undefined, findings: a.findings }
  }
  const goals: PlanLine[] = []
  if (lead && !leadFinding) {
    goals.push(lead.source.endsWith('Chance')
      ? { id: 'goal-news', text: 'Chance vorstellen und Interesse klären; nur weiterverfolgen, wenn sie zu Risikoprofil und Wünschen des Kunden passt', kind: 'action', source: lead.source, findings: [], url: lead.url }
      : { id: 'goal-news', text: 'Kunde informieren, bevor er es aus der Presse erfährt, und die Haltung zur Position klären: halten, reduzieren oder absichern', kind: 'action', source: lead.source, findings: [], url: lead.url })
  }
  const forLead = leadFinding ? steps.find((a) => a.findings.includes(leadFinding.id)) : undefined
  if (forLead) goals.push(stepLine(forLead))
  else if (leadFinding?.check.startsWith('cio.')) {
    // The house-view check writes its re-checked trade into the detail: "Vorschlag: … . Danach: … ."
    const trade = /Vorschlag: (.+?)\. Danach: (.+?)\./.exec(leadFinding.detail ?? '')
    goals.push({ ...fromFinding('goal-house-view', leadFinding, trade ? `Zustimmung zur Umschichtung einholen: ${trade[1]}; danach ${trade[2]}` : 'Neue Hausmeinung vorstellen und entscheiden, ob das Portfolio in diese Richtung angepasst wird'), kind: 'action' })
  } else if (leadFinding?.fix) goals.push({ ...fromFinding('goal-fix', leadFinding, `Zustimmung einholen: ${leadFinding.fix.Reason || leadFinding.fix.SecurityPositions.map((p) => p.SecurityName).join(', ')}`), kind: 'action' })
  else if (leadFinding === draft && draft) goals.push({ ...fromFinding('goal-draft', draft, 'Entscheid zum offenen Vorschlag einholen: annehmen, anpassen oder verwerfen'), kind: 'action' })
  else if (leadFinding === liquidityPlan && liquidityPlan) goals.push({ ...fromFinding('goal-plan', liquidityPlan, `Liquiditätsbedarf klären und den Aufbau planen${liquidity?.numbers?.share !== undefined ? ` (Liquidität heute ${pct(liquidity.numbers.share)})` : ''}`), kind: 'action', findings: liquidity ? [liquidityPlan.id, liquidity.id] : [liquidityPlan.id] })
  for (const a of steps) if (goals.length < 2 && !goals.some((g) => g.id === `goal-${a.id}`)) goals.push(stepLine(a))
  if (!goals.length) goals.push({ id: 'goal-contact', text: 'Kontakt pflegen: nachfragen, ob sich Pläne, Einkommen oder Risikobereitschaft verändert haben', kind: 'action', source: 'Kein dringender Befund in den Daten', findings: [] })

  // ---- how to convince this client -------------------------------------------------------------
  // Levers, strongest first: the client's own words, how small the step is, the rule the bank has to
  // keep, the client's own plans and experience, and how this client usually decides.
  const args: PlanLine[] = []
  const arg = (label: string, f: Finding, text: string, more: Finding[] = []) => {
    if (args.length < MAX_ARGUMENTS && !args.some((a) => a.findings[0] === f.id)) args.push({ ...fromFinding(`arg-${f.id}`, f, text, { label }), findings: [f, ...more].map((x) => x.id) })
  }
  const newsLed = !!lead && !leadFinding
  // A loss or bad news on a holding: this client's own earlier drop and how long the recovery took.
  const history = of('context.history')[0]
  const shaky = (newsLed && !lead.source.endsWith('Chance')) || leadFinding?.check.startsWith('portfolio.performance') || of('profile.trait').some((f) => f.id.endsWith(':loss-reacts'))
  const ownExperience = () => { if (history && shaky) arg('Eigene Erfahrung', history, `Mit seiner eigenen Geschichte einordnen: ${history.title.charAt(0).toLowerCase()}${history.title.slice(1)}`) }
  if (newsLed) ownExperience()
  // The bank's view changed: its own reasoning is the argument (first part of the finding's detail).
  if (leadFinding?.check.startsWith('cio.') && leadFinding.detail) {
    const why = leadFinding.detail.split(/ (?=Vorschlag: |Aufstocken |Gemessen mit )/)[0]
    if (why) arg('Begründung der Bank', leadFinding, `Die Anlagestrategen begründen es so: ${why.replace(/\.$/, '')}`)
  }
  const contradictions = of('contradiction').filter((f) => f.severity === 'risk' || f.severity === 'warn').sort((a, b) => rank[a.severity] - rank[b.severity])
  const wish = contradictions[0]
  if (wish) {
    const note = wish.evidence.find((e) => e.source === 'Kundennotiz')
    arg('Eigener Wunsch', wish, `Der Kunde hat es selbst verlangt${note?.date ? ` (Notiz vom ${day(note.date)})` : ''}: ${wish.title.replace(/^Widerspruch: /, '')}`)
    if (wish.fix) {
      const { before, after } = wish.numbers ?? {}
      const n = wish.fix.SecurityPositions.length
      const safe = /Nach dem Verkauf: keine neue Warnung/.test(wish.detail ?? '')
      args.push({ ...fromFinding(`arg-fix-${wish.id}`, wish, `${n === 1 ? 'Ein einziger Verkauf genügt' : `${n} Verkäufe genügen`}: ${wish.fix.Reason || wish.fix.SecurityPositions.map((p) => p.SecurityName).join(', ')}${before !== undefined && after !== undefined ? `, Anteil ${pct(before)} → ${pct(after)}` : ''}${safe ? '. Danach keine neue Warnung' : ''}`, { label: 'Kleiner Eingriff' }), kind: 'action' })
    }
  }
  const allocation = of('portfolio.allocation').find((f) => f.severity === 'risk')
  const violation = of('portfolio.violations').filter((f) => f.severity === 'risk')[0]
  const risk = of('portfolio.risk').find((f) => f.severity === 'risk')
  const rule = [allocation, risk, violation].find((f) => f && (!leadFinding || f === leadFinding || leadFinding.check.startsWith('portfolio.')))
  if (rule) arg('Vereinbarte Strategie', rule, `Es ist die mit dem Kunden vereinbarte Bandbreite, keine Meinung: ${clean(rule.title)}${rule === violation && rule.detail ? ` (${rule.detail.replace(/\.$/, '')})` : ''}`)
  if (liquidityPlan) arg('Plan des Kunden', liquidityPlan, `An sein eigenes Ziel anknüpfen: ${liquidityPlan.title}${liquidity?.numbers?.share !== undefined ? `; Liquidität heute ${pct(liquidity.numbers.share)}` : ''}`, liquidity ? [liquidity] : [])
  ownExperience()
  const acceptance = of('portfolio.proposals').find((f) => f.numbers?.total !== undefined && f.numbers?.rejected !== undefined)
  if (acceptance?.numbers && acceptance.numbers.total >= 3) {
    const declines = acceptance.numbers.rejected / acceptance.numbers.total >= 0.4
    arg('Wie er entscheidet', acceptance, `${acceptance.title}: ${declines ? 'zwei Varianten zur Wahl stellen statt einer Empfehlung' : 'eine klare Empfehlung mit einem konkreten nächsten Schritt genügt'}`)
  }
  const houseHit = of('cio').find((f) => !f.id.endsWith(':summary') && f !== leadFinding)
  if (houseHit) arg('Hausmeinung', houseHit, `Aktuelle Hausmeinung der Bank als Aufhänger: ${houseHit.title.replace(/^Chance: /, '')}`)

  // ---- the first sentence ----------------------------------------------------------------------
  const holding = lead && !leadFinding ? holdingOf(lead.text) : undefined
  const wishText = wish && leadFinding === wish ? /«(.+?)»/.exec(wish.title)?.[1] : undefined
  const openText = wishText ? `Guten Tag, ich rufe wegen Ihres Wunsches «${wishText}» an: er ist im Portfolio noch nicht ganz umgesetzt, und ich habe eine einfache Lösung.`
    : lead && !leadFinding ? `Guten Tag, ich melde mich von mir aus: es gibt heute Neuigkeiten${holding ? ` zu ${holding}` : ''}, die Ihr Portfolio betreffen. Haben Sie zwei Minuten?`
    : leadFinding && promises.includes(leadFinding) ? 'Guten Tag, ich melde mich wie zugesagt und habe vorbereitet, was wir besprochen haben.'
    : leadFinding === draft && draft ? `Guten Tag, ich rufe wegen des offenen Vorschlags${/«(.+?)»/.exec(draft.title) ? ` «${/«(.+?)»/.exec(draft.title)![1]}»` : ''} an und möchte ihn mit Ihnen abschliessen.`
    : leadFinding?.check.startsWith('cio.') ? 'Guten Tag, unsere Anlagestrategen haben ihre Markteinschätzung angepasst, und das betrifft Ihr Portfolio direkt. Haben Sie zwei Minuten?'
    : leadFinding?.check.startsWith('portfolio.') ? 'Guten Tag, ich habe Ihr Portfolio durchgesehen und möchte eine Abweichung von Ihrer Anlagestrategie mit Ihnen besprechen. Passt es gerade?'
    : 'Guten Tag, ich wollte mich kurz melden und hören, ob sich bei Ihnen etwas verändert hat. Passt es gerade?'
  const open: PlanLine = { id: 'open', text: openText, kind: 'action', source: lead?.source ?? 'Vorlage', findings: lead?.findings ?? [] }

  const avoid = briefing.blocks.avoid.slice(0, 2).map((l): PlanLine => {
    const f = l.findings[0] ? byId.get(l.findings[0]) : undefined
    return { id: l.id, text: l.text, kind: l.kind, source: f ? sourceOf(f) : 'Briefing', date: f ? dateOf(f) : undefined, findings: l.findings }
  })

  return { ref, reasons, goals, arguments: args.slice(0, MAX_ARGUMENTS), open, tone: briefing.persona?.tone ?? [], avoid, questions: briefing.questions.slice(0, 2), phrasedBy: 'vorlage', rejected: [] }
}

// ---- LLM writing ----------------------------------------------------------------------------------
// The model gets the template and the findings behind it and rewrites goal, arguments and opener in
// the client's tone. It chooses and phrases; it cannot add a fact: every line must cite ids it was
// given and every number in it must stand in the texts behind those ids.

const WRITE_RULES = `Du bereitest einen Kundenberater einer Schweizer Bank auf einen AUSGEHENDEN Anruf vor: der Berater ruft den Kunden von sich aus an. Deutsch, Schweizer Schreibweise (ss statt ß).
Du bekommst GRÜNDE (warum heute angerufen wird), die VORLAGE eines Anrufplans und BEFUNDE aus der Analyse des Portfolios, jeder mit id. Nur das ist wahr; es gibt keine anderen Daten.
Schreibe:
- "open": EIN Satz, den der Berater wörtlich sagt, Sie-Form, höchstens 28 Wörter: Begrüssung ohne Namen, dann sofort der Anlass des Anrufs. Keine Floskeln.
- "goals": ein bis zwei Ziele des Gesprächs, jedes beginnt mit einem Verb und nennt, was der Kunde am Ende entscheiden oder zusagen soll.
- "arguments": höchstens 4 Argumente, die DIESEN Kunden überzeugen. Knüpfe an seine eigenen Worte und Wünsche, seine Pläne, seine bisherigen Entscheide und seine Erfahrung an; nenne den Nutzen für ihn. "label" = der Hebel in 2 bis 3 Wörtern, "text" = Stichwort für den Berater, höchstens 28 Wörter, im Ton unter TON.
Regeln:
- Jede Zeile nennt in "findings" die ids (aus BEFUNDE oder GRÜNDE), auf denen sie beruht. Ohne passende id keine Zeile.
- Übernimm Zahlen, Daten und Titelnamen exakt aus den zitierten Einträgen. Keine neue Zahl, nicht rechnen, nicht runden.
- Kein Druck, keine Versprechen zu Renditen, keine Ursache für Gewinne oder Verluste einzelner Positionen. Nichts erfinden.
Antworte als ein JSON-Objekt:
{"open": {"text": string, "findings": string[]}, "goals": [{"text": string, "findings": string[]}], "arguments": [{"label": string, "text": string, "findings": string[]}]}`

type ModelLine = { text?: unknown; label?: unknown; findings?: unknown }
const asLines = (v: unknown): ModelLine[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'object' && x !== null) : typeof v === 'object' && v !== null ? [v as ModelLine] : [])

/** Rewrites goal, arguments and opener with a model. Whatever fails the checks keeps the template's wording. */
export async function writeCallPlan(template: CallPlan, findings: Finding[], complete: Complete, provider: 'openai' | 'apertus'): Promise<CallPlan> {
  const byId = new Map(findings.map((f) => [f.id, f]))
  // What a line may stand on: the findings the template uses, and the reasons that are news (no finding behind them).
  const cited = new Set([...template.reasons, ...template.goals, ...template.arguments, ...template.avoid].flatMap((l) => l.findings))
  const evidenceOf = new Map<string, string>()
  // A finding's evidence: its title and detail, the dates and quotes it stands on, and the template's
  // own lines about it (deterministic, so their numbers are safe to repeat).
  const lines = [...template.reasons, ...template.goals, ...template.arguments, ...template.avoid]
  for (const id of cited) {
    const f = byId.get(id)
    if (f) evidenceOf.set(id, [f.title, f.detail ?? '', ...f.evidence.flatMap((e) => [e.quote ?? '', e.date ? day(e.date) : '']), ...lines.filter((l) => l.findings.includes(id)).map((l) => l.text)].join(' '))
  }
  for (const r of template.reasons) if (!r.findings.length) evidenceOf.set(r.id, r.text)
  const sourceLine = new Map([...template.reasons, ...template.goals, ...template.arguments].map((l) => [l.findings[0] ?? l.id, l]))

  const answer = await complete([
    { role: 'system', content: WRITE_RULES },
    { role: 'user', content: `TON: ${template.tone.join(', ') || 'neutral, sachlich'}\n\nGRÜNDE:\n${JSON.stringify(template.reasons.map((r) => ({ id: r.findings[0] ?? r.id, text: r.text, quelle: r.source })))}\n\nVORLAGE:\n${JSON.stringify({ open: template.open.text, goals: template.goals.map((g) => ({ text: g.text, findings: g.findings })), arguments: template.arguments.map((a) => ({ label: a.label, text: a.text, findings: a.findings })), nichtAnsprechen: template.avoid.map((a) => a.text) })}\n\nBEFUNDE:\n${JSON.stringify([...evidenceOf].filter(([id]) => byId.has(id)).map(([id]) => { const f = byId.get(id)!; return { id, art: f.kind, schwere: f.severity, titel: f.title, ...(f.detail ? { detail: f.detail } : {}) } }))}` },
  ])
  const a = (typeof answer === 'object' && answer !== null ? answer : {}) as Record<string, unknown>
  const rejected: CallPlan['rejected'] = []

  const accept = (id: string, text: string, citedIds: unknown, open = false): string[] | null => {
    const ids = (Array.isArray(citedIds) ? citedIds : []).filter((x): x is string => typeof x === 'string' && evidenceOf.has(x))
    const bad = unsupportedNumbers(text, ids.map((x) => evidenceOf.get(x)!).join(' '))
    if (!text || (!ids.length && !open) || bad.length || words(text) > MAX_LINE_WORDS) { if (text) rejected.push({ id, text, numbers: bad }); return null }
    return ids
  }
  const lead = template.reasons[0]
  const leadId = lead ? lead.findings[0] ?? lead.id : undefined
  const cites = new Map<PlanLine, string[]>()
  const modelCites = (l: PlanLine) => !!leadId && (cites.get(l) ?? []).includes(leadId)
  const rewrite = (block: string, v: unknown, kind: Kind | undefined): PlanLine[] => asLines(v).flatMap((m, i) => {
    const text = typeof m.text === 'string' ? m.text.trim().replace(/\.$/, '') : ''
    const ids = accept(`${block}-${i + 1}`, text, m.findings, block === 'open')
    if (!ids) return []
    const from = sourceLine.get(ids[0])
    const f = byId.get(ids[0])
    const label = typeof m.label === 'string' && m.label.trim() && words(m.label) <= 4 ? m.label.trim() : from?.label
    const out: PlanLine = { id: `${block}-${i + 1}`, text, kind: kind ?? f?.kind ?? from?.kind ?? 'interpretation', source: f ? sourceOf(f) : from?.source ?? 'Briefing', date: f ? dateOf(f) : from?.date, severity: f?.severity, findings: ids.filter((x) => byId.has(x)), url: from?.url, ...(label ? { label } : {}) }
    cites.set(out, ids)
    return [out]
  })

  const open = rewrite('open', a.open, 'action')[0]
  const goals = rewrite('goal', a.goals, 'action').slice(0, 2)
  const args = rewrite('arg', a.arguments, undefined).slice(0, MAX_ARGUMENTS)
  return {
    ...template,
    open: open ? { ...open, id: 'open', text: sentence(open.text) } : template.open,
    // The main goal belongs to the lead reason: a model goal about something else moves behind it.
    goals: (goals.length && leadId && !modelCites(goals[0]) ? [template.goals[0], ...goals] : goals.length ? goals : template.goals).slice(0, 2),
    arguments: args.length ? args : template.arguments,
    phrasedBy: provider, rejected,
  }
}
