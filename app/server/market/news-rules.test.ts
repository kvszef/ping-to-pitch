import { describe, expect, it } from 'vitest'
import { isBareName, isQuotePage, recent, ruleJudgement } from './news.ts'

// Found in the content audit of the call-today list: adverts, intraday tickers and fund pages were
// judged as reasons to call, and keywords fired inside other words.
describe('isQuotePage', () => {
  it.each([
    'zCapital Swiss Dividend Fund M Fonds',
    'Portfolio-Tracker: Depot verwalten mit Dividendenplaner',
    'Börsen-Ticker: SMI startet fester',
    'Holcim-Aktie gibt am Vormittag nach',
    'Givaudan-Aktie verzeichnet am Mittag Kursverluste',
    'UBS BRCs mit Coupons bis 12%',
    'Lonza Aktie News',
  ])('drops «%s»', (title) => expect(isQuotePage(title)).toBe(true))

  it.each(['Nestlé senkt Prognose nach schwachem Quartal', 'Novartis verfehlt Ziel in Phase-II-Studie', 'Kursziel für Roche erhöht'])('keeps «%s»', (title) => expect(isQuotePage(title)).toBe(false))
})

describe('isBareName', () => {
  it('drops a headline that is only the name of the holding', () => {
    expect(isBareName('LONZA GROUP AG', { query: 'Lonza', names: ['Lonza Group AG'] })).toBe(true)
    expect(isBareName('Lonza baut Werk in Visp aus', { query: 'Lonza', names: ['Lonza Group AG'] })).toBe(false)
  })
})

describe('ruleJudgement', () => {
  const judge = (title: string, query = 'Nestle') => ruleJudgement({ title, snippet: '' }, query).direction

  it('does not read a fight for market share as a risk, a Russia story still is one', () => {
    expect(judge('Nestle kämpft um die Marktführerschaft')).toBe('neutral')
    expect(judge('Nestle kämpft um Russland-Geschäft')).toBe('risk')
  })

  it('matches English keywords as whole words only', () => {
    expect(judge('Nestle: Executive Cutler joins the board')).toBe('neutral')
    expect(judge('Nestle refines its coffee strategy')).toBe('neutral')
    expect(judge('Nestle cut its outlook')).toBe('risk')
    expect(judge('Nestle beats estimates, raises dividend')).toBe('opportunity')
  })

  it('still reads the plain German cases', () => {
    expect(judge('Nestle senkt die Prognose')).toBe('risk')
    expect(judge('Nestle erhöht die Dividende')).toBe('opportunity')
  })
})

describe('recent', () => {
  it('lets the offline snapshot use only what is about a month old', () => {
    const now = new Date('2026-09-19T08:00:00Z')
    expect(recent({ id: 'a', title: '', source: '', snippet: '', url: '', published: '2026-09-01T00:00:00Z' }, now, 30)).toBe(true)
    expect(recent({ id: 'b', title: '', source: '', snippet: '', url: '', published: '2003-04-19T00:00:00Z' }, now, 30)).toBe(false)
  })
})
