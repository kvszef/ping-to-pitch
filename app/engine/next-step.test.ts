import { describe, expect, it } from 'vitest'
import { run } from './run.ts'
import { client, clients, ctx } from './test-data.ts'

describe('nextStep', () => {
  it('tells the advisor what to do with uninvested cash (CASE-001)', () => {
    const liq = run(client('CASE-001'), ctx).find((f) => f.check === 'portfolio.liquidity')!
    expect(liq.next).toBe('Das Geld liegt nicht angelegt da. Fragen, ob der Kunde investieren will oder es für etwas Bestimmtes bereithält.')
    const en = run(client('CASE-001'), { ...ctx, lang: 'en' }).find((f) => f.check === 'portfolio.liquidity')!
    expect(en.next).toBe('The money is not invested. Ask whether the client wants to invest it or is keeping it ready for something specific.')
  })

  it('separates too much risk from too little (CASE-012 over, CASE-002 under the band)', () => {
    expect(run(client('CASE-012'), ctx).find((f) => f.id.endsWith(':band'))!.next).toContain('Risiko senken')
    expect(run(client('CASE-002'), ctx).find((f) => f.id.endsWith(':band'))!.next).toContain('bewusst vorsichtiger')
  })

  it('covers every finding of all clients except the tone hints, which are instructions already', () => {
    for (const c of clients) for (const f of run(c, ctx)) if (f.check !== 'profile.tone') expect(f.next, f.id).toBeTruthy()
  })

  it('leaves a finding without numbers or evidence alone instead of throwing', () => {
    expect(run({ ClientRef: 'X', SuitabilityViolations: [{}] }, ctx).every((f) => typeof (f.next ?? '') === 'string')).toBe(true)
  })
})
