import { describe, expect, it } from 'vitest'
import type { CallNote } from '../types.ts'
import { client, ctx } from '../test-data.ts'
import { callPromise } from './memory-call-promise.ts'

const noteFor = (clientRef: string, overrides: Partial<CallNote> = {}): CallNote => ({
  id: 'call-1', clientRef, date: '2026-08-01', confirmed: true, proposed: [], promises: [], factUpdates: [], ...overrides,
})

describe('memory.call-promise', () => {
  it('fires for an open promise from a confirmed call (CASE-004)', () => {
    const memory: CallNote[] = [noteFor('CASE-004', { promises: [{ text: 'Unterlagen nachreichen', due: '2026-08-15', done: false }] })]
    const [f] = callPromise(client('CASE-004'), { ...ctx, memory })
    expect(f.check).toBe('memory.call-promise')
    expect(f.title).toBe('Zugesagt: Unterlagen nachreichen')
    expect(f.severity).toBe('warn') // due date is in the past relative to ctx.now
    expect(f.evidence[0]).toMatchObject({ source: 'Gesprächsnotiz', date: '2026-08-01' })
  })

  it('reports an open point raised on a call and skips a done promise', () => {
    const memory: CallNote[] = [noteFor('CASE-004', {
      promises: [{ text: 'Bereits erledigt', done: true }],
      proposed: [{ text: 'Umschichtung in ESG-Fonds', reaction: 'open', why: 'Kunde wollte noch überlegen' }],
    })]
    const found = callPromise(client('CASE-004'), { ...ctx, memory })
    expect(found).toHaveLength(1)
    expect(found[0].title).toBe('Offen aus dem letzten Gespräch: Umschichtung in ESG-Fonds')
  })

  it('is empty without memory, for another client, or when not confirmed', () => {
    expect(callPromise(client('CASE-004'), ctx)).toEqual([])
    expect(callPromise(client('CASE-004'), { ...ctx, memory: [noteFor('CASE-007')] })).toEqual([])
    expect(callPromise(client('CASE-004'), { ...ctx, memory: [noteFor('CASE-004', { confirmed: false, promises: [{ text: 'x', done: false }] })] })).toEqual([])
    expect(callPromise({}, ctx)).toEqual([])
  })
})
