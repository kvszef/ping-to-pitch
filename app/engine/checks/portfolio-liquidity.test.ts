import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { liquidity } from './portfolio-liquidity.ts'

describe('portfolio.liquidity', () => {
  it('warns when the cash is below the noted tax payment (CASE-012)', () => {
    const [f] = liquidity(client('CASE-012'), ctx)
    expect(f.severity).toBe('warn')
    expect(f.numbers!.need).toBe(15000)
    expect(f.numbers!.value).toBeCloseTo(328, 0)
    expect(f.numbers!.shortfall).toBeCloseTo(15000 - f.numbers!.value, 6)
    expect(f.title).toMatch(/unter dem Bedarf von CHF 15'000/)
    expect(f.evidence.some((e) => e.source === 'Kundennotiz')).toBe(true)
  })

  it('states the cash share without a warning where no amount is noted (CASE-004)', () => {
    const [f] = liquidity(client('CASE-004'), ctx)
    expect(f.severity).toBe('info')
    expect(f.numbers!.share).toBeCloseTo(8810 / 534191, 3)
    expect(f.title).toBe("Liquidität 1.6% (CHF 8'810)")
    expect(liquidity({}, ctx)).toEqual([])
  })
})
