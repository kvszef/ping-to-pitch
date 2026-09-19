import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { currency } from './wish-currency.ts'

describe('wish.currency', () => {
  it('flags unhedged foreign-currency positions against a CHF-hedged wish (CASE-039)', () => {
    const [f] = currency(client('CASE-039'), ctx)
    expect(f.severity).toBe('warn')
    expect(f.kind).toBe('interpretation')
    expect(f.numbers!.unhedgedShare).toBeCloseTo(0.357, 2)
    expect(f.detail).toMatch(/^Grösste: Xtrackers MSCI World ESG UCITS ETF \(USD/)
  })

  it('is ok when every position is in CHF (CASE-036), silent without the wish (CASE-004)', () => {
    expect(currency(client('CASE-036'), ctx)[0].severity).toBe('ok')
    expect(currency(client('CASE-004'), ctx)).toEqual([])
  })
})
