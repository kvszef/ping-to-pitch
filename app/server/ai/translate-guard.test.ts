import { describe, expect, it } from 'vitest'
import { guardTranslation, numberTokens, sameNumbers } from './translate-guard.ts'

describe('numberTokens', () => {
  it('reads Swiss amounts, percentages and dates as whole tokens', () => {
    expect(numberTokens("Verkauf über CHF 80'000 am 14.10.2026, Anteil 23.9%, Band 30–50%.")).toEqual(['14.10.2026', '23.9%', '30', '50%', "80'000"])
  })

  it('ignores the space before % and the kind of apostrophe', () => {
    expect(numberTokens('23.9 % von 80’000')).toEqual(numberTokens("23.9% of 80'000"))
  })

  it('finds nothing in a text without digits', () => {
    expect(numberTokens('Schönes Wetter heute.')).toEqual([])
  })
})

describe('sameNumbers', () => {
  it('accepts a translation that moved the figures but kept them', () => {
    expect(sameNumbers("Am 14.10.2026 wurden CHF 80'000 verkauft, 23.9% des Depots.", "CHF 80'000 were sold on 14.10.2026, 23.9% of the portfolio.")).toBe(true)
  })

  it('rejects a changed, reformatted, dropped or added figure', () => {
    expect(sameNumbers('USD-Anteil 61%', 'USD share 16%')).toBe(false)
    expect(sameNumbers("CHF 80'000", 'CHF 80,000')).toBe(false)
    expect(sameNumbers('fällig am 14.10.2026', 'due on 14 October 2026')).toBe(false)
    expect(sameNumbers('Anteil 23.9%, Band bis 20%', 'Share 23.9%')).toBe(false)
    expect(sameNumbers('Drei Positionen', '3 positions')).toBe(false)
  })

  it('counts repeats: the same figure twice is not the same as once', () => {
    expect(sameNumbers('10% und 10%', '10%')).toBe(false)
  })
})

describe('guardTranslation', () => {
  const input = ['USD-Anteil 61%, 11 Punkte über dem Band.', 'Kunde wünscht nachhaltige Fonds.', '']

  it('keeps good entries and puts the original back where a number moved', () => {
    expect(guardTranslation(input, ['USD share 61%, 12 points above the band.', 'Client wants sustainable funds.', '']))
      .toEqual([input[0], 'Client wants sustainable funds.', ''])
  })

  it('returns the originals when the model answers with the wrong shape', () => {
    expect(guardTranslation(input, ['only one'])).toEqual(input)
    expect(guardTranslation(input, undefined)).toEqual(input)
    expect(guardTranslation(input, [42, null, ''])).toEqual(input)
  })
})
