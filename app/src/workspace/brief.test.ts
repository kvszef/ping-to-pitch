import { describe, expect, it } from 'vitest'
import type { Client } from '../types'
import { briefFor } from './brief.ts'

const finding = (check: string, n: number, severity: 'risk' | 'info') => ({ id: `${check}:X:${n}`, check, kind: 'fact', severity, title: `${check} ${n}`, evidence: [{ source: 'Test' }] })
const client = (findings: unknown[]) => ({ ref: `X-${findings.length}`, briefing: [], findings }) as unknown as Client
const breaches = [1, 2, 3, 4, 5].map((n) => finding('portfolio.concentration', n, 'risk'))

describe('briefFor: imported statement from another bank', () => {
  it('always shows it, first under the positions, even when four more serious findings fill the group', () => {
    const items = briefFor(client([...breaches, finding('portfolio.ex-custody', 1, 'info')]), 'en').filter((i) => i.group === 'Positionen')
    expect(items[0].id).toBe('portfolio.ex-custody:X:1')
    expect(items).toHaveLength(5) // the statement plus the usual four
  })

  it('without a statement the group keeps its four most serious findings', () => {
    const items = briefFor(client(breaches), 'en').filter((i) => i.group === 'Positionen')
    expect(items.map((i) => i.id)).toEqual(breaches.slice(0, 4).map((f) => f.id))
  })
})
