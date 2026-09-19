import { describe, expect, it } from 'vitest'
import { exclusions } from './checks/contradiction-exclusion.ts'
import { readClient } from './data.ts'
import { applySale, measureExclusion, smallestFix } from './fix.ts'
import { client, ctx, ref } from './test-data.ts'

const ENERGY = { type: 'exclude-sector', sector: 'Energy', scope: 'any' } as const

describe('smallest fix', () => {
  it('sells the SPDR World Energy ETF for CASE-004: 3.3% → 1.0%, nothing new breaks', () => {
    const r = smallestFix(client('CASE-004'), ctx, ENERGY)!
    expect(r.fix.SecurityPositions.map((p) => p.SecurityName)).toEqual(['SPDR MSCI World Energy UCITS ETF'])
    expect(r.fix.SecurityPositions[0]).toMatchObject({ ProposalValuePercentage: 0 })
    expect(r.fix.SecurityPositions[0].TotalAmountInProposalCurrency).toBeGreaterThan(0)
    expect(r.before).toBeCloseTo(0.0335, 3)
    expect(r.after).toBeCloseTo(0.0105, 3)
    expect(r.newIssues).toEqual([])
  })

  it('moves the sold value to the CHF account, so the portfolio still sums to 1', () => {
    const raw = client('CASE-004')
    const h = measureExclusion(readClient(raw, ref), ENERGY, ref).holdings[0]
    const after = readClient(applySale(raw, h), ref)
    const p = after.portfolios.find((x) => x.nr === h.portfolioNr)!
    expect(p.positions.some((x) => x.securityId === h.securityId)).toBe(false)
    expect(p.positions.reduce((a, x) => a + x.weight, 0)).toBeCloseTo(1, 3)
    expect(readClient(raw, ref).portfolios[0].positions.some((x) => x.securityId === h.securityId)).toBe(true) // original untouched
  })

  it('reports a new breach the sale would cause (CASE-004 with a "no emerging markets" note)', () => {
    const raw = structuredClone(client('CASE-004'))
    raw.ClientNotes = [{ Note: 'Wants exposure limited to developed markets only, no emerging markets.', CreatedByDateUTC: '2026-09-01T10:00:00Z' }]
    const f = exclusions(raw, ctx).find((x) => x.check === 'contradiction.region')!
    expect(f.fix!.Reason).toMatch(/EM IMI UCITS ETF verkaufen$/)
    expect(f.numbers!.newIssues).toBeGreaterThan(0)
    expect(f.detail).toMatch(/Nach dem Verkauf: CASE-004-01: Untergewicht Region Asien\/Pazifik/)
  })

  it('finds nothing to sell for a direct-only wish when there is no direct holding', () => {
    expect(smallestFix(client('CASE-037'), ctx, { type: 'exclude-sector', sector: 'Energy', scope: 'direct' })).toBeUndefined()
  })
})
