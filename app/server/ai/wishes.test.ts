import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { appBriefing, uploadClients, type Llm } from './briefing-route.ts'
import { readClient } from '../../engine/data.ts'
import { ref } from '../../engine/test-data.ts'
import { wishesOf } from '../../engine/wishes.ts'
import { classifyNotes, clearWishCache, type Complete } from './wishes.ts'

const OIL = 'Bitte keine Ölfirmen im Depot'
const clients: Record<string, unknown>[] = JSON.parse(readFileSync(resolve(__dirname, '../../../core-case/portfolio-data/clients.json'), 'utf8'))

// A fake model: never the real API in tests.
function fake(answer: (notes: { i: number; text: string }[]) => unknown) {
  const prompts: string[] = []
  const complete: Complete = async (messages) => {
    prompts.push(messages.map((m) => m.content).join('\n'))
    const notes = JSON.parse(messages[1].content.replace(/^NOTES:\n/, '')) as { i: number; text: string }[]
    return answer(notes)
  }
  return { complete, prompts }
}
const oilAnswer = (notes: { i: number; text: string }[]) => ({ items: notes.map((n) => ({ i: n.i, wish: n.text === OIL ? { type: 'exclude-sector', sector: 'Energy', scope: 'any' } : 'unknown' })) })

beforeEach(() => clearWishCache())

describe('classifyNotes', () => {
  it('classifies an unknown German note via the model and caches it', async () => {
    const m = fake(oilAnswer)
    expect(await classifyNotes([OIL], m.complete)).toEqual({ [OIL]: { type: 'exclude-sector', sector: 'Energy', scope: 'any' } })
    await classifyNotes([OIL], m.complete)
    expect(m.prompts).toHaveLength(1)
  })

  it('rejects an answer outside the menu', async () => {
    const m = fake((notes) => ({ items: notes.map((n) => ({ i: n.i, wish: { type: 'exclude-sector', sector: 'Oil companies', scope: 'any' } })) }))
    expect(await classifyNotes([OIL], m.complete)).toEqual({ [OIL]: 'unknown' })
    // a bare type name without fields is read as that item (gpt-4o-mini answered like this once)
    expect(await classifyNotes(['Ruft meist am Montag an.'], fake(() => ({ items: [{ i: 0, wish: 'not-a-wish' }] })).complete)).toEqual({ 'Ruft meist am Montag an.': { type: 'not-a-wish' } })
    expect(await classifyNotes(['Nur Gold.'], fake(() => ({ items: [{ i: 0, wish: 'exclude-sector' }] })).complete)).toEqual({ 'Nur Gold.': 'unknown' })
    const garbage = fake(() => 'kein JSON')
    expect(await classifyNotes(['Etwas ganz anderes'], garbage.complete)).toEqual({ 'Etwas ganz anderes': 'unknown' })
  })

  it('sends the note texts only', async () => {
    const m = fake(oilAnswer)
    await classifyNotes([OIL], m.complete)
    expect(m.prompts[0]).toContain(OIL)
    expect(m.prompts[0]).not.toMatch(/CASE-\d+|\bCH\d{2}/)
  })
})

describe('briefing route with the classifier', () => {
  const raw = { ...structuredClone(clients.find((c) => c.ClientRef === 'CASE-004')!), ClientRef: 'DEMO-OIL', ClientNotes: [{ Note: OIL, CreatedByDateUTC: '2026-09-01T10:00:00Z' }] }
  uploadClients(Buffer.from(JSON.stringify([raw])))
  const llm = (complete: Complete | null): Llm => ({ ready: (p) => p === 'openai' && !!complete, complete: async (_p, m) => complete!(m) })
  const findings = async (l: Llm) => ((await appBriefing('/api/briefing/DEMO-OIL?tier=instant&lang=de', l)).data as { findings: { check: string; severity: string; fix?: { Reason: string } }[] }).findings

  it('passes the model answer to the engine: the note becomes a contradiction with a fix', async () => {
    const m = fake(oilAnswer)
    const f = (await findings(llm(m.complete))).find((x) => x.check === 'contradiction.fossil-fuel')!
    expect(f.severity).toBe('warn')
    expect(f.fix!.Reason).toBe('SPDR MSCI World Energy UCITS ETF verkaufen')
    expect(m.prompts[0]).not.toContain('Kontoinhaber')
  })

  it('without a model the note is shown as not checked', async () => {
    const all = await findings(llm(null))
    expect(all.some((x) => x.check === 'wish.unreviewed')).toBe(true)
    expect(all.some((x) => x.check === 'contradiction.fossil-fuel')).toBe(false)
  })

  it('a model error passes nothing and the briefing still answers', async () => {
    const all = await findings(llm(async () => { throw new Error('429') }))
    expect(all.some((x) => x.check === 'wish.unreviewed')).toBe(true)
  })
})

describe('labels of a classified note', () => {
  const raw = { ...structuredClone(clients.find((c) => c.ClientRef === 'CASE-004')!), ClientNotes: [{ Note: OIL, CreatedByDateUTC: '2026-09-01T10:00:00Z' }] }

  it('come from the menu item in German and English, never from the model', async () => {
    const answers = await classifyNotes([OIL], fake(oilAnswer).complete)
    expect(wishesOf(readClient(raw, ref), { wishes: answers }).wishes[0]).toMatchObject({ by: 'ai', de: 'Kein Engagement in fossilen Energien', en: 'No exposure to fossil fuels' })
    // a model that adds its own wording is off the menu: the note stays unread
    clearWishCache()
    const chatty = await classifyNotes([OIL], fake((notes) => ({ items: notes.map((n) => ({ i: n.i, wish: { type: 'exclude-sector', sector: 'Energy', scope: 'any', en: 'No oil companies' } })) })).complete)
    expect(chatty).toEqual({ [OIL]: 'unknown' })
  })
})
