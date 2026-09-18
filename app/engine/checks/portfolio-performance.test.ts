import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { performance, performanceStats } from './portfolio-performance.ts'

describe('portfolio.performance', () => {
  it('computes CASE-037-02 returns from the month values', () => {
    const findings = performance(client('CASE-037'), ctx)
    const f = findings.find((x) => x.id === 'portfolio.performance:CASE-037:CASE-037-02')!
    expect(f.numbers!.lastMonth).toBeCloseTo(-0.054, 3)
    expect(f.numbers!.twelveMonths).toBeCloseTo(0.332, 3)
    expect(f.severity).toBe('warn')
    expect(f.title).toBe('CASE-037-02: −5.4% im letzten Monat, +33.2% über 12 Monate')
    expect(f.detail).toContain('Stand: Juli 2026')
    expect(f.detail).toContain('nicht um Ein- und Auszahlungen bereinigt')
    expect(f.numbers!.maxDrawdown).toBeLessThan(0)
    // Two portfolios: one finding each plus the client total.
    expect(findings.map((x) => x.id)).toContain('portfolio.performance:CASE-037:total')
    expect(findings).toHaveLength(3)
  })

  it('stays calm on a quiet month and says nothing without history', () => {
    const [f] = performance(client('CASE-041'), ctx)
    expect(f.severity).toBe('info')
    const empty = structuredClone(client('CASE-037'))
    for (const p of empty.Portfolios as { PerformanceHistory: unknown }[]) p.PerformanceHistory = []
    expect(performance(empty, ctx)).toEqual([])
    expect(performanceStats([{ date: '2026-07-01', value: 1 }])).toBeUndefined()
  })

  it('skips YTD when there is no Jan 1 value', () => {
    const s = performanceStats([{ date: '2026-02-01', value: 100 }, { date: '2026-03-01', value: 90 }])!
    expect(s.ytd).toBeUndefined()
    expect(s.lastMonth).toBeCloseTo(-0.1, 6)
    expect(s.maxDrawdown!.value).toBeCloseTo(-0.1, 6)
  })
})
