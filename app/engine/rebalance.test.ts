import { describe, expect, it } from 'vitest'
import { client, ctx, ref } from './test-data.ts'
import { rebalance } from './rebalance.ts'

const bondFund = ref.recommended().find((s) => s.assetClass === 'Bonds' && /fund|etf/i.test(s.type ?? ''))!
const bonds = { dimension: 'AssetClass' as const, category: 'Bonds', label: 'Obligationen', target: 0.42 }

describe('rebalance', () => {
  it('moves one capped step from a position into the product and re-checks it (CASE-004)', () => {
    const r = rebalance(client('CASE-004'), ctx, bonds, bondFund, { kind: 'position', dimension: 'Industry', category: 'Energy', label: 'Energie' })!
    expect(r.legs.map((l) => l.side)).toEqual(['Verkauf', 'Kauf'])
    expect(r.legs[0].amount % 1000).toBe(0)
    const [bond, energy, warnings] = r.effects
    expect(bond.after).toBeGreaterThan(bond.before)
    expect(energy.after).toBeLessThan(energy.before)
    expect(warnings.after).toBeLessThanOrEqual(warnings.before)
  })

  it('proposes nothing without positions, without a gap, or without a source', () => {
    expect(rebalance({}, ctx, bonds, bondFund, { kind: 'cash', label: 'Liquidität CHF' })).toBeUndefined()
    expect(rebalance(client('CASE-004'), ctx, { ...bonds, target: 0 }, bondFund, { kind: 'cash', label: 'Liquidität CHF' })).toBeUndefined()
    expect(rebalance(client('CASE-004'), ctx, bonds, bondFund, { kind: 'position', dimension: 'Industry', category: 'Nichts', label: 'x' })).toBeUndefined()
  })

  it('keeps the typed values and phrases the free text in English (ctx.lang)', () => {
    const r = rebalance(client('CASE-004'), { ...ctx, lang: 'en' }, { ...bonds, label: 'Bonds' }, bondFund, { kind: 'position', dimension: 'Industry', category: 'Energy', label: 'Energy' })!
    expect(r.legs.map((l) => l.side)).toEqual(['Verkauf', 'Kauf'])
    expect(r.effects.map((e) => e.unit)).toEqual(['%', '%', 'Anzahl'])
    expect(r.effects[2].label).toBe('Warnings on allocation, cluster risk, risk')
    expect(r.fix.Reason).toBe('Top up Bonds in line with the house view')
  })
})
