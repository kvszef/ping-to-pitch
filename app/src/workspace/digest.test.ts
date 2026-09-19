import { describe, expect, it } from 'vitest'
import { clients } from '../data/mock'
import { screenFor } from './brain'
import { digestFor, digestText } from './digest'

const clientA = clients.find((c) => c.ref === 'CASE-A')!

describe('digestFor', () => {
  it('turns every tile into sourced bullets and keeps at most two graphs', () => {
    const screen = screenFor(clientA)
    const d = digestFor(clientA, screen.tiles, screen.charts)
    expect(d.sections.length).toBeGreaterThan(0)
    expect(d.sections.flatMap((s) => s.bullets).every((b) => b.text && b.source)).toBe(true)
    expect(d.charts.length).toBeLessThanOrEqual(2)
    expect(d.facts.some(([label]) => label === 'Profil')).toBe(true)
  })

  it('shows a figure once when the shorter wording repeats it', () => {
    const screen = screenFor(clientA)
    const tile = screen.tiles.find((t) => t.item?.figure)!
    const d = digestFor(clientA, [tile], [], { [tile.id]: `${tile.item!.figure} kurz gesagt` })
    expect(d.sections[0].bullets[0]).toMatchObject({ figure: tile.item!.figure, text: 'kurz gesagt' })
  })

  it('lets a one-bar chart yield to a more telling one', () => {
    const bars = (id: string, values: number[]) => ({ id, title: id, note: '', spec: { type: 'balken' as const, title: id, unit: '%', note: '', bars: values.map((value, i) => ({ label: `b${i}`, value })) } })
    const d = digestFor(clientA, [], [bars('waehrungen', [99.1, 0.9]), bars('anlageklassen', [55, 30, 15]), bars('regionen', [60, 40])])
    expect(d.charts.map((c) => c.id)).toEqual(['anlageklassen', 'regionen'])
    expect(digestFor(clientA, [], [bars('waehrungen', [99.1, 0.9])]).charts.map((c) => c.id)).toEqual(['waehrungen'])
  })

  it('survives a client with nothing to say', () => {
    const d = digestFor({ ...clientA, aum: '–', briefing: [] }, [], [])
    expect(d.sections).toEqual([])
    expect(d.charts).toEqual([])
    expect(digestText(d)).toContain(clientA.name)
  })
})

describe('digestText', () => {
  it('is plain bullet text that names each source', () => {
    const screen = screenFor(clientA)
    const text = digestText(digestFor(clientA, screen.tiles, screen.charts))
    const first = screen.tiles.find((t) => t.item)!.item!
    expect(text).toContain('• ')
    expect(text).toContain(`(${first.source})`)
  })
})
