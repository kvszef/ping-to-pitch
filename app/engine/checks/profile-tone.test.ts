import { describe, expect, it } from 'vitest'
import { stripPrefix } from '../lang.ts'
import { client, ctx } from '../test-data.ts'
import { tone } from './profile-tone.ts'

describe('profile.tone', () => {
  it('sets a calm, explaining tone for CASE-037 and says to ask before changes', () => {
    const f = tone(client('CASE-037'), ctx)
    const register = f.find((x) => x.id === 'profile.tone:CASE-037:register')!
    expect(register).toMatchObject({ kind: 'action', title: 'Ton: ruhig und erklärend' })
    expect(register.numbers!.calm).toBeGreaterThan(register.numbers!.brief)
    expect(f.map((x) => x.id.split(':').pop())).toEqual(expect.arrayContaining(['ask-first', 'losses']))
  })

  it('keeps it short with CASE-006 (email, hard to reach, self-directed)', () => {
    const f = tone(client('CASE-006'), ctx)
    expect(f.find((x) => x.id.endsWith(':register'))!.title).toBe('Ton: kurz und sachlich')
    expect(f.find((x) => x.id.endsWith(':hint:short'))!.title).toBe('kurz halten, Details per E-Mail nachreichen')
    expect(f.some((x) => x.id.endsWith(':hint:options'))).toBe(true)
  })

  it('gives no tone advice for CASE-030, where nothing speaks to it', () => {
    expect(tone(client('CASE-030'), ctx)).toEqual([])
  })

  it('yields nothing for an empty client', () => {
    expect(tone({ ClientNotes: null }, ctx)).toEqual([])
  })

  it('answers in English when ctx.lang is en, with the tone prefix from lang.ts', () => {
    const en = tone(client('CASE-037'), { ...ctx, lang: 'en' })
    const register = en.find((x) => x.id === 'profile.tone:CASE-037:register')!
    expect(register).toMatchObject({ kind: 'action', title: 'Tone: calm and explanatory', detail: 'Because: tends to react to losses, wants to be informed before changes.' })
    expect(stripPrefix(register.title, 'tone')).toBe('calm and explanatory')
    expect(en.map((x) => [x.id, x.numbers])).toEqual(tone(client('CASE-037'), ctx).map((x) => [x.id, x.numbers]))
    const short = tone(client('CASE-006'), { ...ctx, lang: 'en' })
    expect(short.find((x) => x.id.endsWith(':register'))!.title).toBe('Tone: brief and factual')
    expect(short.find((x) => x.id.endsWith(':hint:short'))!.title).toBe('keep it short, send the details by email')
  })
})
