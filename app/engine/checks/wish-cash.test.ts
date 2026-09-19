import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { cash } from './wish-cash.ts'

describe('wish.cash', () => {
  it('warns when the named amount is not in the accounts (CASE-012: CHF 15,000 for taxes)', () => {
    const [f] = cash(client('CASE-012'), ctx)
    expect(f.severity).toBe('warn')
    expect(f.numbers!.amount).toBe(15000)
    expect(f.numbers!.gap).toBeGreaterThan(14000)
    expect(f.title).toMatch(/nicht gedeckt: Konten CHF [\d']+, es fehlen CHF [\d']+/)
  })

  it('is ok when the accounts cover it (CASE-016)', () => {
    expect(cash(client('CASE-016'), ctx)[0].severity).toBe('ok')
  })

  it('states the cash share when no amount is named (CASE-004), and is silent without the wish (CASE-002)', () => {
    const [f] = cash(client('CASE-004'), ctx)
    expect(f.severity).toBe('info')
    expect(f.numbers!.cashShare).toBeCloseTo(0.0165, 3)
    expect(f.evidence[0]).toMatchObject({ source: 'Kundennotiz', date: '2025-04-14' })
    expect(cash(client('CASE-002'), ctx)).toEqual([])
  })
})
