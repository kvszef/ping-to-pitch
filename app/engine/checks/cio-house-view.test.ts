import { describe, expect, it } from 'vitest'
import { EXAMPLE_HOUSE_VIEW } from '../houseview.ts'
import { client, clients, ctx } from '../test-data.ts'
import { houseView } from './cio-house-view.ts'

const withView = { ...ctx, houseView: EXAMPLE_HOUSE_VIEW }

describe('cio.house-view', () => {
  it('flags the USD sleeve against a hedge view (CASE-012)', () => {
    const out = houseView(client('CASE-012'), withView)
    const usd = out.find((f) => f.id.endsWith('CurrencyGroup:US-Dollar'))!
    expect(usd.kind).toBe('interpretation')
    expect(usd.severity).toBe('warn')
    expect(usd.numbers!.actual).toBeGreaterThan(usd.numbers!.target!)
    expect(usd.title).toMatch(/^Hausmeinung US-Dollar untergewichten \(absichern\), Portfolio 75\.3%/)
    expect(usd.evidence[0]).toMatchObject({ source: 'Hausmeinung (Beispiel)' })
  })

  it('names a recommended product for an opportunity, not one the client holds (CASE-017)', () => {
    const out = houseView(client('CASE-017'), withView)
    const chances = out.filter((f) => f.kind === 'action')
    expect(chances.length).toBeGreaterThan(0)
    for (const f of chances) {
      expect(f.numbers!.actual).toBeLessThan(f.numbers!.target!)
      expect(f.detail).toMatch(/Empfehlungsliste: \S/)
    }
  })

  it('stays quiet where the portfolio is in line, and without a house view (CASE-037)', () => {
    const [summary] = houseView(client('CASE-037'), withView)
    expect(summary.numbers!.inLine).toBeGreaterThanOrEqual(summary.numbers!.measured - 1)
    expect(houseView(client('CASE-037'), ctx)).toEqual([])
    expect(houseView({}, withView)).toEqual([])
  })

  it('never suggests a sector a client excluded, and runs on every client', () => {
    for (const c of clients) {
      const out = houseView(c, withView)
      expect(out.length).toBeLessThanOrEqual(4)
      expect(out.filter((f) => f.kind === 'action' && /Energie/.test(f.title))).toEqual([])
    }
  })
})
