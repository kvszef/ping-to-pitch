import { describe, expect, it } from 'vitest'
import { readClient } from './data.ts'
import { client, clients, ref } from './test-data.ts'
import { classifyNote, parseWish, wishesOf, type Wish } from './wishes.ts'

const notes = [...new Set(clients.flatMap((c) => readClient(c, ref).notes.map((n) => n.text)))]
const wishOf = (text: string) => classifyNote(text)?.wishes

describe('classifyNote', () => {
  it('reads every note in today\'s data, none is unknown', () => {
    expect(notes.length).toBe(53)
    for (const n of notes) expect(classifyNote(n), n).toBeDefined()
  })

  it('reads the hard wishes into the menu', () => {
    const cases: [string, Wish[]][] = [
      ['No direct positions in fossil fuels, please.', [{ type: 'exclude-sector', sector: 'Energy', scope: 'direct' }]],
      ['Prefers to avoid any exposure to fossil-fuel energy in the portfolio.', [{ type: 'exclude-sector', sector: 'Energy', scope: 'any' }]],
      ['Wants exposure limited to developed markets only, no emerging markets.', [{ type: 'exclude-emerging-markets' }]],
      ['Prefers ESG-compliant investments, no defense or tobacco holdings.', [{ type: 'esg-only' }, { type: 'exclude-unverifiable', label: 'Rüstung und Tabak' }]],
      ['Does not want investments in companies with human-rights controversies.', [{ type: 'exclude-unverifiable', label: 'Menschenrechts-Kontroversen' }]],
      ['Prefers CHF-hedged investments for foreign-currency positions.', [{ type: 'prefer-chf-hedged' }]],
      ['Needs approximately CHF 15,000 in liquid funds for the Q1 tax payment.', [{ type: 'keep-cash', amountChf: 15000 }]],
      ['Prefers to keep a cash reserve on hand for unexpected medical expenses.', [{ type: 'keep-cash' }]],
      ["Mentioned wanting to keep a small reserve on hand at all times, 'just in case'.", [{ type: 'keep-cash' }]],
    ]
    for (const [text, wishes] of cases) expect(wishOf(text), text).toEqual(wishes)
  })

  it('reads the soft wishes into interests', () => {
    const cases: [string, Wish][] = [
      ['Wants as high a weighting of sustainable funds as possible at the next rebalancing.', { type: 'interest', measure: 'esg-share' }],
      ['Wants a focus on high-dividend stocks for ongoing income generation.', { type: 'interest', measure: 'dividend' }],
      ['Watching technology stocks in the portfolio closely, interested in expanding further.', { type: 'interest', measure: 'sector', sector: 'Information Technology' }],
      ['Asked for more detail on how private spaceflight and aerospace exposure could be expanded further.', { type: 'interest', measure: 'sector', sector: 'Industrials' }],
      ['Former chemistry teacher, strongly interested in chemistry and the pharmaceutical industry.', { type: 'interest', measure: 'sector', sector: 'Health Care' }],
      ['Interested in a broader diversification across currencies.', { type: 'interest', measure: 'currency-diversification' }],
      ['Wants to invest more heavily in Swiss small caps going forward.', { type: 'interest', measure: 'none' }],
      ['Interested in structured products, initial consultation already held.', { type: 'interest', measure: 'none' }],
    ]
    for (const [text, wish] of cases) expect(wishOf(text), text).toEqual([wish])
  })

  it('keeps notes about the person or a plan out of the wishes', () => {
    for (const text of ['Prefers to settle smaller amounts in cash where possible.', 'Plans to retire in the next two years, increasing liquidity needs expected.', 'Prefers semi-annual phone contact, no unannounced visits.', 'Was informed of the risks of structured products and explicitly accepts them.']) {
      expect(wishOf(text), text).toEqual([{ type: 'not-a-wish' }])
    }
  })

  it('tolerates close variants in German and French', () => {
    expect(wishOf('Keine Anlagen in fossilen Energien.')).toEqual([{ type: 'exclude-sector', sector: 'Energy', scope: 'any' }])
    expect(wishOf('Pas de pétrole dans le portefeuille.')).toEqual([{ type: 'exclude-sector', sector: 'Energy', scope: 'any' }])
    expect(wishOf('Keine direkten Positionen in Erdöl.')).toEqual([{ type: 'exclude-sector', sector: 'Energy', scope: 'direct' }])
    expect(wishOf('Keine Schwellenländer bitte.')).toEqual([{ type: 'exclude-emerging-markets' }])
  })

  it('leaves an unknown sentence to the model instead of guessing', () => {
    expect(classifyNote('Bitte keine Ölfirmen im Depot')).toBeUndefined()
    expect(classifyNote('')).toBeUndefined()
    // an interest in emerging markets is not an exclusion
    expect(wishOf('Interested in emerging markets.')).not.toEqual([{ type: 'exclude-emerging-markets' }])
  })
})

describe('parseWish', () => {
  it('accepts menu items and rejects anything else', () => {
    expect(parseWish({ type: 'exclude-sector', sector: 'Energy', scope: 'any' })).toEqual({ type: 'exclude-sector', sector: 'Energy', scope: 'any' })
    expect(parseWish({ type: 'keep-cash', amountChf: 5000 })).toEqual({ type: 'keep-cash', amountChf: 5000 })
    expect(parseWish({ type: 'exclude-sector', sector: 'Oil companies', scope: 'any' })).toBeUndefined()
    expect(parseWish({ type: 'exclude-sector', sector: 'Energy', scope: 'any', note: 'x' })).toBeUndefined()
    expect(parseWish({ type: 'sell-everything' })).toBeUndefined()
    expect(parseWish({ type: 'interest', measure: 'sector' })).toBeUndefined()
    expect(parseWish({ type: 'exclude-unverifiable', label: '<script>' })).toBeUndefined()
    expect(parseWish('unknown')).toBeUndefined()
    expect(parseWish(null)).toBeUndefined()
  })
})

describe('wishesOf', () => {
  const withNote = (text: string) => {
    const raw = structuredClone(client('CASE-004'))
    raw.ClientNotes = [{ Note: text, CreatedByDateUTC: '2026-09-01T10:00:00Z' }]
    return readClient(raw, ref)
  }

  it('takes the model answer for a note the rules do not know, and reports it unread otherwise', () => {
    const c = withNote('Bitte keine Ölfirmen im Depot')
    expect(wishesOf(c, {}).unread).toEqual([{ text: 'Bitte keine Ölfirmen im Depot', date: '2026-09-01' }])
    expect(wishesOf(c, { wishes: { 'Bitte keine Ölfirmen im Depot': 'unknown' } }).unread).toHaveLength(1)
    const read = wishesOf(c, { wishes: { 'Bitte keine Ölfirmen im Depot': { type: 'exclude-sector', sector: 'Energy', scope: 'any' } } })
    expect(read.unread).toEqual([])
    expect(read.wishes[0]).toMatchObject({ by: 'ai', de: 'Kein Engagement in fossilen Energien', wish: { type: 'exclude-sector', sector: 'Energy' } })
  })
})
