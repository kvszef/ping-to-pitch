import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { plan } from './context-plan.ts'

describe('context.plan', () => {
  it('keeps the retirement plan as a fact with the months left (CASE-004)', () => {
    const [f] = plan(client('CASE-004'), ctx)
    expect(f.id).toBe('context.plan:CASE-004:2026-06-09:pensionierung')
    expect(f.kind).toBe('fact')
    expect(f.topic).toBe('liquidity')
    expect(f.title).toBe('Pensionierung: noch 20 Monate (bis 09.06.2028)')
    expect(f.numbers!.monthsLeft).toBe(20)
    expect(f.detail).toMatch(/\?$/)
    expect(f.evidence[0]).toMatchObject({ source: 'Kundennotiz', date: '2026-06-09' })
  })

  it('lists an open-ended plan without months left, and nothing for an expired one', () => {
    const [donation] = plan(client('CASE-006'), ctx)
    expect(donation.title).toMatch(/^Spende: /)
    expect(donation.numbers!.monthsLeft).toBeUndefined()
    expect(plan(client('CASE-007'), ctx)).toEqual([])
    expect(plan({}, ctx)).toEqual([])
  })

  it('phrases the same finding in English, with the same id and title shape (ctx.lang)', () => {
    const [f] = plan(client('CASE-004'), { ...ctx, lang: 'en' })
    expect(f.id).toBe('context.plan:CASE-004:2026-06-09:pensionierung')
    expect(f.title).toBe('Retirement: 20 months left (until 09.06.2028)')
    expect(f.detail).toMatch(/^Note of 09\.06\.2026: .*\?$/)
    expect(f.evidence[0]).toMatchObject({ source: 'Client note', date: '2026-06-09' })
    expect(plan(client('CASE-006'), { ...ctx, lang: 'en' })[0].title).toMatch(/^Donation: /)
  })
})
