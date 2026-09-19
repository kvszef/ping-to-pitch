import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { composeCallPlan, writeCallPlan, type CallPlan } from './callplan.ts'
import { provisionalFindings } from './provisional-findings.ts'
import { mergeFindings } from './briefing-route.ts'
import { indexReference, run } from '../../engine/run.ts'
import { unsupportedNumbers } from '../../src/workspace/grounding.ts'
import { houseView } from '../houseview.ts'

const data = (file: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../core-case/portfolio-data', file), 'utf8'))
const clients: Record<string, unknown>[] = data('clients.json')
const reference = data('reference.json')
const NOW = new Date('2026-09-19T00:00:00Z')
const index = indexReference(reference)
const client = (ref: string) => clients.find((c) => c.ClientRef === ref)!
const findingsOf = (ref: string) => mergeFindings(run(client(ref), { ref: index, now: NOW, memory: [] }), provisionalFindings(client(ref), reference, NOW)).findings
const allLines = (p: CallPlan) => [...p.reasons, ...p.goals, ...p.arguments, p.open, ...p.avoid]

describe('composeCallPlan', () => {
  it('builds reason, goal and arguments from a wish the portfolio breaks (CASE-004)', () => {
    const findings = findingsOf('CASE-004')
    const wish = findings.find((f) => f.check === 'contradiction.fossil-fuel')!
    const plan = composeCallPlan('CASE-004', findings, [{ kind: 'risk', severity: 'risk', title: wish.title, findingId: wish.id }])
    expect(plan.reasons[0].findings).toEqual([wish.id])
    expect(plan.goals[0].text).toMatch(/SPDR MSCI World Energy/)
    expect(plan.arguments.map((a) => a.label)).toEqual(expect.arrayContaining(['Eigener Wunsch', 'Kleiner Eingriff']))
    expect(plan.arguments.find((a) => a.label === 'Kleiner Eingriff')!.text).toMatch(/3\.3% → 1\.0%/)
    expect(plan.open.text).toMatch(/^Guten Tag, ich rufe wegen Ihres Wunsches «Kein Engagement in fossilen Energien»/)
  })

  it('leads with the news when today\'s top reason is a headline, and informs before it decides', () => {
    const plan = composeCallPlan('CASE-017', findingsOf('CASE-017'), [{ kind: 'risk', severity: 'warn', title: 'Nestle SA (6.2%): Nestle senkt Ausblick', newsId: 'n1', url: 'https://example.org/n1' }])
    expect(plan.reasons[0]).toMatchObject({ text: 'Nestle SA (6.2%): Nestle senkt Ausblick', source: 'Nachrichten: Risiko', url: 'https://example.org/n1' })
    expect(plan.goals[0].id).toBe('goal-news')
    expect(plan.open.text).toMatch(/Neuigkeiten zu Nestle SA/)
    // A client who reacts to losses gets his own recovery as an argument.
    expect(plan.arguments.some((a) => a.label === 'Eigene Erfahrung')).toBe(true)
  })

  it('turns a changed house view into the goal and the reasoning of the bank into an argument (CASE-001)', () => {
    const findings = run(client('CASE-001'), { ref: index, now: NOW, memory: [], houseView: houseView() })
    const view = findings.find((f) => f.check === 'cio.house-view' && !f.id.endsWith(':summary'))!
    const plan = composeCallPlan('CASE-001', findings, [{ kind: 'opportunity', severity: view.severity, title: view.title, findingId: view.id }])
    expect(plan.goals[0]).toMatchObject({ id: 'goal-house-view', findings: [view.id] })
    expect(plan.arguments[0]).toMatchObject({ label: 'Begründung der Bank', findings: [view.id] })
    expect(plan.arguments.filter((a) => a.findings[0] === view.id)).toHaveLength(1)
    expect(plan.open.text).toMatch(/Markteinschätzung/)
  })

  it('keeps the decimals of the effects when the house view comes with a re-checked trade', () => {
    // First client whose house-view finding carries a trade ('Vorschlag: … . Danach: Obligationen 20.5% → 30.4%, … .').
    for (const c of clients) {
      const findings = run(c, { ref: index, now: NOW, memory: [], houseView: houseView() })
      const view = findings.find((f) => f.check === 'cio.house-view' && /Vorschlag: .+\. Danach: /.test(f.detail ?? ''))
      if (!view) continue
      const goal = composeCallPlan(c.ClientRef as string, findings, [{ kind: 'opportunity', severity: view.severity, title: view.title, findingId: view.id }]).goals[0]
      expect(goal.id).toBe('goal-house-view')
      const after = /Danach: (.+?)\.(?= (?:Neu zu beachten|Gemessen mit)|$)/.exec(view.detail!)![1]
      expect(after).toMatch(/\d\.\d%/)
      expect(goal.text.endsWith(`danach ${after}`)).toBe(true)
      return
    }
    throw new Error('no client with a house-view trade: the test data changed')
  })

  it('phrases its own sentences in English on request and still reads German finding titles (CASE-004)', () => {
    const findings = findingsOf('CASE-004')
    const wish = findings.find((f) => f.check === 'contradiction.fossil-fuel')!
    const plan = composeCallPlan('CASE-004', findings, [{ kind: 'risk', severity: 'risk', title: wish.title, findingId: wish.id }], 'en')
    expect(plan.open.text).toMatch(/^Hello, I am calling about your wish «Kein Engagement in fossilen Energien»/)
    const own = plan.arguments.find((a) => a.label === 'Own wish')!
    expect(own.text).toMatch(/^The client asked for it \(note of 05\.03\.2025\)/)
    expect(own.text).not.toMatch(/Widerspruch: |Contradiction: /)
    expect(plan.arguments.find((a) => a.label === 'Small step')!.text).toMatch(/^One sale is enough: .*share 3\.3% → 1\.0%/)
  })

  it('says so when the data holds no reason to call (no findings)', () => {
    const plan = composeCallPlan('CASE-XXX', [])
    expect(plan.reasons).toEqual([])
    expect(plan.arguments).toEqual([])
    expect(plan.goals[0].id).toBe('goal-contact')
  })

  it('never throws and never shows a number that is not in the findings, for all clients', () => {
    for (const c of clients) {
      const ref = c.ClientRef as string
      const findings = findingsOf(ref)
      const byId = new Map(findings.map((f) => [f.id, f]))
      for (const l of [...allLines(composeCallPlan(ref, findings)), ...allLines(composeCallPlan(ref, findings, [], 'en'))]) {
        const evidence = l.findings.map((id) => { const f = byId.get(id)!; return `${f.title} ${f.detail ?? ''} ${f.evidence.map((e) => `${e.quote ?? ''} ${e.date ?? ''}`).join(' ')}` }).join(' ')
        // Dates are written as 05.03.2025 from an ISO date in the evidence.
        const iso = evidence.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3.$2.$1')
        expect(unsupportedNumbers(l.text, `${evidence} ${iso}`), `${ref} ${l.id}: ${l.text}`).toEqual([])
      }
    }
  })
})

describe('writeCallPlan', () => {
  const findings = findingsOf('CASE-004')
  const wish = findings.find((f) => f.check === 'contradiction.fossil-fuel')!
  const template = composeCallPlan('CASE-004', findings, [{ kind: 'risk', severity: 'risk', title: wish.title, findingId: wish.id }])

  it('takes the model\'s wording when it cites findings and keeps their numbers', async () => {
    const plan = await writeCallPlan(template, findings, async () => ({
      open: { text: 'Guten Tag, ich rufe an, weil Ihr Wunsch zu fossilen Energien noch nicht ganz umgesetzt ist', findings: [wish.id] },
      goals: [{ text: 'Zustimmung zum Verkauf des Energie-ETF einholen, Anteil sinkt von 3.3% auf 1.0%', findings: [wish.id] }],
      arguments: [{ label: 'Ihr Wort', text: 'Sie wollten kein Engagement in fossilen Energien, heute sind es 3.3%', findings: [wish.id] }],
    }), 'openai')
    expect(plan.phrasedBy).toBe('openai')
    expect(plan.goals[0].text).toMatch(/von 3\.3% auf 1\.0%/)
    expect(plan.arguments[0]).toMatchObject({ label: 'Ihr Wort', findings: [wish.id] })
    expect(plan.rejected).toEqual([])
  })

  it('keeps the main goal on the lead reason when the model writes a goal about something else', async () => {
    const other = findings.find((f) => f.check === 'portfolio.violations')!
    const withBoth = composeCallPlan('CASE-004', findings, [{ kind: 'risk', severity: 'risk', title: wish.title, findingId: wish.id }, { kind: 'risk', severity: 'risk', title: other.title, findingId: other.id }])
    const plan = await writeCallPlan(withBoth, findings, async () => ({ goals: [{ text: 'Regelverletzung im Sektor Energie besprechen', findings: [other.id] }] }), 'openai')
    expect(plan.goals[0]).toEqual(withBoth.goals[0])
    expect(plan.goals[1].text).toBe('Regelverletzung im Sektor Energie besprechen')
  })

  it('asks the model for English only when the advisor reads English', async () => {
    const seen: string[] = []
    const model = async (m: { role: string; content: string }[]) => { seen.push(m[0].content); return {} }
    await writeCallPlan(template, findings, model, 'openai')
    await writeCallPlan(template, findings, model, 'openai', 'en')
    expect(seen[0]).not.toMatch(/LANGUAGE/)
    expect(seen[1]).toMatch(/LANGUAGE \(this rule overrides/)
  })

  it('drops a line with an invented number or without a source and keeps the template', async () => {
    const plan = await writeCallPlan(template, findings, async () => ({
      goals: [{ text: 'Verkauf bringt 12.5% mehr Rendite', findings: [wish.id] }],
      arguments: [{ label: 'Frei erfunden', text: 'Alle anderen Kunden haben schon verkauft', findings: ['gibt-es-nicht'] }],
    }), 'openai')
    expect(plan.goals).toEqual(template.goals)
    expect(plan.arguments).toEqual(template.arguments)
    expect(plan.open).toEqual(template.open)
    expect(plan.rejected.map((r) => r.id)).toEqual(['goal-1', 'arg-1'])
  })
})
