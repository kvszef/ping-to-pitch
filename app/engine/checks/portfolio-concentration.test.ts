import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { concentration } from './portfolio-concentration.ts'

describe('portfolio.concentration', () => {
  it('turns the bank cluster-risk verdicts into risk findings with the violation as evidence', () => {
    const risks = concentration(client('CASE-012'), ctx).filter((f) => f.severity === 'risk')
    expect(risks).toHaveLength(5) // five single-instrument violations in the file
    for (const f of risks) expect(f.evidence.some((e) => e.source === 'Suitability-Verletzung')).toBe(true)
    expect(risks.map((f) => f.title)).toContain('CASE-012-01: Klumpenrisiko Alphabet Inc, 25.5% des Portfolios')
  })

  it('names positions that carry far more risk than weight', () => {
    const f = concentration(client('CASE-019'), ctx).find((x) => x.kind === 'interpretation')!
    expect(f.title).toContain('Comet Holding AG')
    expect(f.numbers!.riskShare).toBeGreaterThanOrEqual(2 * f.numbers!.weight)
    expect(f.severity).toBe('risk') // also a bank cluster-risk violation
  })

  it('has no risk finding for CASE-037-01, and reports the top positions', () => {
    const findings = concentration(client('CASE-037'), ctx)
    expect(findings.filter((f) => f.id.includes('CASE-037-01') && f.severity === 'risk')).toEqual([])
    const top = findings.find((f) => f.id === 'portfolio.concentration:CASE-037:CASE-037-01:top')!
    expect(top.numbers!.combined).toBeCloseTo(0.323, 2)
  })

  it('mentions a large foreign-currency share (matches the bank EUR violation on CASE-041)', () => {
    const f = concentration(client('CASE-041'), ctx).find((x) => x.id.endsWith(':currency'))!
    expect(f.numbers!.share).toBeCloseTo(0.659, 2)
    // CASE-041 contributions are amounts, not volatility: no risk-vs-weight judgement there.
    expect(concentration(client('CASE-041'), ctx).some((x) => x.kind === 'interpretation')).toBe(false)
  })
})
