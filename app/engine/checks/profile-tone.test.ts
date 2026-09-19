import { describe, expect, it } from 'vitest'
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
})
