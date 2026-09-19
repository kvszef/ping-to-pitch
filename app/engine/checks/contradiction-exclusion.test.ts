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

  it('phrases the same findings in English (ctx.lang): titles, fix, evidence sources; the note stays as written', () => {
    const en = { ...ctx, lang: 'en' as const }
    const de = find(client('CASE-004'), 'contradiction.fossil-fuel')!
    const f = find(client('CASE-004'), 'contradiction.fossil-fuel', en)!
    expect(f).toMatchObject({ id: de.id, severity: de.severity, numbers: de.numbers })
    expect(f.title).toMatch(/^Contradiction: Wish «No exposure to fossil fuels», portfolio holds 3\.3% energy, all through \d+ funds$/)
    expect(f.detail).toMatch(/^Largest driver: SPDR MSCI World Energy UCITS ETF with 2\.3%\. Selling it leaves 1\.0%\. After the sale: no new warning/)
    expect(f.fix!.Reason).toBe('Sell SPDR MSCI World Energy UCITS ETF')
    expect(f.fix!.SecurityPositions).toEqual(de.fix!.SecurityPositions)
    expect(f.evidence[0]).toEqual({ ...de.evidence[0], source: 'Client note' })
    expect(f.evidence.find((e) => e.source === 'Suggested fix')!.quote).toMatch(/^Sale of SPDR MSCI World Energy UCITS ETF for CHF [\d']+$/)
    expect(find(client('CASE-037'), 'contradiction.fossil-fuel', en)!.title).toMatch(/^Wish «No direct positions in fossil fuels» met: no direct holding, 0\.9% energy through broad funds$/)
    expect(find(client('CASE-003'), 'contradiction.unverifiable', en)!.title).toBe('Wish «ESG-compliant, no defence and no tobacco» is noted but cannot be verified')
    expect(find(client('CASE-025'), 'contradiction.unverifiable', en)!.detail).toMatch(/^Cannot be checked automatically: the data has no category «human-rights controversies»/)
  })

  it('labels a wish the model classified in English from the menu item, not from the model', () => {
    const raw = structuredClone(client('CASE-004'))
    raw.ClientNotes = [{ Note: 'Bitte keine Ölfirmen im Depot', CreatedByDateUTC: '2026-09-01T10:00:00Z' }]
    const f = find(raw, 'contradiction.fossil-fuel', { ...ctx, lang: 'en', wishes: { 'Bitte keine Ölfirmen im Depot': { type: 'exclude-sector', sector: 'Energy', scope: 'any' } } })!
    expect(f.title).toMatch(/^Contradiction: Wish «No exposure to fossil fuels», portfolio holds /)
    expect(f.detail).toMatch(/Wish read from the note by the AI, please confirm\.$/)
    expect(f.evidence[0].quote).toBe('Bitte keine Ölfirmen im Depot')
  })
})
