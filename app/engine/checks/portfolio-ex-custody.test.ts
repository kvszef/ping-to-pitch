import { describe, expect, it } from 'vitest'
import { readClient } from '../data.ts'
import { client, ctx, ref } from '../test-data.ts'
import { exCustody } from './portfolio-ex-custody.ts'

// A statement from another bank, attached the way server/import does it: one known security (Nestlé, joined by
// SecurityId) and one the reference data does not know, classified by its own SAA_* fields.
const external = {
  PortfolioId: 900_000_001, PortfolioNr: 'Fremddepot 1', Name: 'Fremddepot (ex-custody) · Beispielbank AG', PortfolioCurrency: 'CHF',
  AssetsUnderManagementInDefaultCurrency: 100_000, FactoryDateUtc: '2025-12-31', isExCustody: true,
  SecurityPositions: [
    { SecurityId: 644, Isin: 'CH0038863350', SecurityName: 'N-Akt Nestlé AG', Currency: 'CHF', TotalAmountInPortfolioCurrency: 60_000, PortfolioValuePercentage: 0.6 },
    { SecurityId: -1, Isin: 'XS0000000000', SecurityName: '3.0% Beispiel AG 2024-2030', Currency: 'EUR', TotalAmountInPortfolioCurrency: 30_000, PortfolioValuePercentage: 0.3, SAA_AssetClassName: 'Bonds', SAA_CurrencyGroupName: 'Euro' },
  ],
  AccountPositions: [{ Currency: 'CHF', TotalAmountInPortfolioCurrency: 10_000, PortfolioValuePercentage: 0.1 }],
}
const withExternal = () => { const c = structuredClone(client('CASE-004')); (c.Portfolios as unknown[]).push(external); return c }

describe('portfolio.ex-custody', () => {
  it('names an imported portfolio with its value and share of the total (CASE-004 + statement)', () => {
    const [f] = exCustody(withExternal(), ctx)
    expect(f.severity).toBe('info')
    expect(f.title).toBe(`Fremddepot 1 bei Beispielbank AG: CHF 100'000, ${((100_000 / (534_191 + 100_000)) * 100).toFixed(1)}% des Gesamtvermögens (Auszug vom 31.12.2025)`)
    expect(f.numbers!.guessedShare).toBeCloseTo(0.3, 6)
    expect(f.evidence[0]).toMatchObject({ source: 'Fremddepot (Auszug)', ref: 'Fremddepot 1' })
  })

  it('stays silent without an imported portfolio (CASE-004) and on garbage', () => {
    expect(exCustody(client('CASE-004'), ctx)).toEqual([])
    expect(exCustody({}, ctx)).toEqual([])
  })

  it('reads an unknown security by its own SAA fields; without them it stays unclassified', () => {
    const p = readClient(withExternal(), ref).portfolios.find((x) => x.isExCustody)!
    expect(p.positions.find((x) => x.securityId === 644)!.security?.assetClass).toBe('Shares')
    expect(p.positions.find((x) => x.securityId === -1)!.security).toMatchObject({ assetClass: 'Bonds', currencyGroup: 'Euro', recommended: false, lookThrough: false })
    const bare = structuredClone(external)
    delete (bare.SecurityPositions[1] as Record<string, unknown>).SAA_AssetClassName
    const c = structuredClone(client('CASE-004')); (c.Portfolios as unknown[]).push(bare)
    expect(readClient(c, ref).portfolios.find((x) => x.isExCustody)!.positions.find((x) => x.securityId === -1)!.security).toBeUndefined()
  })
})
