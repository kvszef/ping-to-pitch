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
import { reasonOf, stepOf } from '../../engine/checks/cio-house-view.ts'
import { isSource, pick, stripPrefix, type Lang } from '../../engine/lang.ts'
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

export function composeCallPlan(ref: string, findings: Finding[], ranked: CallReason[] = [], lang: Lang = 'de'): CallPlan {
  const t = pick(lang)
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
  const opportunities = new Set<PlanLine>() // news reasons that are a chance, not a risk
  const add = (l: PlanLine) => { const key = l.findings[0] ?? l.text; if (used.has(key) || reasons.length >= MAX_REASONS) return false; used.add(key); reasons.push(l); return true }
  ranked.forEach((r, i) => {
    const f = r.findingId ? byId.get(r.findingId) : undefined
    if (f) add(fromFinding(`reason-${i + 1}`, f))
    else if (!r.findingId && r.title) {
      const line: PlanLine = { id: `reason-${i + 1}`, text: r.title, kind: 'fact', source: r.kind === 'opportunity' ? t('Nachrichten: Chance', 'News: opportunity') : t('Nachrichten: Risiko', 'News: risk'), severity: r.severity, findings: [], url: r.url }
      if (add(line) && r.kind === 'opportunity') opportunities.add(line)
    }
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
  const newsLed = !!lead && !leadFinding
  const chance = newsLed && opportunities.has(lead)
  const steps = briefing.actions.filter((a) => !['act-note', 'act-summary'].includes(a.id) && !a.id.startsWith('act-context.stale-note'))
  const stepLine = (a: (typeof steps)[number]): PlanLine => {
    const f = a.findings[0] ? byId.get(a.findings[0]) : undefined
    return { id: `goal-${a.id}`, text: a.text, kind: 'action', source: f ? sourceOf(f) : 'Briefing', date: f ? dateOf(f) : undefined, findings: a.findings }
  }
  const fixText = (f: Finding) => f.fix!.Reason || f.fix!.SecurityPositions.map((p) => p.SecurityName).join(', ')
  const agree = t('Zustimmung zur Umschichtung einholen', 'Get the client to agree to the rebalancing')
  const goals: PlanLine[] = []
  if (newsLed) {
    goals.push({
      id: 'goal-news', kind: 'action', source: lead.source, findings: [], url: lead.url,
      text: chance
        ? t('Chance vorstellen und Interesse klären; nur weiterverfolgen, wenn sie zu Risikoprofil und Wünschen des Kunden passt', 'Present the opportunity and find out whether the client is interested; only pursue it if it fits their risk profile and wishes')
        : t('Kunde informieren, bevor er es aus der Presse erfährt, und die Haltung zur Position klären: halten, reduzieren oder absichern', 'Inform the client before they read it in the press, and agree what to do with the position: hold, reduce or hedge'),
    })
  }
  const forLead = leadFinding ? steps.find((a) => a.findings.includes(leadFinding.id)) : undefined
  if (forLead) goals.push(stepLine(forLead))
  else if (leadFinding?.check.startsWith('cio.')) {
    // The house-view check writes its re-checked trade into the detail; without one the reason of the fix stands in.
    const trade = stepOf(leadFinding.detail)
    const text = trade ? `${agree}: ${trade.step}; ${t('danach', 'afterwards')} ${trade.after}`
      : leadFinding.fix ? `${agree}: ${fixText(leadFinding)}`
      : t('Neue Hausmeinung vorstellen und entscheiden, ob das Portfolio in diese Richtung angepasst wird', 'Present the new house view and decide whether the portfolio moves in that direction')
    goals.push({ ...fromFinding('goal-house-view', leadFinding, text), kind: 'action' })
  } else if (leadFinding?.fix) goals.push({ ...fromFinding('goal-fix', leadFinding, `${t('Zustimmung einholen', 'Get the client to agree')}: ${fixText(leadFinding)}`), kind: 'action' })
  else if (leadFinding === draft && draft) goals.push({ ...fromFinding('goal-draft', draft, t('Entscheid zum offenen Vorschlag einholen: annehmen, anpassen oder verwerfen', 'Get a decision on the open proposal: accept, adjust or drop it')), kind: 'action' })
  else if (leadFinding === liquidityPlan && liquidityPlan) goals.push({ ...fromFinding('goal-plan', liquidityPlan, `${t('Liquiditätsbedarf klären und den Aufbau planen', 'Clarify how much cash is needed and plan how to build it up')}${liquidity?.numbers?.share !== undefined ? ` (${t('Liquidität heute', 'cash today')} ${pct(liquidity.numbers.share)})` : ''}`), kind: 'action', findings: liquidity ? [liquidityPlan.id, liquidity.id] : [liquidityPlan.id] })
  for (const a of steps) if (goals.length < 2 && !goals.some((g) => g.id === `goal-${a.id}`)) goals.push(stepLine(a))
  if (!goals.length) goals.push({ id: 'goal-contact', text: t('Kontakt pflegen: nachfragen, ob sich Pläne, Einkommen oder Risikobereitschaft verändert haben', 'Keep in touch: ask whether plans, income or appetite for risk have changed'), kind: 'action', source: t('Kein dringender Befund in den Daten', 'No pressing finding in the data'), findings: [] })

  // ---- how to convince this client -------------------------------------------------------------
  // Levers, strongest first: the client's own words, how small the step is, the rule the bank has to
  // keep, the client's own plans and experience, and how this client usually decides.
  const args: PlanLine[] = []
  const arg = (label: string, f: Finding, text: string, more: Finding[] = []) => {
    if (args.length < MAX_ARGUMENTS && !args.some((a) => a.findings[0] === f.id)) args.push({ ...fromFinding(`arg-${f.id}`, f, text, { label }), findings: [f, ...more].map((x) => x.id) })
  }
  const lower = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`
  // A loss or bad news on a holding: this client's own earlier drop and how long the recovery took.
  const history = of('context.history')[0]
  const shaky = (newsLed && !chance) || leadFinding?.check.startsWith('portfolio.performance') || of('profile.trait').some((f) => f.id.endsWith(':loss-reacts'))
  const ownExperience = () => { if (history && shaky) arg(t('Eigene Erfahrung', 'Own experience'), history, `${t('Mit seiner eigenen Geschichte einordnen', 'Put it into perspective with their own history')}: ${lower(history.title)}`) }
  if (newsLed) ownExperience()
  // The bank's view changed: its own reasoning is the argument (the detail opens with it).
  if (leadFinding?.check.startsWith('cio.') && leadFinding.detail) {
    const why = reasonOf(leadFinding.detail).split(/(?<=[.!?]) /).slice(0, 2).join(' ')
    if (why) arg(t('Begründung der Bank', 'Reasoning of the bank'), leadFinding, `${t('Die Anlagestrategen begründen es so', 'How the investment strategists explain it')}: ${why.replace(/\.$/, '')}`)
  }
  const contradictions = of('contradiction').filter((f) => f.severity === 'risk' || f.severity === 'warn').sort((a, b) => rank[a.severity] - rank[b.severity])
  const wish = contradictions[0]
  if (wish) {
    const note = wish.evidence.find((e) => isSource(e.source, 'note'))
    arg(t('Eigener Wunsch', 'Own wish'), wish, `${t('Der Kunde hat es selbst verlangt', 'The client asked for it')}${note?.date ? ` (${t('Notiz vom', 'note of')} ${day(note.date)})` : ''}: ${stripPrefix(wish.title, 'contradiction')}`)
    if (wish.fix) {
      const { before, after } = wish.numbers ?? {}
      const n = wish.fix.SecurityPositions.length
      // The engine re-checks the portfolio after the sale; the stopgap finding only says so in its detail.
      const safe = wish.numbers?.newIssues === 0 || (wish.numbers?.newIssues === undefined && /Nach dem Verkauf: keine neue Warnung|After the sale: no new warning/.test(wish.detail ?? ''))
      const enough = n === 1 ? t('Ein einziger Verkauf genügt', 'One sale is enough') : t(`${n} Verkäufe genügen`, `${n} sales are enough`)
      args.push({ ...fromFinding(`arg-fix-${wish.id}`, wish, `${enough}: ${fixText(wish)}${before !== undefined && after !== undefined ? `, ${t('Anteil', 'share')} ${pct(before)} → ${pct(after)}` : ''}${safe ? t('. Danach keine neue Warnung', '. No new warning afterwards') : ''}`, { label: t('Kleiner Eingriff', 'Small step') }), kind: 'action' })
    }
  }
  const allocation = of('portfolio.allocation').find((f) => f.severity === 'risk')
  const violation = of('portfolio.violations').filter((f) => f.severity === 'risk')[0]
  const risk = of('portfolio.risk').find((f) => f.severity === 'risk')
  const rule = [allocation, risk, violation].find((f) => f && (!leadFinding || f === leadFinding || leadFinding.check.startsWith('portfolio.')))
  if (rule) arg(t('Vereinbarte Strategie', 'Agreed strategy'), rule, `${t('Es ist die mit dem Kunden vereinbarte Bandbreite, keine Meinung', 'It is the range agreed with the client, not an opinion')}: ${clean(rule.title)}${rule === violation && rule.detail ? ` (${rule.detail.replace(/\.$/, '')})` : ''}`)
  if (liquidityPlan) arg(t('Plan des Kunden', 'Plan of the client'), liquidityPlan, `${t('An sein eigenes Ziel anknüpfen', 'Tie it to their own goal')}: ${liquidityPlan.title}${liquidity?.numbers?.share !== undefined ? `; ${t('Liquidität heute', 'cash today')} ${pct(liquidity.numbers.share)}` : ''}`, liquidity ? [liquidity] : [])
  ownExperience()
  const acceptance = of('portfolio.proposals').find((f) => f.numbers?.total !== undefined && f.numbers?.rejected !== undefined)
  if (acceptance?.numbers && acceptance.numbers.total >= 3) {
    const declines = acceptance.numbers.rejected / acceptance.numbers.total >= 0.4
    arg(t('Wie er entscheidet', 'How the client decides'), acceptance, `${acceptance.title}: ${declines
      ? t('zwei Varianten zur Wahl stellen statt einer Empfehlung', 'offer two options to choose from instead of one recommendation')
      : t('eine klare Empfehlung mit einem konkreten nächsten Schritt genügt', 'one clear recommendation with a concrete next step is enough')}`)
  }
  const houseHit = of('cio').find((f) => !f.id.endsWith(':summary') && f !== leadFinding)
  if (houseHit) arg(t('Hausmeinung', 'House view'), houseHit, `${t('Aktuelle Hausmeinung der Bank als Aufhänger', 'The current house view of the bank as a hook')}: ${stripPrefix(houseHit.title, 'opportunity')}`)

  // ---- the first sentence ----------------------------------------------------------------------
  const holding = newsLed ? holdingOf(lead.text) : undefined
  const quoted = (title: string) => /«(.+?)»/.exec(title)?.[1]
  const wishText = wish && leadFinding === wish ? quoted(wish.title) : undefined
  const draftName = draft && leadFinding === draft ? quoted(draft.title) : undefined
  const openText = wishText ? t(`Guten Tag, ich rufe wegen Ihres Wunsches «${wishText}» an: er ist im Portfolio noch nicht ganz umgesetzt, und ich habe eine einfache Lösung.`, `Hello, I am calling about your wish «${wishText}»: it is not fully reflected in your portfolio yet, and I have a simple solution.`)
    : newsLed ? t(`Guten Tag, ich melde mich von mir aus: es gibt heute Neuigkeiten${holding ? ` zu ${holding}` : ''}, die Ihr Portfolio betreffen. Haben Sie zwei Minuten?`, `Hello, I am calling on my own initiative: there is news today${holding ? ` about ${holding}` : ''} that affects your portfolio. Do you have two minutes?`)
    : leadFinding && promises.includes(leadFinding) ? t('Guten Tag, ich melde mich wie zugesagt und habe vorbereitet, was wir besprochen haben.', 'Hello, I am getting back to you as promised and have prepared what we discussed.')
    : leadFinding === draft && draft ? t(`Guten Tag, ich rufe wegen des offenen Vorschlags${draftName ? ` «${draftName}»` : ''} an und möchte ihn mit Ihnen abschliessen.`, `Hello, I am calling about the open proposal${draftName ? ` «${draftName}»` : ''} and would like to settle it with you.`)
    : leadFinding?.check.startsWith('cio.') ? t('Guten Tag, unsere Anlagestrategen haben ihre Markteinschätzung angepasst, und das betrifft Ihr Portfolio direkt. Haben Sie zwei Minuten?', 'Hello, our investment strategists have changed their market view, and that affects your portfolio directly. Do you have two minutes?')
    : leadFinding?.check.startsWith('portfolio.') ? t('Guten Tag, ich habe Ihr Portfolio durchgesehen und möchte eine Abweichung von Ihrer Anlagestrategie mit Ihnen besprechen. Passt es gerade?', 'Hello, I have reviewed your portfolio and would like to discuss a deviation from your investment strategy. Is now a good time?')
    : t('Guten Tag, ich wollte mich kurz melden und hören, ob sich bei Ihnen etwas verändert hat. Passt es gerade?', 'Hello, I wanted to check in briefly and hear whether anything has changed for you. Is now a good time?')
  const open: PlanLine = { id: 'open', text: openText, kind: 'action', source: lead?.source ?? t('Vorlage', 'Template'), findings: lead?.findings ?? [] }

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

// Appended last so it wins over the German-only rule above. Numbers and quoted data stay untouched: the
// number check compares them literally.
const WRITE_ENGLISH = `- LANGUAGE (this rule overrides the rule about German): write every "text" and every "label" in English (British spelling). Keep numbers, percentages, amounts, dates and names of positions exactly as they appear in the input; text inside «…» is a quote from the data and stays verbatim.`

type ModelLine = { text?: unknown; label?: unknown; findings?: unknown }
const asLines = (v: unknown): ModelLine[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'object' && x !== null) : typeof v === 'object' && v !== null ? [v as ModelLine] : [])

/** Rewrites goal, arguments and opener with a model. Whatever fails the checks keeps the template's wording. */
export async function writeCallPlan(template: CallPlan, findings: Finding[], complete: Complete, provider: 'openai' | 'apertus', lang: Lang = 'de'): Promise<CallPlan> {
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
    { role: 'system', content: lang === 'en' ? `${WRITE_RULES}
${WRITE_ENGLISH}` : WRITE_RULES },
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
