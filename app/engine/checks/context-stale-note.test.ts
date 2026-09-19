import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { staleNote } from './context-stale-note.ts'

describe('context.stale-note', () => {
  it('turns the expired property plan into a question (CASE-007)', () => {
    const [f] = staleNote(client('CASE-007'), ctx)
    expect(f.id).toBe('context.stale-note:CASE-007:2024-10-10:immobilienkauf')
    expect(f.kind).toBe('action')
    expect(f.severity).toBe('warn')
    expect(f.title).toBe('Veraltet: Immobilienkauf – Zeitfenster lief am 10.10.2025 ab (Notiz vom 10.10.2024)')
    expect(f.detail).toMatch(/Immobilienkauf.*\?$/)
    expect(f.numbers!.ageMonths).toBe(23)
    expect(f.evidence[0]).toMatchObject({ source: 'Kundennotiz', date: '2024-10-10' })
  })

  it('flags an open-ended plan after a year (CASE-022 inheritance) but not a running plan (CASE-004)', () => {
    expect(staleNote(client('CASE-022'), ctx)[0].title).toMatch(/^Veraltet: Erbe – seit 21 Monaten offen/)
    expect(staleNote(client('CASE-004'), ctx)).toEqual([])
    expect(staleNote({ ClientNotes: [{ Note: 'Plans to retire in the next two years.' }] }, ctx)).toEqual([])
  })
})
