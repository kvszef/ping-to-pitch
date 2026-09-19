import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { maturities } from './portfolio-maturities.ts'

describe('portfolio.maturities', () => {
  it('lists the CASE-037-02 bonds repaying within six months', () => {
    const f = maturities(client('CASE-037'), ctx)
    const list = f.find((x) => x.id === 'portfolio.maturities:CASE-037:soon:CASE-037-02')!
    expect(list).toMatchObject({ kind: 'fact', severity: 'info' })
    // Cembra 14.10., Caterpillar 21.10., John Deere 10.11., Hyundai Capital America 17.11.2026, Axpo 04.02.2027 (138 days).
    expect(list.numbers!.count).toBe(5)
    for (const n of ['Cembra', 'Caterpillar', 'John Deere', 'Hyundai Capital America', 'Axpo']) expect(list.detail).toContain(n)
    expect(list.detail).not.toContain('2019-14.10.26') // old, unshifted date in the security name
    expect(list.numbers!.amount).toBeCloseTo(112_064.85, 1)
    expect(list.numbers!.share).toBeCloseTo(0.112, 3)
    const action = f.find((x) => x.id === 'portfolio.maturities:CASE-037:reinvest:CASE-037-02')!
    expect(action.title).toBe("CASE-037-02: Wiederanlage von CHF 112'065 (11.2% des Portfolios) bis 04.02.2027 besprechen")
    expect(f).toHaveLength(2)
  })

  it('reports a bond past maturity that is still held', () => {
    const f = maturities(client('CASE-037'), { ...ctx, now: new Date('2026-10-20T08:00:00Z') })
    const past = f.find((x) => x.id.includes(':matured:'))!
    expect(past.severity).toBe('warn')
    expect(past.title).toMatch(/^Obligation 0\.1525 % Cembra Money Bank AG ist am 14\.10\.2026 fällig geworden/)
  })

  it('gives nothing for a client without bonds', () => {
    expect(maturities(client('CASE-001'), ctx)).toEqual([])
  })

  it('phrases the findings in English with the same numbers (CASE-037)', () => {
    const en = { ...ctx, lang: 'en' as const }
    const f = maturities(client('CASE-037'), en)
    expect(f.map((x) => x.numbers)).toEqual(maturities(client('CASE-037'), ctx).map((x) => x.numbers))
    expect(f.find((x) => x.id.includes(':soon:'))!.title).toBe("CASE-037-02: 5 bonds mature by 04.02.2027, together CHF 112'065")
    expect(f.find((x) => x.id.includes(':reinvest:'))!.title).toBe("CASE-037-02: discuss reinvesting CHF 112'065 (11.2% of the portfolio) by 04.02.2027")
    const past = maturities(client('CASE-037'), { ...en, now: new Date('2026-10-20T08:00:00Z') }).find((x) => x.id.includes(':matured:'))!
    expect(past.title).toBe('Bond 0.1525 % Cembra Money Bank AG matured on 14.10.2026 but is still held: check')
  })
})
