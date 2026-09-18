import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { indexReference, run } from '../../engine/run.ts'
import { composeBriefing } from './briefing.ts'
import { mergeFindings, uploadClients } from './briefing-route.ts'
import { factCards, talkTrackCard } from './cards.ts'
import { provisionalFindings } from './provisional-findings.ts'

const data = (file: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../core-case/portfolio-data', file), 'utf8'))
const clients: Record<string, unknown>[] = data('clients.json')
const reference = data('reference.json')
const index = indexReference(reference)
const NOW = new Date('2026-09-19T00:00:00Z')

function cardsFor(ref: string) {
  const raw = clients.find((c) => c.ClientRef === ref)!
  const { findings } = mergeFindings(run(raw, { ref: index, now: NOW, memory: [] }), provisionalFindings(raw, reference, NOW))
  const b = composeBriefing(ref, findings)
  return { talk: talkTrackCard(b, findings), cards: factCards(raw, reference, findings, b, NOW) }
}

describe('main app cards', () => {
  it('builds a talk track and fact cards for all 47 clients', () => {
    for (const c of clients) {
      const { talk, cards } = cardsFor(String(c.ClientRef))
      expect(talk.open.text).toBeTruthy()
      expect(cards.some((x) => x.type === 'metrics')).toBe(true)
      expect(JSON.stringify(cards)).not.toMatch(/undefined|NaN/)
    }
  })

  it('shows the fund look-through and the smallest fix for CASE-004', () => {
    const card = cardsFor('CASE-004').cards.find((c) => c.type === 'contradiction')
    expect(card?.type).toBe('contradiction')
    if (card?.type !== 'contradiction') return
    expect(card.exposure.total).toBeCloseTo(3.35, 1)
    expect(card.exposure.direct).toBe(0)
    expect(card.fix.trades.map((t) => t.name)).toEqual(['SPDR MSCI World Energy UCITS ETF'])
    expect(card.fix.effects[0]).toMatchObject({ before: '3.3%', after: '1.0%', ok: true })
  })

  it('shows no contradiction card where the wish is met (CASE-037)', () => {
    expect(cardsFor('CASE-037').cards.some((c) => c.type === 'contradiction')).toBe(false)
  })

  it('accepts an uploaded file and rejects one without clients', () => {
    const ok = uploadClients(Buffer.from(JSON.stringify([{ ClientRef: 'DEMO-1' }, { nope: 1 }])))
    expect(ok.data).toMatchObject({ ok: true, count: 1, refs: ['DEMO-1'] })
    expect(uploadClients(Buffer.from('{}')).status).toBe(400)
  })
})
