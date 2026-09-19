import { describe, expect, it } from 'vitest'
import { EXAMPLE_HOUSE_VIEW, exampleHouseView, houseViewIn, ratingName } from '../houseview.ts'
import { hasPrefix } from '../lang.ts'
import { client, clients, ctx } from '../test-data.ts'
import { houseView, reasonOf, stepOf } from './cio-house-view.ts'

const withView = { ...ctx, houseView: EXAMPLE_HOUSE_VIEW }

describe('cio.house-view', () => {
  it('flags the USD sleeve against a hedge view (CASE-012)', () => {
    const out = houseView(client('CASE-012'), withView)
    const usd = out.find((f) => f.id.endsWith('CurrencyGroup:US-Dollar'))!
    expect(usd.kind).toBe('interpretation')
    expect(usd.severity).toBe('warn')
    expect(usd.numbers!.actual).toBeGreaterThan(usd.numbers!.target!)
    expect(usd.title).toMatch(/^Neu seit 15\.09\.2026 \(vorher neutral\): Hausmeinung US-Dollar untergewichten \(absichern\), Portfolio 75\.3%/)
    expect(usd.numbers!.changed).toBe(1)
    expect(usd.evidence[0]).toMatchObject({ source: 'Hausmeinung (Beispiel)' })
  })

  it('names a recommended product for an opportunity, not one the client holds (CASE-017)', () => {
    const out = houseView(client('CASE-017'), withView)
    const chances = out.filter((f) => f.kind === 'action')
    expect(chances.length).toBeGreaterThan(0)
    for (const f of chances) {
      expect(f.numbers!.actual).toBeLessThan(f.numbers!.target!)
      expect(f.detail).toMatch(/Empfehlungsliste: \S|Vorschlag: /)
    }
  })

  it('proposes a re-checked step funded from the deviation (CASE-004: energy fund into bonds)', () => {
    const bonds = houseView(client('CASE-004'), withView).find((f) => f.id.endsWith('AssetClass:Bonds'))!
    expect(bonds.fix?.SecurityPositions.length).toBe(2)
    const [sell, buy] = bonds.fix!.SecurityPositions
    expect(sell.TotalAmountInProposalCurrency).toBeLessThan(0)
    expect(buy.TotalAmountInProposalCurrency).toBe(-sell.TotalAmountInProposalCurrency!)
    expect(bonds.numbers!.after).toBeGreaterThan(bonds.numbers!.actual)
    expect(bonds.detail).toMatch(/Vorschlag: Verkauf .+ CHF [\d']+, Kauf .+ CHF [\d']+\. Danach: Obligationen 20\.5% → /)
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

  it('phrases everything in English, also when the German example view is passed (ctx.lang)', () => {
    const en = { ...withView, lang: 'en' as const }
    const usd = houseView(client('CASE-012'), en).find((f) => f.id.endsWith('CurrencyGroup:US-Dollar'))!
    expect(usd.title).toMatch(/^New since 15\.09\.2026 \(previously neutral\): House view US dollar underweight \(hedge\), portfolio 75\.3%/)
    expect(usd.evidence[0]).toMatchObject({ source: 'House view (example)', quote: 'House view September 2026' })
    const bonds = houseView(client('CASE-004'), en).find((f) => f.id.endsWith('AssetClass:Bonds'))!
    expect(bonds.detail).toMatch(/Proposal: sell .+ CHF [\d']+, buy .+ CHF [\d']+\. After that: Bonds 20\.5% → /)
    expect(stepOf(bonds.detail)?.after).toMatch(/^Bonds 20\.5% → /)
    expect(reasonOf(bonds.detail)).toBe('Yields are attractive again after the rise, duration protects in a slowdown.')
    expect(bonds.fix?.Reason).toBe('Top up Bonds in line with the house view')
    const german = houseView(client('CASE-004'), withView).find((f) => f.id.endsWith('AssetClass:Bonds'))!
    expect(bonds.numbers).toEqual(german.numbers)
    expect(stepOf(german.detail)?.step).toMatch(/^Verkauf /)
    expect(houseView(client('CASE-017'), en).filter((f) => f.kind === 'action').every((f) => hasPrefix(f.title, 'opportunity') || f.title.startsWith('New since '))).toBe(true)
  })

  it('has an English twin of the example view with the same ids, ratings and dates', () => {
    const strip = (v: typeof EXAMPLE_HOUSE_VIEW) => ({ id: v.id, date: v.date, example: v.example, stances: v.stances.map((s) => [s.dimension, s.category, s.rating, s.previous, s.changed]) })
    expect(strip(exampleHouseView('en'))).toEqual(strip(EXAMPLE_HOUSE_VIEW))
    expect(exampleHouseView()).toBe(EXAMPLE_HOUSE_VIEW)
    expect(ratingName(-2, 'en')).toBe('strongly underweight')
    expect(ratingName(1)).toBe('übergewichten')
    const own = { ...EXAMPLE_HOUSE_VIEW, id: 'bank-2026-09', example: false }
    expect(houseViewIn(own, 'en')).toBe(own) // a bank's own view stays in the language it was written in
  })
})
