import { describe, expect, it } from 'vitest'
import { checkPlan, localPlan, type Tile } from './screen'

// The agent's plan is model output: whatever it sends, the screen only takes what the data carries.
const tile = (id: string, words: string): Tile => ({ id, group: 'Positionen', topics: [], words, seconds: 3, item: { id, group: 'Positionen', text: words, source: 'Test' } })
const tiles = [tile('aktien', 'Aktienquote 62.4% im Band'), tile('usd', '31.5% in USD')]
const fallback = localPlan(tiles, [])
const anything = () => true

describe('checkPlan', () => {
  it('keeps a shorter wording that carries the tile\'s own figure', () => {
    expect(checkPlan({ tiles: [{ id: 'usd', text: 'USD-Anteil 31.5%' }] }, tiles, [], anything, fallback).texts).toEqual({ usd: 'USD-Anteil 31.5%' })
  })

  it('drops a wording that carries another tile\'s figure', () => {
    expect(checkPlan({ tiles: [{ id: 'aktien', text: 'USD-Anteil 31.5% zu hoch' }] }, tiles, [], anything, fallback).texts).toEqual({})
  })

  it('takes malformed model output without throwing', () => {
    const p = checkPlan({ tiles: [null, 5, { id: 7 }, { id: 'usd', text: 9 }], suggestions: [null, { text: 5 }], answer: { text: 5 }, widgets: [null, 3] }, tiles, [], anything, fallback)
    expect([...p.order].sort()).toEqual([...fallback.order].sort())
    expect(p.texts).toEqual({})
    expect(p.answer).toBeNull()
    expect(checkPlan(undefined, tiles, [], anything, fallback).by).toBe('agent')
  })
})
