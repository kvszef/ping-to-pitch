import { describe, expect, it } from 'vitest'
import { hasPrefix, isSource } from '../lang.ts'
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

  it('phrases the same finding in English, keeping the title contract (ctx.lang)', () => {
    const [f] = staleNote(client('CASE-007'), { ...ctx, lang: 'en' })
    expect(f.id).toBe('context.stale-note:CASE-007:2024-10-10:immobilienkauf')
    expect(f.title).toBe('Outdated: Property purchase – time window ended on 10.10.2025 (note of 10.10.2024)')
    expect(hasPrefix(f.title, 'outdated')).toBe(true)
    expect(f.detail).toMatch(/property purchase.*\?$/)
    expect(isSource(f.evidence[0].source, 'note')).toBe(true)
    expect(staleNote(client('CASE-022'), { ...ctx, lang: 'en' })[0].title).toMatch(/^Outdated: Inheritance – open for 21 months, no deadline/)
  })
})

describe('context.stale-note on a note worded differently from the case data', () => {
  it('reads the plan and its deadline from the note itself', () => {
    const c = { ...client('CASE-001'), ClientNotes: [{ Note: 'Plans to buy a holiday home within the next 6 months.', CreatedByDateUTC: '2024-11-05T09:00:00' }] }
    const f = staleNote(c, { ...ctx, lang: 'en' })
    expect(f).toHaveLength(1)
    expect(f[0].title).toBe('Outdated: Property purchase – time window ended on 05.05.2025 (note of 05.11.2024)')
  })
  it('stays silent on a note that is not a plan', () => {
    const c = { ...client('CASE-001'), ClientNotes: [{ Note: 'Lives in a house by the lake and enjoys sailing.', CreatedByDateUTC: '2024-11-05T09:00:00' }] }
    expect(staleNote(c, ctx)).toEqual([])
  })
})
