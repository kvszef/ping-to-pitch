import { describe, expect, it } from 'vitest'
import { readClient } from '../../engine/data.ts'
import { client as caseClient, ref } from '../../engine/test-data.ts'
import { parseRss } from './bing.ts'
import { holdingsOf, searchTerm } from './holdings.ts'
import { isQuotePage, newsFindings, newsHits, ruleJudgement } from './news.ts'

const NOW = new Date('2026-09-19T08:00:00Z')

describe('searchTerm', () => {
  it('turns security names into what the news writes', () => {
    expect(searchTerm('Namen-Aktie Nestle SA', false)).toBe('Nestle')
    expect(searchTerm('Genussschein Roche Holding AG', false)).toBe('Roche')
    expect(searchTerm('0.375 % OC Oerlikon Corporation AG, Pfaeffikon 2021-27.11.25 Reg S', false)).toBe('OC Oerlikon')
    expect(searchTerm('Anteile Exchange Traded Fund USD iShares VII PLC - iShares Core S&P 500 UCITS ETF', true)).toBe('S&P 500')
    expect(searchTerm('Anteile -A- iShares ETF (CH) - iShares Swiss Dividend ETF   (CH)', true)).toBe('Swiss Dividend')
  })
  it('gives up on names with nothing searchable', () => {
    expect(searchTerm('AG', false)).toBeUndefined()
  })
})

describe('holdingsOf', () => {
  it('finds Nestle among the biggest holdings of CASE-017', () => {
    const h = holdingsOf(readClient(caseClient('CASE-017'), ref))
    const nestle = h.find((x) => x.query === 'Nestle')
    expect(nestle?.weight).toBeGreaterThan(0.01)
    expect(h.length).toBeLessThanOrEqual(8)
  })
  it('returns nothing for a client without portfolios', () => {
    expect(holdingsOf(readClient({ ClientRef: 'X' }, ref))).toEqual([])
  })
})

const RSS = `<rss><channel><item><title>Nestl&#233; k&#228;mpft um Russland-Gesch&#228;ft</title>
<link>http://www.bing.com/news/apiclick.aspx?ref=x&amp;url=https%3a%2f%2fwww.cash.ch%2fnews%2fnestle&amp;c=1</link>
<description>Russland beschlagnahmt Verm&#246;genswerte von Nestl&#233;.</description><pubDate>Fri, 18 Sep 2026 14:02:00 GMT</pubDate><News:Source>cash</News:Source></item>
<item><title>Kurs Nestle SA</title><link>https://example.ch/kurs</link><description></description></item></channel></rss>`

describe('parseRss', () => {
  it('decodes titles and unwraps the Bing click link', () => {
    const [a] = parseRss(RSS)
    expect(a.title).toBe('Nestlé kämpft um Russland-Geschäft')
    expect(a.url).toBe('https://www.cash.ch/news/nestle')
    expect(a.source).toBe('cash')
    expect(a.published).toBe('2026-09-18T14:02:00.000Z')
  })
})

describe('news agent without a model', () => {
  it('judges a sanctions headline as a risk and drops price pages', () => {
    expect(ruleJudgement({ title: 'Nestlé kämpft um Russland-Geschäft', snippet: '' }, 'Nestle').direction).toBe('risk')
    expect(ruleJudgement({ title: 'Swisscom erhöht Dividende', snippet: '' }, 'Nestle').relevant).toBe(false)
    expect(isQuotePage('Kurs Nestle SA')).toBe(true)
    expect(isQuotePage('Kursziel für Roche erhöht')).toBe(false)
  })

  it('turns a hit into a finding and a call reason with the client weight', async () => {
    const holdings = holdingsOf(readClient(caseClient('CASE-017'), ref))
    const search = async (q: string) => (q === 'Nestle' ? parseRss(RSS) : [])
    const hits = await newsHits(holdings, NOW, null, search)
    expect(hits).toHaveLength(1)
    const f = newsFindings('CASE-017', hits)
    expect(f.map((x) => x.check)).toEqual(['news.hit', 'profile.call-reason'])
    expect(f[0].severity).toBe('risk')
    expect(f[0].numbers?.weight).toBeCloseTo(hits[0].holding.weight)
  })

  it('finds nothing when the search finds nothing', async () => {
    const holdings = holdingsOf(readClient(caseClient('CASE-004'), ref))
    expect(await newsHits(holdings, NOW, null, async () => [])).toEqual([])
  })
})
