import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { composeBriefing, phraseBriefing, type Briefing60 } from './briefing.ts'
import { provisionalFindings } from './provisional-findings.ts'
import { mergeFindings } from './briefing-route.ts'
import { indexReference, run } from '../../engine/run.ts'

const data = (file: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../core-case/portfolio-data', file), 'utf8'))
const clients: Record<string, unknown>[] = data('clients.json')
const reference = data('reference.json')
const NOW = new Date('2026-09-19T00:00:00Z')
const client = (ref: string) => clients.find((c) => c.ClientRef === ref)!
const findingsOf = (ref: string) => provisionalFindings(client(ref), reference, NOW)
const briefingOf = (ref: string) => composeBriefing(ref, findingsOf(ref))
const allLines = (b: Briefing60) => Object.values(b.blocks).flat()

describe('provisional findings', () => {
  it('finds the energy held through funds against a "no fossil fuels" wish (CASE-004)', () => {
    const f = findingsOf('CASE-004').find((x) => x.check === 'contradiction.fossil-fuel')!
    expect(f.severity).toBe('risk')
    expect(f.numbers!.direct).toBe(0)
    expect(f.numbers!.total).toBeCloseTo(0.0335, 3)
    expect(f.fix!.SecurityPositions.map((p) => p.SecurityName)).toEqual(['SPDR MSCI World Energy UCITS ETF'])
    expect(f.numbers!.after).toBeCloseTo(0.0105, 3)
  })

  it('does not flag a "no direct positions" wish when energy sits only inside funds (CASE-037)', () => {
    const f = findingsOf('CASE-037').find((x) => x.check === 'contradiction.fossil-fuel')!
    expect(f.severity).toBe('ok')
    expect(f.fix).toBeUndefined()
  })

  it('flags a direct energy stock against a "no direct positions" wish (CASE-017)', () => {
    const f = findingsOf('CASE-017').find((x) => x.check === 'contradiction.fossil-fuel')!
    expect(f.severity).toBe('risk')
    expect(f.fix!.SecurityPositions[0].SecurityName).toMatch(/Neste/)
  })

  it('turns an expired plan into a question instead of a fact (CASE-007)', () => {
    const stale = findingsOf('CASE-007').find((x) => x.check === 'context.stale-note')!
    expect(stale.title).toMatch(/^Veraltet: Immobilienkauf/)
    expect(stale.detail).toMatch(/\?$/)
  })

  it('keeps a plan that is still running as a fact with the months left (CASE-004)', () => {
    const plan = findingsOf('CASE-004').find((x) => x.check === 'context.plan')!
    expect(plan.title).toMatch(/^Pensionierung: noch \d+ Monate/)
  })

  it('counts an unknown security as unclassified and does not throw', () => {
    const raw = structuredClone(client('CASE-004')) as { Portfolios: { SecurityPositions: { SecurityId: number }[] }[] }
    raw.Portfolios[0].SecurityPositions[0].SecurityId = 99999999
    const f = provisionalFindings(raw, reference, NOW).find((x) => x.check === 'contradiction.fossil-fuel')!
    expect(f.numbers!.unclassified).toBeGreaterThan(0)
  })

  it('survives an empty client and missing reference data', () => {
    expect(() => provisionalFindings({}, {}, NOW)).not.toThrow()
    expect(() => provisionalFindings(null, null, NOW)).not.toThrow()
  })
})

describe('composeBriefing', () => {
  it('runs on all 47 clients, fits the reading budget and always opens with one line', () => {
    for (const c of clients) {
      const b = composeBriefing(String(c.ClientRef), provisionalFindings(c, reference, NOW))
      expect(b.blocks.open).toHaveLength(1)
      expect(b.seconds).toBeLessThanOrEqual(b.budget)
      expect(allLines(b).every((l) => l.text.trim().length > 0 && !l.text.includes('undefined') && !l.text.includes('NaN'))).toBe(true)
      expect(b.actions.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('puts the contradiction and its smallest fix into "must mention" (CASE-004)', () => {
    const b = briefingOf('CASE-004')
    expect(b.blocks.mention[0].text).toMatch(/SPDR MSCI World Energy UCITS ETF verkaufen, 3\.3% → 1\.0%/)
    expect(b.actions[0].text).toMatch(/^Verkauf SPDR MSCI World Energy UCITS ETF über CHF [\d']+ vorschlagen/)
  })

  it('asks about the expired property plan instead of stating it (CASE-007)', () => {
    const b = briefingOf('CASE-007')
    expect(b.blocks.ask.some((l) => /Immobilienkauf/.test(l.text) && l.text.endsWith('?'))).toBe(true)
    expect(b.blocks.mention.some((l) => /Benchmark/.test(l.text))).toBe(true)
  })

  it('lists rejected ideas under "don\'t bring up" (CASE-012)', () => {
    const b = briefingOf('CASE-012')
    expect(b.blocks.avoid.some((l) => l.text.startsWith('Nicht erneut vorschlagen'))).toBe(true)
  })

  it('links every line to findings that exist', () => {
    const findings = findingsOf('CASE-004')
    const ids = new Set(findings.map((f) => f.id))
    const b = composeBriefing('CASE-004', findings)
    for (const l of [...allLines(b), ...b.actions, ...b.reasons]) for (const id of l.findings) expect(ids.has(id)).toBe(true)
  })

  it('works without any findings', () => {
    const b = composeBriefing('X', [])
    expect(b.blocks.open[0].text).toBeTruthy()
    expect(b.reasons).toEqual([])
  })
})

describe('phraseBriefing', () => {
  it('keeps a model line only if it adds no number', async () => {
    const b = briefingOf('CASE-004')
    const mention = b.blocks.mention[0]
    const complete = async () => ({ lines: [
      { id: 'open', text: 'Guten Tag! Geht es um Ihre Pensionierung?' },
      { id: `mention:${mention.id}`, text: 'Energie 7.9% im Portfolio, bitte sofort verkaufen.' },
    ] })
    const out = await phraseBriefing(b, complete, 'openai')
    expect(out.blocks.open[0].text).toBe('Guten Tag! Geht es um Ihre Pensionierung?')
    expect(out.blocks.mention[0].text).toBe(mention.text)
    expect(out.rejected.map((r) => r.numbers)).toEqual([['7.9']])
    expect(out.phrasedBy).toBe('openai')
  })

  it('keeps the template when the model answers garbage', async () => {
    const b = briefingOf('CASE-007')
    const out = await phraseBriefing(b, async () => 'kein JSON', 'apertus')
    expect(out.blocks).toEqual(b.blocks)
  })
})

describe('with the engine', () => {
  const index = indexReference(reference)
  const merged = (c: Record<string, unknown>) => mergeFindings(run(c, { ref: index, now: NOW, memory: [] }), provisionalFindings(c, reference, NOW)).findings

  it('composes a clean briefing for all 47 clients from engine plus stopgap findings', () => {
    for (const c of clients) {
      const b = composeBriefing(String(c.ClientRef), merged(c))
      expect(b.seconds).toBeLessThanOrEqual(b.budget)
      for (const l of [...allLines(b), ...b.actions, ...b.reasons]) {
        expect(l.text).not.toMatch(/undefined|NaN|CASE-\d+-\d+:/)
      }
    }
  })

  it('takes a check from the engine once it delivers, and never both', () => {
    const c = client('CASE-012')
    const { findings, engineChecks } = mergeFindings(run(c, { ref: index, now: NOW, memory: [] }), provisionalFindings(c, reference, NOW))
    // the stopgap's own proposals summary must be gone once the engine delivers proposals
    expect(engineChecks).toContain('portfolio.proposals')
    expect(findings.some((f) => f.id === 'portfolio.proposals:CASE-012:rejected')).toBe(false)
    expect(composeBriefing('CASE-012', findings).blocks.avoid[0].text).toMatch(/^Nicht erneut vorschlagen: «.+» \(abgelehnt am \d{2}\.\d{2}\.\d{4}, \d+× insgesamt\)$/)
  })
})
