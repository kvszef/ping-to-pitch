import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { unreviewed } from './wish-unreviewed.ts'

const withNote = (text: string) => {
  const raw = structuredClone(client('CASE-004'))
  raw.ClientNotes = [...(raw.ClientNotes as unknown[]), { Note: text, CreatedByDateUTC: '2026-09-01T10:00:00Z' }]
  return raw
}

describe('wish.unreviewed', () => {
  it('never drops a note nobody could read: shown with its text and date', () => {
    const [f] = unreviewed(withNote('Bitte keine Ölfirmen im Depot'), ctx)
    expect(f).toMatchObject({ id: 'wish.unreviewed:CASE-004:2026-09-01', severity: 'info', title: 'Notiz nicht automatisch geprüft, bitte lesen' })
    expect(f.evidence[0]).toEqual({ source: 'Kundennotiz', quote: 'Bitte keine Ölfirmen im Depot', date: '2026-09-01' })
    expect(unreviewed(withNote('Bitte keine Ölfirmen im Depot'), { ...ctx, wishes: { 'Bitte keine Ölfirmen im Depot': 'unknown' } })).toHaveLength(1)
  })

  it('is silent when the rules or the model read every note', () => {
    expect(unreviewed(client('CASE-004'), ctx)).toEqual([])
    expect(unreviewed(withNote('Bitte keine Ölfirmen im Depot'), { ...ctx, wishes: { 'Bitte keine Ölfirmen im Depot': { type: 'exclude-sector', sector: 'Energy', scope: 'any' } } })).toEqual([])
  })
})
