import { describe, expect, it } from 'vitest'
import { grounded, unsupportedNumbers } from './grounding'

const evidence = JSON.stringify({ share: 8.1, amount: "CHF 67'000", date: '17.12.2025', month: -4.2, n: 38 })

describe('unsupportedNumbers', () => {
  it('accepts figures that are in the data, in Swiss or plain notation', () => {
    expect(unsupportedNumbers("8.1% des Vermögens, Verkauf über CHF 67'000 am 17.12.2025, Monat -4.2%, 38.0% fremd", evidence)).toEqual([])
  })

  it('flags an amount the data does not contain', () => {
    expect(unsupportedNumbers("Positionen im Wert von CHF 40'000 reduzieren", evidence)).toEqual(["40'000"])
  })

  it('ignores single digits and treats missing text as not grounded', () => {
    expect(unsupportedNumbers('Die 3 grössten Positionen', evidence)).toEqual([])
    expect(grounded(null, evidence)).toBe(false)
  })

  it('checks English text the same way: same figures pass, a new one is flagged', () => {
    expect(unsupportedNumbers("8.1% of assets, sale of CHF 67'000 on 17.12.2025, month -4.2%, 38 per cent held elsewhere", evidence)).toEqual([])
    expect(unsupportedNumbers("Reduce positions worth CHF 40'000", evidence)).toEqual(["40'000"])
  })

  it('reads English thousands commas as the amount, never as a decimal comma', () => {
    expect(unsupportedNumbers('Sale of CHF 67,000', evidence)).toEqual([])
    // 38 is in the data, 38'000 is not: read as «38,0» it would slip through.
    expect(unsupportedNumbers('Sale of CHF 38,000', evidence)).toEqual(['38,000'])
    expect(unsupportedNumbers('A decimal comma still works: 8,1% und -4,2%', evidence)).toEqual([])
  })
})
