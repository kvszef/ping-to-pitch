import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { drawdowns, history } from './context-history.ts'

describe('context.history', () => {
  it('finds the own worst drop and its recovery (CASE-037)', () => {
    const [f] = history(client('CASE-037'), ctx)
    expect(f.id).toBe('context.history:CASE-037:total')
    expect(f.numbers!.maxDrawdown).toBeCloseTo(-0.293, 3)
    expect(f.numbers!.monthsToRecover).toBe(13)
    expect(f.title).toBe('Grösster Rückgang bisher: −29.3% (Dezember 2021 bis Dezember 2022), nach 13 Monaten wieder auf dem alten Höchststand')
    expect(f.detail).toContain('noch nicht erholt')
  })

  it('says nothing without a real drop or without history', () => {
    const flat = structuredClone(client('CASE-004')) as { Portfolios: { PerformanceHistory: { Date: string; Value: number }[] }[] }
    for (const p of flat.Portfolios) p.PerformanceHistory = p.PerformanceHistory.map((h, i) => ({ ...h, Value: 100 + i }))
    expect(history(flat, ctx)).toEqual([])
    expect(history({}, ctx)).toEqual([])
    const d = drawdowns([{ date: '2026-01-01', value: 100 }, { date: '2026-02-01', value: 80 }, { date: '2026-03-01', value: 90 }])
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ peak: '2026-01-01', trough: '2026-02-01' })
    expect(d[0].recovered).toBeUndefined()
    expect(d[0].depth).toBeCloseTo(-0.2, 9)
  })

  it('phrases the same finding in English (ctx.lang)', () => {
    const [f] = history(client('CASE-037'), { ...ctx, lang: 'en' })
    expect(f.title).toBe('Largest drop so far: −29.3% (December 2021 to December 2022), back at the previous high after 13 months')
    expect(f.detail).toContain('not yet recovered')
    expect(f.evidence[0].source).toBe('Performance (monthly values)')
    expect(f.numbers).toEqual(history(client('CASE-037'), ctx)[0].numbers)
  })
})
