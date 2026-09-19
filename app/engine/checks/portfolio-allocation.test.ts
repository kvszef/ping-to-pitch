import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { allocation } from './portfolio-allocation.ts'

const find = (ref: string, subject: string) => allocation(client(ref), ctx).find((f) => f.id === `portfolio.allocation:${ref}:${subject}`)

describe('portfolio.allocation', () => {
  it('flags the three region deviations the bank also reports on CASE-037-02', () => {
    const na = find('CASE-037', 'CASE-037-02:CountryGroup:North America')!
    expect(na.severity).toBe('warn')
    expect(na.numbers?.actual).toBeCloseTo(0.2388, 3)
    expect(na.numbers?.bankFlagged).toBe(1)
    expect(find('CASE-037', 'CASE-037-02:CountryGroup:Rest of Europe')?.numbers?.bankFlagged).toBe(1)
    expect(find('CASE-037', 'CASE-037-02:CountryGroup:Asia/Pacific (ex Japan)')).toBeDefined()
  })

  it('says there is no target for a No-strategy portfolio instead of checking it', () => {
    expect(find('CASE-037', 'CASE-037-01:no-target')?.severity).toBe('info')
    expect(allocation(client('CASE-037'), ctx).filter((f) => f.id.includes('CASE-037-01:') && f.severity !== 'info')).toEqual([])
  })

  it('reports an all-cash advisory portfolio as one asset-class breach', () => {
    const f = find('CASE-001', 'CASE-001-01:AssetClass')!
    expect(f.severity).toBe('risk')
    expect(f.numbers?.['Liquidity.actual']).toBeCloseTo(1, 2)
    expect(allocation(client('CASE-001'), ctx).filter((x) => x.id.includes(':AssetClass'))).toHaveLength(1)
  })

  it('reads currency limits from the bank rule texts', () => {
    const usd = find('CASE-012', 'CASE-012-01:CurrencyGroup:US-Dollar')!
    expect(usd.numbers?.limit).toBeCloseTo(0.355, 3)
    expect(usd.numbers?.actual).toBeGreaterThan(0.7)
    expect(find('CASE-037', 'CASE-037-02:CurrencyGroup:US-Dollar')).toBeUndefined()
  })

  it('matches sector names across the rule and target vocabularies', () => {
    const telecom = find('CASE-023', 'CASE-023-01:Industry:Telecommunication Services')!
    expect(telecom.severity).toBe('risk')
    expect(telecom.title).toContain('Kommunikation')
  })

  it('phrases the findings in English with the same numbers (CASE-012, CASE-037)', () => {
    const en = { ...ctx, lang: 'en' as const }
    const usd = allocation(client('CASE-012'), en).find((f) => f.id.endsWith(':CurrencyGroup:US-Dollar'))!
    expect(usd.title).toMatch(/^CASE-012-01: USD share 75\.\d%, the bank's limit is 35\.5% \(\+\d+\.\d pp\)$/)
    expect(usd.numbers).toEqual(find('CASE-012', 'CASE-012-01:CurrencyGroup:US-Dollar')!.numbers)
    expect(usd.evidence[0].source).toBe('Suitability rule')
    const f = allocation(client('CASE-037'), en)
    expect(f.find((x) => x.id.endsWith('CASE-037-01:no-target'))!.title).toBe('CASE-037-01: no target allocation on file, deviations are not checked')
    expect(f.find((x) => x.id.endsWith('CASE-037-02:CountryGroup:North America'))!.title).toContain('underweight in the equity region North America')
  })
})

describe('portfolio.allocation with securities the reference data does not know', () => {
  // Half of CASE-037's securities get ids nobody has seen, as in a client file handed over at the live demo.
  const unseen = structuredClone(client('CASE-037'))
  for (const p of unseen.Portfolios as { SecurityPositions: { SecurityId: number }[] }[]) p.SecurityPositions.forEach((s, i) => { if (i % 2 === 0) s.SecurityId += 9_000_000 })

  it('states the unclassified share and does not assert a band breach the unknown part could undo', () => {
    const f = allocation(unseen, { ...ctx, lang: 'en' })
    const gap = f.find((x) => x.id.endsWith('CASE-037-02:unclassified'))
    expect(gap?.severity).toBe('warn')
    expect(gap?.title).toMatch(/of the portfolio cannot be classified/)
    expect(gap?.numbers?.unclassified).toBeGreaterThan(0.2)
    // Shares are measured below the 20% minimum, but more than half of the portfolio is unknown: not a fact.
    expect(f.some((x) => x.id.endsWith('CASE-037-02:AssetClass') && x.severity === 'risk' && /below the minimum/.test(x.title))).toBe(false)
    const open = f.find((x) => x.id.endsWith('CASE-037-02:AssetClass:uncertain'))
    expect(open?.kind).toBe('interpretation')
    expect(open?.severity).toBe('info')
    // Region and sector gaps stay visible, but never as a hard risk while the equity part itself is uncertain.
    expect(f.filter((x) => /CASE-037-02:(CountryGroup|Industry):/.test(x.id)).every((x) => x.severity !== 'risk')).toBe(true)
  })

  it('changes nothing for a client whose securities are all known', () => {
    expect(allocation(client('CASE-037'), ctx).some((x) => /:unclassified$|:uncertain$/.test(x.id))).toBe(false)
  })
})
