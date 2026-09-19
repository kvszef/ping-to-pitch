// A1 briefing writer. Findings in, a 60-second talk track out: four blocks (open with, must
// mention, ask, don't bring up), likely client questions, next actions and a guess at why the
// client is calling. Every line keeps the ids of the findings it stands on, so the UI can show the
// source of each sentence.
//
// composeBriefing is deterministic and needs no LLM: it is the fallback when no model is configured or it
// fails. writeBriefing lets a model write the talk track from the findings; see its comment for the checks.
//
// Language: composeBriefing(ref, findings, lang) writes every sentence in `lang` (German when absent) and
// expects the findings in the same language (run(raw, { …, lang })). Finding titles it has to read are read
// through engine/lang.ts, so both languages parse. The briefing carries its language; writeBriefing and the
// cards take it from there.

import { unsupportedNumbers } from '../../src/workspace/grounding.ts'
import { pct, type Finding } from './findings.ts'
import { accusativeOf, OPEN_WISH_PREFIX } from './notes.ts'
import { hasPrefix, isSource, pick, REJECTED_TITLE, stripPrefix, type Lang, type PrefixKey } from '../../engine/lang.ts'

export type Kind = Finding['kind']
export type Line = { id: string; text: string; kind: Kind; findings: string[] }
export type Block = 'open' | 'mention' | 'ask' | 'avoid'

export type Briefing60 = {
  ref: string
  lang?: Lang // the language every text in here is written in; absent in older objects: German
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
const BLOCK_TITLES_EN: Record<Block, string> = { open: 'Open with', mention: 'Must mention', ask: 'Ask', avoid: 'Don\'t bring up' }
export const blockTitles = (lang?: Lang): Record<Block, string> => (lang === 'en' ? BLOCK_TITLES_EN : BLOCK_TITLES)

const READ_WPM = 180 // silent reading, German, with numbers in every line
const READ_WPM_EN = 200 // English words are shorter, so the same minute holds a few more
const wpm = (lang?: Lang) => (lang === 'en' ? READ_WPM_EN : READ_WPM)
const BUDGET_SECONDS = 60
const maxWords = (lang?: Lang) => Math.round((wpm(lang) * BUDGET_SECONDS) / 60) // 180 German, 200 English
const LIMITS: Record<Block, number> = { open: 1, mention: 3, ask: 3, avoid: 3 }

const words = (text: string) => text.split(/\s+/).filter(Boolean).length
const sign = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
const rank = { risk: 0, warn: 1, info: 2, ok: 3 } as const
const bySeverity = (a: Finding, b: Finding) => rank[a.severity] - rank[b.severity]
// A fix in the engine's proposal shape, with the before and after share when the finding has them.
function fixOf(f: Finding, lang?: Lang): { summary: string; count: number; change: string } | null {
  if (!f.fix) return null
  const t = pick(lang)
  const names = f.fix.SecurityPositions.map((p) => p.SecurityName)
  const summary = f.fix.Reason || (names.length === 1 ? t(`${names[0]} verkaufen`, `Sell ${names[0]}`) : t(`${names.length} Positionen anpassen`, `Adjust ${names.length} positions`))
  const { before, after } = f.numbers ?? {}
  return { summary, count: names.length, change: before !== undefined && after !== undefined ? `, ${pct(before)} → ${pct(after)}` : '' }
}
// 'Pensionierung: noch 20 Monate …' → 'Pensionierung'; 'Veraltet: Immobilienkauf – …' / 'Outdated: Property purchase – …' → the label.
// One leading prefix comes off, in either language; '<Label>: …' and '<Label> – …' hold in both.
const LABEL_PREFIXES: PrefixKey[] = ['outdated', 'promised', 'openFromCall']
function labelOf(f: Finding): string {
  const key = LABEL_PREFIXES.find((k) => hasPrefix(f.title, k))
  const rest = key ? stripPrefix(f.title, key) : f.title.replace(OPEN_WISH_PREFIX, '').replace(/^(?:Seit \d+ Monaten offen|Open for \d+ months): /, '')
  return rest.split(/: | – /)[0].replace(/^«|»$/g, '')
}
const line = (id: string, text: string, kind: Kind, findings: Finding[]): Line => ({ id, text, kind, findings: findings.map((f) => f.id) })
// The engine prefixes portfolio findings with the portfolio number; the talk track does not need it. Numbers
// come in many shapes ('CASE-004-01', '2291.1', 'P_77'): a short first token without spaces that holds a digit.
export const PORTFOLIO_PREFIX = /^(?=[^\s:«%]{1,24}: )[^\s:«%]*\d[^\s:«%]*: /
const clean = (title: string) => {
  const t = title.replace(PORTFOLIO_PREFIX, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const inMonths = (n: number | undefined, lang?: Lang) => (n === undefined ? '' : n === 0 ? pick(lang)(' in weniger als einem Monat', ' in less than a month') : n === 1 ? pick(lang)(' in 1 Monat', ' in 1 month') : pick(lang)(` in ${n} Monaten`, ` in ${n} months`))
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const day = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

// Rejected proposals, newest first, from either shape: the engine's one finding per proposal
// ("Abgelehnt vom 20.08.2024: «Reason»" / "Rejected on 20.08.2024: «Reason»") or the stopgap's summary with the proposals as evidence.
function rejectedList(proposals: Finding[]): { reason: string; date: string; finding: Finding }[] {
  const out: { reason: string; date: string; finding: Finding }[] = []
  for (const f of proposals) {
    if (f.id.endsWith(':rejected')) for (const e of f.evidence) if (e.quote) out.push({ reason: e.quote, date: e.date ?? '', finding: f })
    const m = REJECTED_TITLE.exec(f.title)
    if (m) out.push({ reason: m[4], date: m[3] ? `${m[3]}-${m[2]}-${m[1]}` : '', finding: f })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

export function composeBriefing(ref: string, findings: Finding[], lang?: Lang): Briefing60 {
  const t = pick(lang)
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
  // memory.promise: a client wish read from notes (server/ai/provisional-findings.ts).
  // memory.call-promise: a promise the advisor made on a previous confirmed call (engine/checks/memory-call-promise.ts, A3).
  // Same shape, same treatment here: something the advisor is on the hook for.
  promises.push(...of('memory.call-promise'))

  // ---- why is the client calling --------------------------------------------------------------
  const reasons: Line[] = []
  const liquidityPlan = plans.find((f) => f.topic === 'liquidity')
  if (liquidityPlan) reasons.push(line('reason-plan', `${t('Liquiditätsbedarf', 'Liquidity need')}: ${labelOf(liquidityPlan)}${inMonths(liquidityPlan.numbers?.monthsLeft, lang)}`, 'interpretation', [liquidityPlan]))
  if (promises[0]) reasons.push(line('reason-promise', `${t('Wartet auf', 'Waiting for')}: ${labelOf(promises[0])}`, 'interpretation', [promises[0]]))
  if (stale[0]) reasons.push(line('reason-stale', t(`Vielleicht schon erledigt: ${labelOf(stale[0])} (Zeitfenster abgelaufen)`, `May already be done: ${labelOf(stale[0])} (time window has passed)`), 'interpretation', [stale[0]]))
  if (contradictions[0]?.severity === 'risk') reasons.push(line('reason-esg', t('Fragt nach dem Ausschluss, der im Portfolio nicht umgesetzt ist', 'Asks about the exclusion the portfolio does not respect yet'), 'interpretation', [contradictions[0]]))
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
    if (draft) reasons.push(line('reason-draft', t('Rückfrage zum offenen Vorschlag', 'Question about the open proposal'), 'interpretation', [draft]))
    // A monthly loss hit almost every portfolio in the same month: a weaker guess than the client's own plans.
    if (perfMonth !== undefined && perfMonth <= -0.02) reasons.push(line('reason-perf', t(`Wertverlust im letzten Monat (${sign(perfMonth)})`, `Loss in value last month (${sign(perfMonth)})`), 'interpretation', [perf]))
  }
  if (!reasons.length && violations[0]) reasons.push(line('reason-violation', t('Allgemeine Überprüfung, offene Regelverletzungen', 'General review, open rule violations'), 'interpretation', [violations[0]]))

  // ---- persona and tone -----------------------------------------------------------------------
  const tone: string[] = []
  const said = [...contact, ...temperament]
  // The note titles come from notes.ts in the briefing's language, so every pattern has its English twin.
  const has = (de: RegExp, en: RegExp) => said.some((f) => (lang === 'en' ? en : de).test(f.title))
  const WRITTEN_SUMMARY: [RegExp, RegExp] = [/schriftliche Zusammenfassung/, /written summary/]
  if (has(/E-Mail|schwer erreichbar|18 Uhr|Bürozeiten/, /email|[Hh]ard to reach|6 pm|business hours/)) tone.push(t('kurz halten', 'keep it short'))
  if (has(...WRITTEN_SUMMARY)) tone.push(t('Zusammenfassung zusagen', 'promise a summary'))
  if (has(/wenig Schriftliches/, /little as possible in writing/)) tone.push(t('mündlich, diskret', 'verbal, discreet'))
  if (has(/lehnt die meisten Vorschläge/, /declines most proposals/)) tone.push(t('Optionen statt Empfehlung', 'options rather than a recommendation'))
  if (has(/risikoscheu|defensiv/, /risk-averse|defensive/)) tone.push(t('beruhigend, defensiv', 'reassuring, defensive'))
  if (has(/geduldig|gelassen|Horizont/, /patient|calmly|Long horizon/)) tone.push(t('sachlich, langfristig', 'matter-of-fact, long-term'))
  const acc = acceptance?.numbers
  const declines = !!acc && acc.total >= 3 && acc.rejected / acc.total >= 0.5
  if (declines) tone.push(t('Optionen statt Empfehlung', 'options rather than a recommendation'))
  const personaParts = said.slice(0, 2).map((f) => f.title)
  if (declines) personaParts.push(t(`lehnte ${acc.rejected} von ${acc.total} Vorschlägen ab`, `declined ${acc.rejected} of ${acc.total} proposals`))
  const personaSources = [...said.slice(0, 2), ...(declines ? [acceptance!] : [])]
  // E4: the engine's persona line and tone (register first, then hints) replace the note-based fallback when present.
  const enginePersona = of('profile.persona')[0]
  const engineTone = of('profile.tone').sort((a, b) => Number(b.id.endsWith(':register')) - Number(a.id.endsWith(':register')))
  const toneText = engineTone.length ? engineTone.map((f) => stripPrefix(f.title, 'tone')) : tone
  const persona = enginePersona
    ? { ...line('persona', enginePersona.title.replace(/\.$/, ''), 'interpretation', [enginePersona, ...engineTone]), tone: [...new Set(toneText)] }
    : personaParts.length ? { ...line('persona', personaParts.join('; '), 'interpretation', [...personaSources, ...engineTone]), tone: [...new Set(toneText)] } : null

  // ---- the four blocks ------------------------------------------------------------------------
  const open: Line[] = []
  const lead = contradictions[0]
  if (reasons[0]?.id === 'reason-perf' && perf?.numbers?.ytd !== undefined) {
    open.push(line('open', t(`Schön, dass Sie anrufen. Ich habe Ihr Portfolio vor mir: letzter Monat ${sign(perfMonth ?? 0)}, seit Jahresbeginn ${sign(perf.numbers.ytd)}. Was beschäftigt Sie?`,
      `Good of you to call. I have your portfolio in front of me: last month ${sign(perfMonth ?? 0)}, year to date ${sign(perf.numbers.ytd)}. What is on your mind?`), 'action', [perf]))
  } else if (liquidityPlan) {
    open.push(line('open', t(`Schön, dass Sie anrufen. Geht es um ${accusativeOf(labelOf(liquidityPlan))}? Ich habe mir Ihre Pläne dazu notiert.`,
      `Good of you to call. Is this about your ${lowerFirst(labelOf(liquidityPlan))}? I have your plans on file.`), 'action', [liquidityPlan]))
  } else if (lead?.severity === 'risk' && fixOf(lead, lang)) {
    open.push(line('open', t('Gut, dass Sie anrufen – ich wollte mich ohnehin melden: Ihr Ausschlusswunsch ist im Portfolio noch nicht ganz umgesetzt, und ich habe eine einfache Lösung.',
      'Good that you called – I was about to get in touch anyway: your exclusion wish is not fully reflected in the portfolio yet, and I have a simple fix.'), 'action', [lead]))
  } else if (perf?.numbers?.ytd !== undefined) {
    open.push(line('open', t(`Schön, von Ihnen zu hören. Ihr Portfolio steht seit Jahresbeginn bei ${sign(perf.numbers.ytd)}. Worum geht es heute?`,
      `Good to hear from you. Your portfolio stands at ${sign(perf.numbers.ytd)} year to date. What can I do for you today?`), 'action', [perf]))
  } else {
    open.push(line('open', t('Schön, von Ihnen zu hören. Worum geht es heute?', 'Good to hear from you. What can I do for you today?'), 'action', []))
  }

  const mention: Line[] = []
  for (const c of contradictions.slice(0, 2)) {
    const fix = fixOf(c, lang)
    mention.push(line(`mention-${c.id}`, fix
      ? `${stripPrefix(c.title, 'contradiction')}. ${t('Kleinste Lösung', 'Smallest fix')}: ${fix.summary}${fix.change}.`
      : `${stripPrefix(c.title, 'contradiction')}. ${c.detail?.split('.')[0] ?? ''}.`, 'fact', [c]))
  }
  for (const r of risks.slice(0, 1)) mention.push(line(`mention-${r.id}`, clean(r.title), 'fact', [r]))
  // N3: an imported statement from another bank. The advisor uploaded it for this call, so it is named.
  const exCustody = of('portfolio.ex-custody')
  for (const x of exCustody.slice(0, 1)) mention.push(line(`mention-${x.id}`, x.title, 'fact', [x]))
  const hardViolations = violations.filter((v) => v.severity === 'risk')
  const n = hardViolations.reduce((s, v) => s + (v.numbers?.count ?? 1), 0)
  // The allocation finding is computed from today's positions; the bank's violation list is an older snapshot of the same issue.
  if (allocationRisk) {
    const confirmed = !!allocationRisk.numbers?.bankFlagged
    mention.push(line(`mention-${allocationRisk.id}`, `${clean(allocationRisk.title)}${confirmed ? t(`; ${n} Regelverletzung${n === 1 ? '' : 'en'} der Bank offen`, `; ${n} rule violation${n === 1 ? '' : 's'} flagged by the bank still open`) : ''}`, 'fact', confirmed ? [allocationRisk, ...hardViolations] : [allocationRisk]))
  }
  if (hardViolations.length && !allocationRisk?.numbers?.bankFlagged) {
    const top = hardViolations[0]
    mention.push(line('mention-violations', n > 1 ? t(`${n} Regelverletzungen offen, wichtigste: ${clean(top.title)}`, `${n} rule violations open, most important: ${clean(top.title)}`) : t(`Regelverletzung offen: ${clean(top.title)}`, `Rule violation open: ${clean(top.title)}`), 'fact', hardViolations))
  }
  for (const p of promises) mention.push(line(`mention-${p.id}`, p.title, 'action', [p]))
  if (concentration) mention.push(line(`mention-${concentration.id}`, clean(concentration.title), 'fact', [concentration]))
  if (draft) mention.push(line(`mention-${draft.id}`, clean(draft.title), 'action', [draft]))
  if (perf && perf.severity === 'warn' && reasons[0]?.id !== 'reason-perf') mention.push(line('mention-perf', clean(perf.title), 'fact', [perf]))

  const ask: Line[] = []
  for (const s of stale) ask.push(line(`ask-${s.id}`, s.detail ?? t(`Ist «${s.title}» noch aktuell?`, `Is «${s.title}» still current?`), 'action', [s]))
  for (const p of plans.filter((f) => f.detail)) {
    const q = p.detail!.split('. ').filter((part) => part.endsWith('?')).join(' ') || p.detail!
    const withLiquidity = p.topic === 'liquidity' && liquidity?.numbers?.share !== undefined ? t(`${q} (Liquidität heute ${pct(liquidity.numbers.share)})`, `${q} (liquidity today ${pct(liquidity.numbers.share)})`) : q
    ask.push(line(`ask-${p.id}`, withLiquidity, 'action', p.topic === 'liquidity' && liquidity ? [p, liquidity] : [p]))
  }
  for (const u of of('contradiction.unverifiable')) ask.push(line(`ask-${u.id}`, `${u.title.replace(/ ist vermerkt, lässt sich aber nicht prüfen$| is noted but cannot be verified$/, '')}: ${t('Titel gemeinsam durchgehen, die Daten reichen nicht zur Prüfung.', 'go through the securities together, the data is not enough to check it.')}`, 'action', [u]))

  const avoid: Line[] = []
  const reasonsSeen = new Set<string>()
  for (const r of rejectedIdeas) {
    if (reasonsSeen.has(r.reason) || reasonsSeen.size >= 2) continue
    reasonsSeen.add(r.reason)
    const same = rejectedIdeas.filter((x) => x.reason === r.reason).length
    const when = r.date ? `${t(' am', ' on')} ${day(r.date)}` : ''
    avoid.push(line(`avoid-rejected-${reasonsSeen.size}`, t(`Nicht erneut vorschlagen: «${r.reason}» (abgelehnt${when}${same > 1 ? `, ${same}× insgesamt` : ''})`, `Do not propose again: «${r.reason}» (rejected${when}${same > 1 ? `, ${same}× in total` : ''})`), 'action', rejectedIdeas.filter((x) => x.reason === r.reason).map((x) => x.finding)))
  }
  for (const f of said.filter((f) => f.detail)) avoid.push(line(`avoid-${f.id}`, f.detail!, 'action', [f]))

  const blocks = fitBudget({ open, mention, ask, avoid }, lang)

  // ---- likely questions and next actions ------------------------------------------------------
  const questions: Briefing60['questions'] = []
  if (perf) questions.push({ id: 'q-perf', q: t('Wie hat sich mein Portfolio entwickelt?', 'How has my portfolio performed?'), a: `${clean(perf.title)}. ${perf.detail?.split('. ').slice(0, 2).join('. ') ?? ''}.`.replace(/\.\.$/, '.').trim(), findings: [perf.id] })
  if (lead) {
    const n = lead.numbers ?? {}
    const top = lead.evidence.find((e) => isSource(e.source, 'position'))?.quote?.split(':')[0]
    questions.push({ id: 'q-esg', q: t('Habe ich trotz meines Wunsches Energie- oder Öltitel?', 'Do I hold energy or oil stocks despite my wish?'),
      a: t(`Ja: ${pct(n.total ?? 0)} des Vermögens, ${(n.direct ?? 0) <= 0.0005 ? 'alles' : `davon ${pct(n.viaFunds ?? 0)}`} über Fonds${top ? `, grösster Anteil über ${top}` : ''}.`,
        `Yes: ${pct(n.total ?? 0)} of total assets, ${(n.direct ?? 0) <= 0.0005 ? 'all' : `of which ${pct(n.viaFunds ?? 0)}`} through funds${top ? `, the largest share through ${top}` : ''}.`), findings: [lead.id] })
  } else {
    const ok = of('contradiction').find((f) => f.severity === 'ok')
    if (ok) questions.push({ id: 'q-esg', q: t('Wird mein Ausschlusswunsch eingehalten?', 'Is my exclusion wish being respected?'), a: hasPrefix(ok.title, 'wish') ? `${t('Ja, Wunsch ', 'Yes, wish ')}${stripPrefix(ok.title, 'wish')}` : ok.title, findings: [ok.id] })
  }
  if (exCustody[0]) questions.push({ id: 'q-excustody', q: t('Wie steht mein Vermögen insgesamt da, mit dem Depot bei der anderen Bank?', 'How do my assets look overall, including the account at the other bank?'), a: `${exCustody[0].title}. ${t('Das Fremddepot ist in der Analyse enthalten.', 'The external custody account is included in the analysis.')}`, findings: [exCustody[0].id] })
  if (liquidityPlan && liquidity) questions.push({ id: 'q-liquidity', q: t('Wie viel kann ich kurzfristig beziehen?', 'How much can I withdraw at short notice?'), a: `${liquidity.title}. ${liquidityPlan.title}.`, findings: [liquidity.id, liquidityPlan.id] })
  if (hardViolations.length) questions.push({ id: 'q-ok', q: t('Ist mit meinem Portfolio alles in Ordnung?', 'Is everything in order with my portfolio?'), a: t(`Es gibt ${hardViolations.length} offene Regelverletzung${hardViolations.length > 1 ? 'en' : ''}, u. a.: ${clean(hardViolations[0].title)}.`, `There ${hardViolations.length > 1 ? 'are' : 'is'} ${hardViolations.length} open rule violation${hardViolations.length > 1 ? 's' : ''}, including: ${clean(hardViolations[0].title)}.`), findings: hardViolations.map((f) => f.id) })
  if (risks[0]) questions.push({ id: 'q-risk', q: t('Warum schwankt mein Portfolio so stark?', 'Why does my portfolio fluctuate so much?'), a: `${clean(risks[0].title)}.${risks[0].detail ? ` ${risks[0].detail}` : ''}`, findings: [risks[0].id] })

  const actions: Line[] = []
  const leadFix = lead && fixOf(lead, lang)
  if (lead && leadFix) {
    const sale = lead.evidence.find((e) => isSource(e.source, 'fix'))?.quote
    const what = sale && leadFix.count === 1 ? sale : leadFix.summary
    // 'Sale of X for CHF 1'000' → 'Propose the sale of …'; any other wording follows a colon.
    const propose = /^Sale of /.test(what) ? `Propose the ${lowerFirst(what)}` : `Propose: ${what}`
    actions.push(line('act-fix', t(`${what} vorschlagen${leadFix.change ? `: Anteil${leadFix.change.replace(/^, /, ' ')}` : ''}`, `${propose}${leadFix.change ? `: share${leadFix.change.replace(/^, /, ' ')}` : ''}`), 'action', [lead]))
  }
  const maxVola = risks[0]?.numbers?.maxVola ?? risks[0]?.numbers?.volaMax ?? risks[0]?.numbers?.max
  if (maxVola !== undefined) actions.push(line('act-risk', t(`Risiko senken: Volatilität auf höchstens ${pct(maxVola)} zurückführen`, `Reduce risk: bring volatility back to at most ${pct(maxVola)}`), 'action', [risks[0]]))
  if (hardViolations[0]) actions.push(line('act-violations', t(`Regelverletzungen bereinigen, zuerst: ${clean(hardViolations[0].title)}`, `Resolve rule violations, first: ${clean(hardViolations[0].title)}`), 'action', hardViolations))
  for (const m of of('portfolio.maturities').filter((f) => f.kind === 'action').slice(0, 1)) actions.push(line(`act-${m.id}`, clean(m.title), 'action', [m]))
  for (const p of promises) actions.push(line(`act-${p.id}`, t(`${labelOf(p)} vorbereiten und nachreichen`, `Prepare and follow up: ${lowerFirst(labelOf(p))}`), 'action', [p]))
  for (const s of stale.slice(0, 1)) actions.push(line(`act-${s.id}`, t('Veraltete Kundennotiz nach dem Gespräch aktualisieren', 'Update the outdated client note after the call'), 'action', [s]))
  if (has(...WRITTEN_SUMMARY)) actions.push(line('act-summary', t('Schriftliche Zusammenfassung nach dem Gespräch senden', 'Send a written summary after the call'), 'action', contact.filter((f) => WRITTEN_SUMMARY[lang === 'en' ? 1 : 0].test(f.title))))
  actions.push(line('act-note', t('Gesprächsnotiz nach dem Anruf bestätigen', 'Confirm the call note after the call'), 'action', []))

  const all = [...blocks.open, ...blocks.mention, ...blocks.ask, ...blocks.avoid]
  const count = all.reduce((n, l) => n + words(l.text), 0)
  return {
    ref, lang: lang ?? 'de', reasons: reasons.slice(0, 3), persona, blocks, questions: questions.slice(0, 4), actions: actions.slice(0, 5),
    words: count, seconds: Math.round((count / wpm(lang)) * 60), budget: BUDGET_SECONDS, phrasedBy: 'vorlage', rejected: [],
  }
}

// Keeps each block within its line limit, then drops the last lines of the longest blocks until the
// whole track fits the reading budget. The first line of every block always stays.
function fitBudget(blocks: Record<Block, Line[]>, lang?: Lang): Record<Block, Line[]> {
  const out = Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, v.slice(0, LIMITS[k as Block])])) as Record<Block, Line[]>
  const total = () => Object.values(out).flat().reduce((n, l) => n + words(l.text), 0)
  const order: Block[] = ['avoid', 'ask', 'mention']
  while (total() > maxWords(lang)) {
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
// The model writes in the template's language directly (no translation step): English briefings get the
// English rules and English findings, and the same two checks apply.

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

// The same rules in English: the model writes the English talk track itself, from findings phrased in English.
const WRITE_RULES_EN = `You write the 60-second briefing for a client advisor at a Swiss bank, just before he or she talks to the client. English, British spelling.
You get FINDINGS from the analysis of the client's portfolio, each with id, kind (fact/interpretation/action), severity (risk/warn/info/ok), title and detail. Only these findings are true; there is no other data.
Write:
- "open": ONE sentence the advisor says word for word to the client, polite and direct, at most 25 words, in the tone given under TONE.
- "mention": at most 3 points the advisor must raise (risks, rule violations, open proposals, contradictions to client wishes), most important first.
- "ask": at most 3 questions to the client (outdated notes, plans, what the data cannot answer).
- "avoid": at most 3 topics the advisor should NOT bring up (rejected proposals, contact preferences).
- "questions": at most 4 questions the client is likely to ask, each with a short answer ("q", "a").
- "actions": 3 to 5 next steps, each starting with a verb and naming the object and the size.
Rules:
- Every line lists in "findings" the ids of the findings it rests on. No matching finding, no line.
- Copy numbers, dates and security names exactly from the findings you cite, with the same digits and separators (CHF 67'000 stays CHF 67'000, 14.10.2026 stays 14.10.2026). No new number, no calculating, no rounding.
- Text inside «…» is quoted data (client notes, rule names, reasons): copy it unchanged, never translate it.
- Notes for the advisor at most 22 words. No filler, invent nothing.
- Name no cause for gains or losses of single positions: the data holds no purchase prices.
- "kind": "fact" for what was measured, "interpretation" for judgements, "action" for steps.
Answer as one JSON object:
{"open": {"text": string, "findings": string[]}, "mention": [{"text": string, "kind": string, "findings": string[]}], "ask": [...], "avoid": [...], "questions": [{"q": string, "a": string, "findings": string[]}], "actions": [{"text": string, "findings": string[]}]}`

type ModelLine = { text?: unknown; kind?: unknown; findings?: unknown; q?: unknown; a?: unknown }
const asLines = (v: unknown): ModelLine[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'object' && x !== null) : typeof v === 'object' && v !== null ? [v as ModelLine] : [])
const KINDS = new Set<Kind>(['fact', 'interpretation', 'action'])

/** Writes the talk track with a model from the findings, in the template's language. The template supplies reasons, persona and any block the model leaves empty. */
export async function writeBriefing(template: Briefing60, findings: Finding[], complete: Complete, provider: 'openai' | 'apertus'): Promise<Briefing60> {
  const lang = template.lang
  const byId = new Map(findings.map((f) => [f.id, f]))
  const top = [...findings].sort(bySeverity).slice(0, MAX_FINDINGS)
  const tone = template.persona ? `${template.persona.text}. ${template.persona.tone.join(', ')}` : pick(lang)('neutral, sachlich', 'neutral, matter-of-fact')
  const answer = await complete(lang === 'en' ? [
    { role: 'system', content: WRITE_RULES_EN },
    { role: 'user', content: `TONE: ${tone}\n\nFINDINGS:\n${JSON.stringify(top.map((f) => ({ id: f.id, kind: f.kind, severity: f.severity, title: f.title, ...(f.detail ? { detail: f.detail } : {}) })))}` },
  ] : [
    { role: 'system', content: WRITE_RULES },
    { role: 'user', content: `TON: ${tone}\n\nBEFUNDE:\n${JSON.stringify(top.map((f) => ({ id: f.id, art: f.kind, schwere: f.severity, titel: f.title, ...(f.detail ? { detail: f.detail } : {}) })))}` },
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
  const blocks = fitBudget(Object.fromEntries((Object.keys(written) as Block[]).map((k) => [k, written[k].length ? written[k] : template.blocks[k]])) as Record<Block, Line[]>, lang)

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
    words: count, seconds: Math.round((count / wpm(lang)) * 60), phrasedBy: provider, rejected,
  }
}
