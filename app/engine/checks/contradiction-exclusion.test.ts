import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import type { RawClient } from '../types.ts'
import { exclusions } from './contradiction-exclusion.ts'

const find = (raw: RawClient, check: string, c = ctx) => exclusions(raw, c).find((f) => f.check === check)

describe('contradiction.* exclusions', () => {
  it('finds the energy held through funds against "no fossil fuels", with the smallest fix (CASE-004)', () => {
    const f = find(client('CASE-004'), 'contradiction.fossil-fuel')!
    expect(f.id).toBe('contradiction.fossil-fuel:CASE-004:fossil:2025-03-05')
    expect(f.severity).toBe('risk')
    expect(f.numbers!.direct).toBe(0)
    expect(f.numbers!.total).toBeCloseTo(0.0335, 3)
    expect(f.numbers!.after).toBeCloseTo(0.0105, 3)
    expect(f.fix!.Reason).toBe('SPDR MSCI World Energy UCITS ETF verkaufen')
    expect(f.evidence[0]).toMatchObject({ source: 'Kundennotiz', date: '2025-03-05' })
    expect(f.evidence.find((e) => e.source === 'Vorschlag')!.quote).toMatch(/^Verkauf SPDR MSCI World Energy UCITS ETF über CHF [\d']+$/)
  })

  it('accepts a "no direct positions" wish when energy sits only inside funds, and says how much (CASE-037)', () => {
    const f = find(client('CASE-037'), 'contradiction.fossil-fuel')!
    expect(f.severity).toBe('ok')
    expect(f.fix).toBeUndefined()
    expect(f.numbers!.direct).toBe(0)
    expect(f.numbers!.viaFunds).toBeGreaterThan(0.005)
    expect(f.title).toMatch(/erfüllt: keine Direktanlage, über breite Fonds 0\.9% Energie/)
  })

  it('flags a direct energy stock against "no direct positions" (CASE-017)', () => {
    const f = find(client('CASE-017'), 'contradiction.fossil-fuel')!
    expect(f.severity).toBe('risk')
    expect(f.fix!.SecurityPositions[0].SecurityName).toMatch(/Neste/)
    expect(f.numbers!.after).toBe(0)
  })

  it('flags emerging markets held via funds (CASE-039) and not where there are none (CASE-006)', () => {
    expect(find(client('CASE-039'), 'contradiction.region')!.severity).toBe('risk')
    expect(find(client('CASE-006'), 'contradiction.region')!.severity).toBe('ok')
  })

  it('says a defense/tobacco or human-rights wish cannot be checked (CASE-003, CASE-025)', () => {
    const f = find(client('CASE-025'), 'contradiction.unverifiable')!
    expect(f).toMatchObject({ kind: 'action', severity: 'info' })
    expect(f.detail).toMatch(/Nicht automatisch prüfbar.*gemeinsam durchgehen/)
    expect(find(client('CASE-003'), 'contradiction.unverifiable')!.title).toMatch(/Rüstung/)
  })

  it('stays silent for a client without exclusion wishes (CASE-001)', () => {
    expect(exclusions(client('CASE-001'), ctx)).toEqual([])
  })

  it('counts unknown securities as unclassified and does not throw', () => {
    const raw = structuredClone(client('CASE-004')) as { Portfolios: { SecurityPositions: { SecurityId: number }[] }[] }
    raw.Portfolios[0].SecurityPositions[0].SecurityId = 99_999_999
    expect(find(raw, 'contradiction.fossil-fuel')!.numbers!.unclassified).toBeGreaterThan(0)
  })

  it('reads a note the model classified, as a warning to confirm', () => {
    const raw = structuredClone(client('CASE-004'))
    raw.ClientNotes = [{ Note: 'Bitte keine Ölfirmen im Depot', CreatedByDateUTC: '2026-09-01T10:00:00Z' }]
    expect(exclusions(raw, ctx)).toEqual([])
    const f = find(raw, 'contradiction.fossil-fuel', { ...ctx, wishes: { 'Bitte keine Ölfirmen im Depot': { type: 'exclude-sector', sector: 'Energy', scope: 'any' } } })!
    expect(f.severity).toBe('warn')
    expect(f.fix!.Reason).toBe('SPDR MSCI World Energy UCITS ETF verkaufen')
    expect(f.detail).toMatch(/von der KI/)
  })
})
