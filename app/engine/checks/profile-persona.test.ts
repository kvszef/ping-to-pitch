import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { persona } from './profile-persona.ts'

describe('profile.persona', () => {
  it('describes CASE-037 in one sentence: life stage, pension, two traits', () => {
    const [f] = persona(client('CASE-037'), ctx)
    expect(f).toMatchObject({ id: 'profile.persona:CASE-037:line', kind: 'interpretation', numbers: { age: 62 } })
    expect(f.title).toBe('In den Jahren vor der Pensionierung (62 Jahre), mit Vorsorgeportfolio; wirkt eher empfindlich bei Verlusten und auf Mitsprache bedacht.')
  })

  it('calls CASE-012 a company client and names no age', () => {
    const [f] = persona(client('CASE-012'), ctx)
    expect(f.title).toMatch(/^Firmenkunde; wirkt eher selbstbestimmt/)
    expect(f.numbers).toBeUndefined()
  })

  it('stays silent when only the age is known (CASE-009 without notes and tags)', () => {
    const bare = { ...structuredClone(client('CASE-009')), ClientNotes: [], Tags: null }
    expect(persona(bare, ctx)).toEqual([])
  })

  it('yields nothing for an empty client', () => {
    expect(persona({}, ctx)).toEqual([])
  })

  it('builds its own English sentence when ctx.lang is en', () => {
    const [f] = persona(client('CASE-037'), { ...ctx, lang: 'en' })
    expect(f).toMatchObject({ id: 'profile.persona:CASE-037:line', kind: 'interpretation', numbers: { age: 62 } })
    expect(f.title).toBe('A client in the years before retirement (aged 62) with a pension portfolio who tends to be sensitive to losses and keen to have a say.')
    expect(f.detail).toBe('Derived from notes, proposals, holdings and master data: a tendency, not a verdict.')
    expect(f.evidence[0]).toEqual({ source: 'Client file', quote: 'Birthday' })
    expect(persona(client('CASE-012'), { ...ctx, lang: 'en' })[0].title).toMatch(/^A corporate client that tends to be self-directed/)
  })
})
