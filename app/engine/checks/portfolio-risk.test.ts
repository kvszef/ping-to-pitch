import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { risk } from './portfolio-risk.ts'

const profileFinding = (ref: string) => risk(client(ref), ctx).find((f) => f.id.endsWith(':profile'))

describe('portfolio.risk', () => {
  it('flags advisory portfolios above the profile volatility', () => {
    for (const [ref, vola, max] of [['CASE-012', 0.184, 0.15], ['CASE-018', 0.293, 0.15], ['CASE-023', 0.245, 0.185], ['CASE-042', 0.119, 0.1]] as const) {
      const f = profileFinding(ref)!
      expect(f.severity, ref).toBe('risk')
      expect(f.numbers!.volatility, ref).toBeCloseTo(vola, 3)
      expect(f.numbers!.maxVola, ref).toBe(max)
    }
  })

  it('only informs on execution-only mandates', () => {
    const f = profileFinding('CASE-011')!
    expect(f.severity).toBe('info')
    expect(f.kind).toBe('interpretation')
    expect(f.numbers!.volatility).toBeCloseTo(0.606, 3)
  })

  it('flags a strategy band breach and positions above the profile PRC', () => {
    const findings = risk(client('CASE-042'), ctx)
    expect(findings.find((f) => f.id.endsWith(':prc'))?.severity).toBe('warn')
    expect(risk(client('CASE-020'), ctx).find((f) => f.id.endsWith(':band'))?.title).toContain('Risiko unter Strategieband')
  })

  it('is ok for CASE-037-02', () => {
    const findings = risk(client('CASE-037'), ctx).filter((f) => f.id.includes('CASE-037-02'))
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('ok')
    expect(findings[0].title).toBe('CASE-037-02: Volatilität 8.7%, innerhalb Profil (max. 12.0%)')
  })
})
