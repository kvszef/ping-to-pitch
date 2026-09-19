import { describe, expect, it } from 'vitest'
import { clients } from '../data/mock'
import { answer, detectTopics, openingHints, think, topicsFor } from './brain'
import { topics } from '../data/workspace'
import { unsupportedNumbers } from './grounding'
import { defaults } from './settings'
import type { Client } from '../types'

// Example mode is the demo's safety net: with no provider reachable the workspace must still
// answer from the data it has, and say so when it has nothing. These tests pin that behaviour.
const offline = { openai: false, apertus: false, elevenlabs: false }
const clientA = clients.find((c) => c.ref === 'CASE-A')!
// The example mode answers in the advisor's language; the app's default is English.
const german = { ...defaults, language: 'de' as const }
const englishSettings = { ...defaults, language: 'en' as const }

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
    const reply = await answer(clientA, 'Wie wird das Wetter morgen?', german, offline, [])
    expect(reply.entry.text).toMatch(/keine Daten/)
    expect(reply.hints).toEqual([])
  })

  it('turns what the customer says into a hint for the advisor', async () => {
    const thought = await think(clientA, [], [{ speaker: 'Kunde', text: 'Ich hatte einmal nach nachhaltigen Anlagen gefragt.' }], defaults, offline)
    expect(thought.customer?.topic).toBe('nachhaltig')
    expect(thought.lines).toHaveLength(1)
  })
})

describe('example mode in English', () => {
  it('understands an English question and answers in English, with the German figures', async () => {
    const reply = await answer(clientA, 'Should we hedge the currency?', englishSettings, offline, [])
    const de = topics['CASE-A'].find((t) => t.id === 'dollar')!
    expect(reply.next?.topic).toBe('dollar')
    expect(reply.entry.text).toMatch(/^USD 61%, band/)
    expect(reply.hints[0]).toMatchObject({ topicId: 'dollar', label: 'USD overweight', trigger: "Advisor's question: «Should we hedge the currency?»" })
    expect(unsupportedNumbers(reply.entry.text, de.insight.kurz)).toEqual([])
  })

  it('answers a German question in English when the screen is English, and the other way round', async () => {
    const en = await answer(clientA, 'Wie hoch ist der USD-Anteil?', englishSettings, offline, [])
    expect(en.entry.text).toMatch(/^USD 61%, band/)
    const de = await answer(clientA, 'Should we hedge the currency?', german, offline, [])
    expect(de.entry.text).toBe(topics['CASE-A'].find((t) => t.id === 'dollar')!.insight.kurz)
  })

  it('says in English that it has no data', async () => {
    const reply = await answer(clientA, 'What will the weather be like tomorrow?', englishSettings, offline, [])
    expect(reply.entry.text).toMatch(/no data/)
    expect(reply.hints).toEqual([])
  })

  it('follows an English transcript line', async () => {
    const thought = await think(clientA, [], [{ speaker: 'Kunde', text: 'I once asked about sustainable investments.' }], englishSettings, offline)
    expect(thought.customer).toMatchObject({ topic: 'nachhaltig', heard: 'I once asked about sustainable investments.' })
    expect(thought.customer?.text).toMatch(/^You had asked about sustainable investments/)
    expect(thought.hints[0].trigger).toBe('Client: «I once asked about sustainable investments.»')
  })

  it('does not let short English keywords fire inside German words', () => {
    expect(detectTopics('CASE-C', 'Die Notenbank hat fundiert entschieden.')).toEqual([])
    expect(detectTopics('CASE-C', 'Should I sell the fund?').map((t) => t.id)).toContain('fonds')
  })

  it('opens in English', () => {
    const [opener] = openingHints(clientA, 'en')
    expect(opener).toMatchObject({ topicId: 'einstieg', label: 'Conversation opener' })
    expect(opener.text).toMatch(/^Your portfolio/)
    expect(openingHints(clientA, 'de')[0].label).toBe('Gesprächseinstieg')
  })

  it('keeps every figure of the sample topics: English and German carry the same numbers', () => {
    for (const client of clients) {
      const de = topicsFor(client, 'de'), en = topicsFor(client, 'en')
      expect(en.map((t) => t.id)).toEqual(de.map((t) => t.id))
      en.forEach((t, i) => {
        const g = de[i]
        expect(t.say, `${client.ref}:${t.id} has no English wording`).not.toBe(g.say)
        const pairs: [string, string][] = [[t.say, g.say], [t.why, g.why], [t.next, g.next], [t.insight.kurz, g.insight.kurz], [t.insight.standard, g.insight.standard], [t.insight.detailliert, g.insight.detailliert]]
        for (const [english, germanText] of pairs) {
          expect(unsupportedNumbers(english, germanText), `${client.ref}:${t.id} «${english.slice(0, 40)}»`).toEqual([])
          expect(unsupportedNumbers(germanText, english), `${client.ref}:${t.id} «${germanText.slice(0, 40)}»`).toEqual([])
        }
      })
    }
  })

  it('rewords the derived topics of a real client file from the same computed figures', () => {
    const real: Client = {
      ...clientA, ref: 'CASE-900', errors: 1, warnings: 2, findings: undefined,
      briefing: [
        { type: 'flags', title: 'Regeln', items: [{ severity: 'risk', text: 'Aktienquote 71.4% über dem Band bis 60%' }] },
        { type: 'context', title: 'Kontext', facts: [], notes: [{ text: 'Möchte 2027 ein Haus kaufen', date: '03.07.2026' }], changes: [] },
      ] as Client['briefing'],
      facts: {
        asOf: '31.08.2026',
        performance: { month: -3.4, ytd: 5.2, sinceStart: 18.7, startLabel: 'Jan. 2023', worst: { label: 'Okt. 2023', value: -5.1 }, series: [{ label: 'Juli 2026', value: 100 }], note: 'Wertveränderung aus Monatsendwerten, nicht um Ein- und Auszahlungen bereinigt.' },
        risk: { volatility: 11.2, expectedReturn: 4.3, valueAtRisk: 14.6 },
        positions: [{ name: 'Nestlé', share: 23.9, currency: 'CHF', riskShare: 19.5 }, { name: 'Roche', share: 12.1, currency: 'CHF' }, { name: 'Apple', share: 8.4, currency: 'USD' }],
        allPositions: [], positionCount: 17,
        currencies: [{ label: 'CHF', share: 62.5 }, { label: 'USD', share: 31.0 }],
        proposals: { total: 5, accepted: 1, rejected: 3, draft: 1, last: { date: '14.10.2025', status: 'Abgelehnt', reason: 'Zu riskant' } },
        tags: [], incidents: [], history: [],
      },
    }
    const de = topicsFor(real, 'de'), en = topicsFor(real, 'en')
    expect(de.map((t) => t.id).sort()).toEqual(['konzentration', 'notizen', 'regeln', 'vorschlaege', 'waehrungen', 'wertentwicklung'])
    en.forEach((t, i) => {
      const g = de[i]
      expect(t.id).toBe(g.id)
      expect(t.keywords).toEqual(g.keywords)
      expect(t.say, `${t.id} has no English wording`).not.toBe(g.say)
      for (const [english, germanText] of [[t.say, g.say], [t.why, g.why], [t.next, g.next], [t.insight.detailliert, g.insight.detailliert]]) {
        expect(unsupportedNumbers(english, germanText), `${t.id} «${english.slice(0, 40)}»`).toEqual([])
        expect(unsupportedNumbers(germanText, english), `${t.id} «${germanText.slice(0, 40)}»`).toEqual([])
      }
    })
    const perf = en.find((t) => t.id === 'wertentwicklung')!
    expect(perf.why).toBe('As of 31.08.2026. Weakest month since Jan 2023: Oct 2023 at -5.1%.')
    expect(perf.module?.spec.type === 'verlauf' && perf.module.spec.points[0].label).toBe('July 2026')
    expect(en.find((t) => t.id === 'notizen')!.say).toBe('Last time we noted: «Möchte 2027 ein Haus kaufen». Does that still hold?')
  })

  it('leaves a topic it has no English for unchanged instead of throwing', () => {
    const bare: Client = { ...clientA, ref: 'CASE-901', briefing: [], facts: undefined }
    expect(topicsFor(bare, 'en')).toEqual([])
  })
})
