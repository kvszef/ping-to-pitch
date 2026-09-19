import { describe, expect, it } from 'vitest'
import { readClient } from '../data.ts'
import { client, ctx, ref } from '../test-data.ts'
import { interest } from './wish-interest.ts'

describe('wish.interest', () => {
  it('measures the sustainable share and says it is already met (CASE-008: 97.1%)', () => {
    const [f] = interest(client('CASE-008'), ctx)
    expect(f).toMatchObject({ kind: 'interpretation', severity: 'info' })
    expect(f.numbers!.share).toBeCloseTo(0.971, 3)
    expect(f.detail).toMatch(/bereits erfüllt/)
  })

  it('names the weakest position and up to three suitable options (CASE-010: 75.9%, Sandoz)', () => {
    const [f] = interest(client('CASE-010'), ctx)
    expect(f.numbers!.share).toBeCloseTo(0.759, 3)
    expect(f.detail).toMatch(/Schwächste Position: Sandoz Group AG \(Score 5\.7, 4\.2%\)/)
    const options = f.evidence.filter((e) => e.source === 'Empfehlungsliste')
    expect(options.length).toBeGreaterThan(0)
    expect(options.length).toBeLessThanOrEqual(3)
    const c = readClient(client('CASE-010'), ref)
    const held = new Set(c.portfolios.flatMap((p) => p.positions.map((x) => x.securityId)))
    const maxPrc = ref.riskProfile(c.riskProfileId)!.maxPrc!
    for (const o of options) {
      const s = ref.security(Number(o.ref))!
      expect(held.has(s.id)).toBe(false)
      expect(s.prc!).toBeLessThanOrEqual(maxPrc)
      expect(s.esgScore!).toBeGreaterThanOrEqual(8)
    }
  })

  it('measures a sector interest with look-through (CASE-045: health care)', () => {
    const [f] = interest(client('CASE-045'), ctx)
    expect(f.title).toMatch(/des Aktienteils in Gesundheit/)
    expect(f.numbers!.equityShare).toBeGreaterThan(0.5)
  })

  it('asks what is meant when the data cannot measure it, without numbers (CASE-003: dividends)', () => {
    const f = interest(client('CASE-003'), ctx).find((x) => x.id.includes(':dividend:'))!
    expect(f.numbers).toBeUndefined()
    expect(f.detail).toMatch(/nachfragen, was gemeint ist/)
  })

  it('makes one finding for the same interest in two notes (CASE-027), none without interests (CASE-001)', () => {
    const f = interest(client('CASE-027'), ctx)
    expect(f).toHaveLength(1)
    expect(f[0].evidence.filter((e) => e.source === 'Kundennotiz')).toHaveLength(2)
    expect(interest(client('CASE-001'), ctx)).toEqual([])
  })

  it('phrases the same findings in English (ctx.lang)', () => {
    const en = { ...ctx, lang: 'en' as const }
    const [f] = interest(client('CASE-010'), en)
    expect(f.numbers).toEqual(interest(client('CASE-010'), ctx)[0].numbers)
    expect(f.title).toMatch(/^Interest «.+»: today 75\.9% of total assets with an ESG score of 5\.714 or more$/)
    expect(f.detail).toMatch(/Weakest position: Sandoz Group AG \(score 5\.7, 4\.2%\)\. Options from the recommendation list \(not held, risk class up to \d/)
    expect(f.evidence.some((e) => e.source === 'Recommendation list')).toBe(true)
    expect(f.evidence.some((e) => e.source === 'Risk profile' && /risk class up to \d/.test(e.quote ?? ''))).toBe(true)
    const dividend = interest(client('CASE-003'), en).find((x) => x.id.includes(':dividend:'))!
    expect(dividend.title).toBe('Interest «Focus on dividend stocks for regular income»: cannot be measured in the data')
    expect(dividend.detail).toBe('The data holds no dividend yields: ask what is meant.')
  })
})
