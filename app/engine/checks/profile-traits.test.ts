import { describe, expect, it } from 'vitest'
import { client, clients, ctx } from '../test-data.ts'
import { checks } from './index.ts'
import { traits } from './profile-traits.ts'

const keyOf = (id: string) => id.split(':').pop()

describe('profile.trait', () => {
  it('reads CASE-037: reacts to losses, wants to be asked, values, family, follows proposals', () => {
    const f = traits(client('CASE-037'), ctx)
    expect(f.map((x) => keyOf(x.id))).toEqual(['loss-reacts', 'control', 'values', 'family', 'delegating', 'engaged'])
    for (const x of f) {
      expect(x.kind).toBe('interpretation')
      expect(x.title).toMatch(/^(Wirkt eher|Reagiert eher|Deutet auf)/)
      expect(x.evidence.length).toBeGreaterThan(0)
    }
    const reacts = f.find((x) => x.id === 'profile.trait:CASE-037:loss-reacts')!
    expect(reacts.numbers!.afterLoss).toBeGreaterThanOrEqual(2)
    expect(reacts.evidence.some((e) => e.source === 'Anlagevorschlag' && e.ref)).toBe(true)
    const delegating = f.find((x) => x.id.endsWith(':delegating'))!
    expect(delegating.numbers).toMatchObject({ decided: 16 })
    expect(delegating.numbers!.acceptRate).toBeCloseTo(15 / 16)
  })

  it('reads CASE-023 as self-directed from the notes, and not as delegating or reacting to losses', () => {
    const f = traits(client('CASE-023'), ctx)
    const autonomy = f.find((x) => x.id === 'profile.trait:CASE-023:autonomy')!
    expect(autonomy.evidence.filter((e) => e.source === 'Kundennotiz')).toHaveLength(2)
    expect(f.some((x) => x.id.endsWith(':delegating') || x.id.endsWith(':loss-reacts'))).toBe(false)
    const braver = f.find((x) => x.id.endsWith(':risk-braver'))!
    expect(braver.numbers!.volaRatio).toBeGreaterThan(1)
  })

  it('reads CASE-012 as self-directed from 12 of 18 rejected proposals', () => {
    const autonomy = traits(client('CASE-012'), ctx).find((x) => x.id.endsWith(':autonomy'))!
    expect(autonomy.numbers).toMatchObject({ decided: 18 })
    expect(autonomy.numbers!.rejectRate).toBeCloseTo(12 / 18)
  })

  it('yields nothing for an empty client and survives nulls everywhere', () => {
    expect(traits({}, ctx)).toEqual([])
    expect(traits({ ClientRef: 'X', ClientNotes: null, Proposals: null, Portfolios: null, Tags: null, Birthday: 'kein Datum' }, ctx)).toEqual([])
  })

  it('never names a person, never mentions health, on all 47 clients', () => {
    for (const c of clients) {
      const out = ['profile.trait', 'profile.persona', 'profile.tone', 'profile.call-reason'].flatMap((k) => checks[k](c, ctx))
      const text = JSON.stringify(out)
      for (const name of [c.FirstName, c.LastName, c.Company]) if (typeof name === 'string' && name.length > 2) expect(text, String(c.ClientRef)).not.toContain(name)
      expect(text, String(c.ClientRef)).not.toMatch(/medic|health concern|Arzt|krank|gesundheitlich/i) // 'Health Care' is an industry tag, allowed
      expect(text).not.toContain('ß')
    }
  })
})
