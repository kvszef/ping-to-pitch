import { describe, expect, it } from 'vitest'
import { peerStats, summarize } from './peers.ts'
import { clients, ref } from './test-data.ts'

describe('peerStats', () => {
  it('summarises a group and leaves the asking client out', () => {
    const stats = peerStats(clients, ref)
    expect(stats.asOf).toBe('2026-07-01')
    const g = stats.of('CASE-037', 17)
    expect(g.n).toBe(17)
    expect(g.lastMonth!.n).toBe(17)
    expect(g.lastMonth!.p25).toBeLessThanOrEqual(g.lastMonth!.median)
    expect(stats.of('NOT-A-CLIENT', 17).n).toBe(18)
    expect(stats.of('X', undefined).n).toBe(47)
  })

  it('handles empty input', () => {
    expect(peerStats([], ref).of('X', 1)).toMatchObject({ n: 0, lastMonth: undefined })
    expect(summarize([])).toBeUndefined()
    expect(summarize([3, 1, 2])).toMatchObject({ n: 3, median: 2, min: 1, max: 3, p25: 1.5, p75: 2.5 })
  })
})
