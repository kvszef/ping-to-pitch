import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { decodePath, violations } from './portfolio-violations.ts'

describe('portfolio.violations', () => {
  it('reports the three CASE-037 warnings with the decoded actual value and thresholds', () => {
    const f = violations(client('CASE-037'), ctx)
    const warns = f.filter((x) => x.severity === 'warn')
    expect(warns).toHaveLength(3)
    const na = warns.find((x) => x.title.includes('Nordamerika'))!
    expect(na.title).toBe('CASE-037-02: Untergewicht in der Aktienregion «Nordamerika»: 23.9%')
    expect(na.numbers!.actual).toBeCloseTo(0.2388, 4)
    expect(na.numbers).toMatchObject({ threshold1: 0.265, threshold2: 0.215 })
    expect(na.detail).toBe('Ist 23.9%, Schwellen der Bank: 26.5% / 21.5%')
    expect(na.kind).toBe('fact')
    expect(warns.some((x) => x.title.includes('«Übriges Europa»'))).toBe(true)
  })

  it('reports the rule override as info', () => {
    const o = violations(client('CASE-037'), ctx).filter((x) => x.severity === 'info')
    expect(o).toHaveLength(1)
    expect(o[0].title).toBe('Regel «Keine strukturierten Produkte» ist für diesen Kunden ausgeschaltet')
  })

  it('yields nothing for a client with SuitabilityViolations null', () => {
    expect(client('CASE-005').SuitabilityViolations).toBeNull()
    expect(violations(client('CASE-005'), ctx)).toEqual([])
  })

  it('names the position, decodes all-cash portfolios, and says so when the path is missing', () => {
    const c12 = violations(client('CASE-012'), ctx)
    expect(c12.some((x) => x.title.includes('(Apple Inc): 17.8%'))).toBe(true)
    const empty = c12.find((x) => x.title.includes('Anlagevorschlag ohne Auftraggeber'))!
    expect(empty.detail).toBe('Details der Regelprüfung fehlen in den Daten.')
    expect(empty.numbers).toBeUndefined()
    const liq = violations(client('CASE-001'), ctx).find((x) => x.title.includes('Liquidität'))!
    expect(liq.numbers).toEqual({ actual: 1, threshold1: 0.6 })
    expect(liq.severity).toBe('risk')
  })

  it('still reports violations on portfolios the client file does not list', () => {
    const f = violations(client('CASE-038'), ctx).filter((x) => x.title.startsWith('Portfolio unbekannt'))
    expect(f.length).toBeGreaterThan(0)
  })

  it('ignores filter steps in the path', () => {
    expect(decodePath([{ field: 'SimulationPositionCollectionPortfolioValueRuleField', left: 1, right: 0, op: 40 }])).toBeUndefined()
    expect(decodePath([])).toBeUndefined()
  })

  it('never throws on garbage', () => {
    expect(violations({ ClientRef: 'X', SuitabilityViolations: [{ ViolationPath: 'x' }, null] }, ctx)).toHaveLength(1)
  })

  it('phrases the findings in English with the bank\'s own rule text (CASE-037, CASE-012, CASE-038)', () => {
    const en = { ...ctx, lang: 'en' as const }
    const f = violations(client('CASE-037'), en)
    const na = f.find((x) => x.title.includes('North America'))!
    expect(na.title).toBe('CASE-037-02: Underweight in the equity region «North America»: 23.9%')
    expect(na.detail).toBe("Actual 23.9%, the bank's thresholds: 26.5% / 21.5%")
    expect(na.numbers).toMatchObject({ threshold1: 0.265, threshold2: 0.215 })
    const override = f.find((x) => x.severity === 'info')!
    expect(override.title).toBe('Rule «No structured products» is switched off for this client')
    expect(override.detail).toBe('A rule violation is shown when the portfolio holds structured products.')
    expect(override.evidence[0].source).toBe('Individual rule exception')
    // A rule name the German side does not know either stays a quote from the data.
    const c12 = violations(client('CASE-012'), en)
    expect(c12.find((x) => x.title.includes('«Anlagevorschlag ohne Auftraggeber»'))!.detail).toBe('The details of the rule run are missing from the data.')
    expect(violations(client('CASE-038'), en).some((x) => x.title.startsWith('Portfolio unknown: '))).toBe(true)
  })
})
