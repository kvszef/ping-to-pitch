import { describe, expect, it } from 'vitest'
import { clients } from '../data/mock'
import { answer, detectTopics, openingHints, think } from './brain'
import { defaults } from './settings'

// Example mode is the demo's safety net: with no provider reachable the workspace must still
// answer from the data it has, and say so when it has nothing. These tests pin that behaviour.
const offline = { openai: false, apertus: false, elevenlabs: false }
const clientA = clients.find((c) => c.ref === 'CASE-A')!

describe('detectTopics', () => {
  it('finds the topic a sentence is about', () => {
    expect(detectTopics('CASE-A', 'Und der Dollar fällt ja auch noch.').map((t) => t.id)).toContain('dollar')
  })

  it('returns nothing for small talk', () => {
    expect(detectTopics('CASE-A', 'Schönes Wetter heute.')).toEqual([])
  })

  it('does not throw for a client it has never seen', () => {
    expect(detectTopics('CASE-999', 'Wie steht es um den Dollar?')).toEqual([])
  })
})

describe('openingHints', () => {
  it('opens with the market signal that affects the client', () => {
    expect(openingHints(clientA)[0].topicId).toBe('einstieg')
  })
})

describe('example mode (no provider configured)', () => {
  it('answers a covered question from the client data and names its sources', async () => {
    const reply = await answer(clientA, 'Wie hoch ist der USD-Anteil?', defaults, offline, [])
    expect(reply.entry.role).toBe('ki')
    expect(reply.entry.role === 'ki' && reply.entry.sources.length).toBeGreaterThan(0)
    expect(reply.hints.length).toBeGreaterThan(0)
  })

  it('says so instead of guessing when the data does not cover the question', async () => {
    const reply = await answer(clientA, 'Wie wird das Wetter morgen?', defaults, offline, [])
    expect(reply.entry.text).toMatch(/keine Daten/)
    expect(reply.hints).toEqual([])
  })

  it('turns what the customer says into a hint for the advisor', async () => {
    const thought = await think(clientA, [], [{ speaker: 'Kunde', text: 'Ich hatte einmal nach nachhaltigen Anlagen gefragt.' }], defaults, offline)
    expect(thought.customer?.topic).toBe('nachhaltig')
    expect(thought.lines).toHaveLength(1)
  })
})
