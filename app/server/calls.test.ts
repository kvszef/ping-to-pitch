import { beforeEach, describe, expect, it } from 'vitest'
import { callsRoute } from './calls.ts'
import { templateFor, type Llm } from './ai/briefing-route.ts'
import { clearMemoryStore } from './memory/store.ts'

const REF = 'CASE-004'
const noModel: Llm = { ready: () => false, complete: async () => { throw new Error('not configured') } }
const fakeModel = (answer: unknown): Llm => ({ ready: (p) => p === 'openai', complete: async () => answer })
const body = (v: unknown) => Buffer.from(JSON.stringify(v))

beforeEach(() => clearMemoryStore())

describe('callsRoute', () => {
  it('passes through paths it does not own', async () => {
    expect(await callsRoute('/api/other', 'POST', body({}), noModel)).toBeNull()
    expect(await callsRoute(`/api/calls/${REF}/summary`, 'GET', body({}), noModel)).toBeNull()
  })

  it('drafts an empty note without a model configured', async () => {
    const r = await callsRoute(`/api/calls/${REF}/summary`, 'POST', body({ transcript: [{ speaker: 'Kunde', text: 'Hallo' }] }), noModel)
    expect(r?.status).toBe(200)
    expect((r?.data as { note: { proposed: unknown[] } }).note.proposed).toEqual([])
  })

  it('drafts a grounded note with a model, and confirming it feeds the next briefing (memory.call-promise)', async () => {
    const llm = fakeModel({ proposed: [], promises: [{ text: 'Unterlagen zusenden' }], factUpdates: [] })
    const draft = await callsRoute(`/api/calls/${REF}/summary`, 'POST', body({ transcript: [{ speaker: 'Berater', text: 'Ich sende Ihnen die Unterlagen zu.' }] }), llm)
    const note = (draft?.data as { note: { id: string; clientRef: string; promises: { text: string }[] } }).note
    expect(note.clientRef).toBe(REF)
    expect(note.promises).toEqual([{ text: 'Unterlagen zusenden', done: false }])

    const confirm = await callsRoute(`/api/calls/${REF}/confirm`, 'POST', body({ note: { ...note, confirmed: false } }), llm)
    expect(confirm).toEqual({ status: 200, data: { ok: true } })

    const found = await templateFor(REF, noModel)
    expect(found?.findings.some((f) => f.check === 'memory.call-promise' && f.title === 'Zugesagt: Unterlagen zusenden')).toBe(true)
  })

  it('rejects a confirm for the wrong client', async () => {
    const note = { id: 'x', clientRef: 'CASE-007', confirmed: false, proposed: [], promises: [], factUpdates: [] }
    const r = await callsRoute(`/api/calls/${REF}/confirm`, 'POST', body({ note }), noModel)
    expect(r?.status).toBe(400)
  })
})
