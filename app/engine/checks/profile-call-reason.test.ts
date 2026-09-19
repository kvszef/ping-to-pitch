import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { callReason } from './profile-call-reason.ts'

describe('profile.call-reason', () => {
  it('ranks CASE-042: bonds maturing first, then the open draft, then the weak month', () => {
    const f = callReason(client('CASE-042'), ctx)
    expect(f.map((x) => x.id.split(':')[2])).toEqual(['maturity', 'draft', 'performance'])
    expect(f[0].title).toBe('3 Obligationen werden bis 21.10.2026 fällig: Wiederanlage')
    expect(f[0].numbers).toMatchObject({ rank: 1, count: 3, daysToFirst: 25 })
    expect(f[1].title).toBe('Rückfrage zum offenen Vorschlag «Auszahlungswunsch» vom 14.06.2026')
    expect(f[2].numbers!.lastMonth).toBeLessThanOrEqual(-0.03)
    expect(f.every((x) => x.kind === 'interpretation' && x.evidence.length > 0)).toBe(true)
  })

  it('sees that CASE-046 already called today', () => {
    const [f] = callReason(client('CASE-046'), ctx)
    expect(f.title).toBe('Hat am 19.09.2026 schon angerufen (Vorschlag abgelehnt): Nachfrage wahrscheinlich')
    expect(f.numbers).toMatchObject({ daysAgo: 0, rank: 1 })
  })

  it('picks up the recent note on CASE-045 without quoting its wording', () => {
    const f = callReason(client('CASE-045'), ctx)
    expect(f[0].title).toBe('Anliegen aus der Notiz vom 09.09.2026: Nachlass- und Nachfolgeplanung wird überprüft')
  })

  it('guesses nothing for CASE-009: no draft, maturity, recent note or proposal, no drop', () => {
    expect(callReason(client('CASE-009'), ctx)).toEqual([])
  })

  it('yields nothing for an empty client', () => {
    expect(callReason({ Proposals: null, Portfolios: null, ClientNotes: null }, ctx)).toEqual([])
  })
})
