import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { esg } from './wish-esg.ts'

describe('wish.esg', () => {
  it('flags positions below the ESG profile minimum, weakest first (CASE-010: Sandoz)', () => {
    const [f] = esg(client('CASE-010'), ctx)
    expect(f.severity).toBe('warn')
    expect(f.numbers!.belowShare).toBeCloseTo(0.0421, 3)
    expect(f.detail).toMatch(/^Schwächste: Sandoz Group AG \(Score 5\.7, 4\.2%\)/)
    expect(f.evidence[0]).toMatchObject({ source: 'ESG-Profil' })
  })

  it('is ok when every position meets the minimum (CASE-008)', () => {
    expect(esg(client('CASE-008'), ctx)[0].severity).toBe('ok')
  })

  it('checks an ESG note even with profile "No" (CASE-003), and is silent without either (CASE-009)', () => {
    const [f] = esg(client('CASE-003'), ctx)
    expect(f.id).toBe('wish.esg:CASE-003:note')
    expect(f.evidence[0]).toMatchObject({ source: 'Kundennotiz' })
    expect(esg(client('CASE-009'), ctx)).toEqual([])
  })
})
