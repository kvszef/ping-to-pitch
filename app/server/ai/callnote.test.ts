import { describe, expect, it } from 'vitest'
import { draftCallNote, type Complete, type Segment } from './callnote.ts'
import type { Briefing60 } from './briefing.ts'

const briefing: Briefing60 = {
  ref: 'CASE-004', reasons: [], persona: null,
  blocks: {
    open: [{ id: 'open', text: 'Schön, von Ihnen zu hören.', kind: 'action', findings: [] }],
    mention: [{ id: 'mention-1', text: 'Unterlagen zur Umschichtung nachreichen', kind: 'action', findings: ['f1'] }],
    ask: [{ id: 'ask-1', text: 'Ist die Adresse noch aktuell?', kind: 'action', findings: [] }],
    avoid: [],
  },
  questions: [], actions: [], words: 0, seconds: 0, budget: 60, phrasedBy: 'vorlage', rejected: [],
}

const transcript: Segment[] = [
  { speaker: 'Berater', text: 'Ich schicke Ihnen die Unterlagen zur Umschichtung diese Woche zu.' },
  { speaker: 'Kunde', text: 'Perfekt, das passt.' },
  { speaker: 'Berater', text: 'Ist Ihre Adresse noch aktuell?' },
  { speaker: 'Kunde', text: 'Ja, die ist noch aktuell.' },
]

describe('draftCallNote', () => {
  it('returns an empty draft for an empty transcript, without calling the model', async () => {
    const never: Complete = async () => { throw new Error('should not be called') }
    const note = await draftCallNote('CASE-004', [], briefing, never)
    expect(note).toMatchObject({ clientRef: 'CASE-004', confirmed: false, proposed: [], promises: [], factUpdates: [] })
  })

  it('accepts a promise and a resolved briefing point grounded in the transcript', async () => {
    const complete: Complete = async () => ({
      proposed: [{ findingId: 'mention-1', text: 'Umschichtung besprochen', reaction: 'accepted', why: 'Kunde: das passt' }],
      promises: [{ text: 'Unterlagen zur Umschichtung zusenden' }],
      factUpdates: [{ note: 'Adresse', status: 'confirmed' }],
    })
    const note = await draftCallNote('CASE-004', transcript, briefing, complete)
    expect(note.proposed).toEqual([{ findingId: 'mention-1', text: 'Umschichtung besprochen', reaction: 'accepted', why: 'Kunde: das passt' }])
    expect(note.promises).toEqual([{ text: 'Unterlagen zur Umschichtung zusenden', done: false }])
    expect(note.factUpdates).toEqual([{ note: 'Adresse', status: 'confirmed' }])
  })

  it('drops a promise that names a number not in the transcript, and an unknown findingId', async () => {
    const complete: Complete = async () => ({
      proposed: [{ findingId: 'not-a-real-id', text: 'Erfunden', reaction: 'open' }],
      promises: [{ text: 'CHF 50000 überweisen' }], // no such number was said
      factUpdates: [],
    })
    const note = await draftCallNote('CASE-004', transcript, briefing, complete)
    expect(note.proposed).toEqual([{ text: 'Erfunden', reaction: 'open' }]) // findingId dropped, rest kept
    expect(note.promises).toEqual([])
  })

  it('asks the model for an English note on request, German otherwise', async () => {
    const seen: string[] = []
    const complete: Complete = async (m) => { seen.push(m[0].content); return { proposed: [], promises: [{ text: 'Client request: send the documents' }], factUpdates: [] } }
    const note = await draftCallNote('CASE-004', transcript, briefing, complete, 'en')
    await draftCallNote('CASE-004', transcript, briefing, complete)
    expect(seen[0]).toMatch(/Write in English/)
    expect(seen[1]).toMatch(/Deutsch, Schweizer Schreibweise/)
    expect(note.promises).toEqual([{ text: 'Client request: send the documents', done: false }])
  })

  it('falls back to an empty draft when the model call fails', async () => {
    const complete: Complete = async () => { throw new Error('network') }
    const note = await draftCallNote('CASE-004', transcript, briefing, complete)
    expect(note.proposed).toEqual([])
    expect(note.promises).toEqual([])
  })
})
