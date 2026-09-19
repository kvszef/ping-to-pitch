import { describe, expect, it } from 'vitest'
import { checkWhy, companyName, isNews, mentions, newsFor, parseRss, rank, searchTerms, similar, termFor, type Candidate } from './news-agent.ts'

const NOW = Date.parse('2026-09-19T10:00:00Z')

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Google News</title>
<item><title>Nestlé bestätigt Jahresausblick &amp; Dividende - finews.ch</title><link>https://news.example/a</link>
<pubDate>Fri, 18 Sep 2026 07:30:00 GMT</pubDate><source url="https://finews.ch">finews.ch</source></item>
<item><title><![CDATA[Roche: FDA-Entscheid verschoben]]></title><link>https://news.example/b</link>
<pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate></item>
<item><title>Kein Datum</title><link>https://news.example/c</link></item>
</channel></rss>`

describe('parseRss', () => {
  it('reads title, source, link and date, strips the source suffix and decodes entities', () => {
    const items = parseRss(RSS, 'Fallback')
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ title: 'Nestlé bestätigt Jahresausblick & Dividende', source: 'finews.ch', url: 'https://news.example/a', published: '2026-09-18T07:30:00.000Z' })
    expect(items[1]).toMatchObject({ title: 'Roche: FDA-Entscheid verschoben', source: 'Fallback' })
  })
  it('unwraps Bing click links and reads the Bing source tag', () => {
    const bing = `<rss><channel><item><title>Holcim testet W&#228;rmebatterien</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.cleanthinking.de%2fholcim%2f&amp;mkt=de-ch</link><pubDate>Thu, 17 Sep 2026 17:00:00 GMT</pubDate><News:Source>Cleanthinking</News:Source></item></channel></rss>`
    expect(parseRss(bing)).toEqual([{ title: 'Holcim testet Wärmebatterien', source: 'Cleanthinking', url: 'https://www.cleanthinking.de/holcim/', published: '2026-09-17T17:00:00.000Z' }])
  })
  it('returns nothing for empty or malformed input', () => {
    expect(parseRss('')).toEqual([])
    expect(parseRss('<html>blocked</html>')).toEqual([])
    expect(parseRss('<item><title>ohne Ende')).toEqual([])
    expect(parseRss(undefined as unknown as string)).toEqual([])
  })
})

describe('term derivation', () => {
  it('cleans share and fund names into search terms', () => {
    expect(companyName('Namen-Aktie Swiss Re AG')).toBe('Swiss Re')
    expect(companyName('Namen-Aktie -A- Alphabet Inc')).toBe('Alphabet')
    expect(companyName('Namen-Aktie VZ Holding AG')).toBe('VZ Holding')
    expect(termFor('Anteile -A- iShares ETF (CH) - iShares Swiss Dividend ETF   (CH)')?.query).toBe('Schweizer Dividendenaktien')
    expect(termFor('Anteile - ETF USD iShares III PLC- iShares Core MSCI World UCITS ETF')?.query).toBe('MSCI World')
    expect(termFor('Anteile -FB- Credit Suisse Index Fd (CH) Umbrella - CSIF (CH) Equity Switzerland Large Cap Blue')?.query).toBe('SMI Schweizer Aktien')
    expect(termFor('0.825 % Swiss Prime Site AG 2017-11.05.26')?.query).toBe('Swiss Prime Site')
    expect(termFor('7.1 % Reverse Convertible UBS London 2023-23.09.24 on ABB/CieFinRichemont/Alcon')).toBeNull()
    expect(termFor('Namen-Aktie Apple Inc')).toMatchObject({ query: 'Apple', ticker: 'AAPL', kind: 'titel' })
  })

  const client = {
    ClientRef: 'CASE-T', FirstName: 'Nie', LastName: 'Senden', ReportingCurrency: 'CHF',
    Portfolios: [
      { AssetsUnderManagementInDefaultCurrency: 300, SecurityPositions: [
        { SecurityId: 1, SecurityName: 'Namen-Aktie Apple Inc', Currency: 'USD', PortfolioValuePercentage: 0.5 },
        { SecurityId: 2, SecurityName: 'Namen-Aktie Nestle SA', Currency: 'CHF', PortfolioValuePercentage: 0.3 },
      ] },
      { AssetsUnderManagementInDefaultCurrency: 100, SecurityPositions: [
        { SecurityId: 1, SecurityName: 'Namen-Aktie Apple Inc', Currency: 'USD', PortfolioValuePercentage: 0.2 },
        { SecurityId: 3, SecurityName: 'Anteile -A- iShares ETF (CH) - iShares Core SPI(R) ETF (CH)', Currency: 'CHF', PortfolioValuePercentage: 0.8 },
      ] },
    ],
  }

  it('weights holdings by portfolio size and adds a currency and a sector term', () => {
    const terms = searchTerms(client, (id) => (id === 2 || id === 3 ? 'Consumer Staples' : undefined))
    expect(terms.map((t) => [t.query, t.weight])).toEqual([
      ['Apple', 42.5], ['Nestlé', 22.5], ['SMI Schweizer Aktien', 20],
      ['Dollar Franken Wechselkurs', 42.5], ['Nahrungsmittel Aktien', 42.5],
    ])
    expect(JSON.stringify(terms)).not.toMatch(/Senden|Nie/)
  })

  it('gives no terms for a client without positions', () => {
    expect(searchTerms({ ClientRef: 'X' })).toEqual([])
    expect(searchTerms({ ClientRef: 'X', Portfolios: [{ SecurityPositions: null }] })).toEqual([])
  })
})

describe('rank and checks', () => {
  const term = (query: string, weight: number) => ({ security: query, query, weight, kind: 'titel' as const })
  const c = (title: string, hoursAgo: number, t = term('Apple', 20)): Candidate => ({ title, source: 's', url: 'https://x', published: new Date(NOW - hoursAgo * 3600e3).toISOString(), term: t })

  it('drops old items and near duplicates, prefers big fresh holdings', () => {
    const out = rank([
      c('Apple stellt neues iPhone vor', 2), c('Apple stellt neues iPhone vor - Handelszeitung', 3),
      c('Alte Nachricht', 24 * 8), c('Kleine Position meldet Zahlen', 1, term('Klein', 1)),
    ], NOW)
    expect(out.map((x) => x.title)).toEqual(['Apple stellt neues iPhone vor', 'Kleine Position meldet Zahlen'])
    expect(similar('Nestlé senkt Prognose', 'Nestle senkt Prognose deutlich')).toBe(true)
  })

  it('drops price pages and converters, and ticker noise that does not name the holding', () => {
    expect(isNews('Währungsrechner: US-Dollar (USD) - Schweizer Franken (CHF)')).toBe(false)
    expect(isNews('Kurs iShares MSCI World Health Care Sector Advanced UCITS ETF (Acc) - USD')).toBe(false)
    expect(isNews('Xtrackers MSCI World ex USA ETF 1C')).toBe(false)
    expect(isNews('Deutscher Broker bringt neuen Welt-ETF auf den Markt')).toBe(true)
    const alphabet = { security: 'Alphabet', query: 'Alphabet', weight: 25, kind: 'titel' as const, ticker: 'GOOGL' }
    expect(mentions('2 Stocks to Buy as Google Starts Selling Its AI Chips', alphabet)).toBe(true)
    expect(mentions('IONQ Stock Surges On Tech Wins', alphabet)).toBe(false)
    expect(mentions('Dollar fällt', { ...alphabet, kind: 'markt' })).toBe(true)
  })

  it('accepts a model line only with numbers from the headline or the weight', () => {
    expect(checkWhy('Apple ist mit 17.8% die zweitgrösste Position.', 'Apple fällt 3%', 17.8)).toBe('Apple ist mit 17.8% die zweitgrösste Position.')
    expect(checkWhy('Verlust von 12% droht dem Portfolio.', 'Apple fällt 3%', 17.8)).toBeUndefined()
    expect(checkWhy('Grösse', 'x', 1)).toBe('Grösse')
    expect(checkWhy(42, 'x', 1)).toBeUndefined()
  })
})

describe('newsFor', () => {
  it('works offline with a fake fetcher and collects failures instead of throwing', async () => {
    const client = { ClientRef: 'CASE-T', Portfolios: [{ AssetsUnderManagementInDefaultCurrency: 1, SecurityPositions: [{ SecurityId: 2, SecurityName: 'Namen-Aktie Nestle SA', Currency: 'CHF', PortfolioValuePercentage: 1 }] }] }
    const get = async (url: string) => { if (url.includes('yahoo')) throw new Error('HTTP 429'); return RSS }
    const r = await newsFor(client, undefined, { get, now: () => NOW })
    // The Roche headline does not name the holding, so it is dropped; Google and Bing duplicates merge.
    expect(r.items.map((i) => i.title)).toEqual(['Nestlé bestätigt Jahresausblick & Dividende'])
    expect(r.items[0]).toMatchObject({ security: 'Nestlé', weight: 100, reach: 'Titel', affects: { 'CASE-T': { severity: 'info' } } })
    expect(r.items[0].tone).toBeUndefined()
    expect(r.errors?.[0]).toMatch(/Yahoo Finance.*HTTP 429/)
  })

  it('uses the model for tone and why, and drops what it marks irrelevant', async () => {
    const client = { ClientRef: 'CASE-U', Portfolios: [{ AssetsUnderManagementInDefaultCurrency: 1, SecurityPositions: [{ SecurityId: 9, SecurityName: 'Namen-Aktie Holcim AG', Currency: 'CHF', PortfolioValuePercentage: 0.1 }] }] }
    const rss = RSS.replace(/Nestlé bestätigt/, 'Holcim bestätigt').replace(/Roche: FDA/, 'Holcim: Werk')
    const complete = async () => ({ items: [{ i: 0, relevant: true, tone: 'positiv', why: 'Holcim ist mit 10.0% eine grosse Position.' }, { i: 1, relevant: false, tone: 'neutral', why: '' }] })
    const r = await newsFor(client, undefined, { get: async () => rss, complete, now: () => NOW })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ tone: 'positiv', why: 'Holcim ist mit 10.0% eine grosse Position.', affects: { 'CASE-U': { severity: 'ok' } } })
  })
})
