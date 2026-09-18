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
})
