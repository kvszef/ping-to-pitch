import { describe, expect, it } from 'vitest'
import type { Card } from '../../src/types.ts'
import { rankCards } from './insights.ts'
import type { Complete } from './briefing.ts'

const flags: Card = { type: 'flags', title: 'Befunde', items: [{ severity: 'risk', text: 'Zu viel USD', source: 'Regelverletzung' }] }
const contradiction: Card = {
  type: 'contradiction', title: 'Wunsch gegen Bestand', wish: { quote: 'keine Ölfirmen', date: '', source: 'Kundennotiz' }, verdict: 'Hält Öltitel trotz Ausschlusswunsch',
  exposure: { label: 'Energie', total: 5, direct: 5, viaFunds: 0 }, holdings: [], source: 'Fonds-Durchsicht', fix: { summary: '', trades: [], effects: [], source: '' },
}
const profile: Card = { type: 'profile', title: 'So tickt der Kunde', persona: 'Vorsichtig, meldet sich selten', said: [], done: [], source: 'Notizen' }

describe('rankCards', () => {
  it('keeps every candidate in the given order without a model (fewer than two candidates)', async () => {
    const never: Complete = async () => { throw new Error('should not be called') }
    expect(await rankCards([flags], never, 'openai')).toEqual({ order: ['flags'], hidden: [], rankedBy: 'vorlage' })
  })

  it('accepts the model\'s order and hides what it left out', async () => {
    const complete: Complete = async () => ({ show: ['contradiction', 'flags'] })
    const r = await rankCards([flags, contradiction, profile], complete, 'openai')
    expect(r).toEqual({ order: ['contradiction', 'flags'], hidden: ['profile'], rankedBy: 'openai' })
  })

  it('falls back to showing everything when the model answers with nothing usable', async () => {
    const complete: Complete = async () => ({ show: ['not-a-real-type'] })
    const r = await rankCards([flags, contradiction], complete, 'openai')
    expect(r).toEqual({ order: ['flags', 'contradiction'], hidden: [], rankedBy: 'vorlage' })
  })

  it('falls back when the model call fails', async () => {
    const complete: Complete = async () => { throw new Error('network') }
    const r = await rankCards([flags, contradiction], complete, 'openai')
    expect(r).toEqual({ order: ['flags', 'contradiction'], hidden: [], rankedBy: 'vorlage' })
  })
})
