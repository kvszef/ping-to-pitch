import { describe, expect, it } from 'vitest'
import { isEmptyNote, maskName, sinceCallStart } from './callNote'

describe('maskName', () => {
  it('blanks the client name, whole words only, any case', () => {
    expect(maskName('Guten Tag, hier ist Frau MEIER. Meierhof bleibt.', 'Anna Meier')).toBe('Guten Tag, hier ist Frau [Name]. Meierhof bleibt.')
  })
  it('leaves the text alone without a usable name', () => {
    expect(maskName('Guten Tag', '')).toBe('Guten Tag')
    expect(maskName('Die AG zahlt', 'AG')).toBe('Die AG zahlt')
  })
})

describe('sinceCallStart', () => {
  const a = { t: 'a' }, b = { t: 'b' }, c = { t: 'c' }
  it('drops what stood in the transcript before the call', () => {
    expect(sinceCallStart([a], [a, b, c])).toEqual([b, c])
  })
  it('keeps everything when the transcript was cleared or was empty', () => {
    expect(sinceCallStart([a], [b, c])).toEqual([b, c])
    expect(sinceCallStart([], [b])).toEqual([b])
    expect(sinceCallStart([a, b], [])).toEqual([])
  })
})

describe('isEmptyNote', () => {
  it('is true only when no section has an item', () => {
    const base = { id: 'x', clientRef: 'CASE-001', date: '2026-09-19', confirmed: false, proposed: [], promises: [], factUpdates: [] }
    expect(isEmptyNote(base)).toBe(true)
    expect(isEmptyNote({ ...base, promises: [{ text: 'Unterlagen zusenden', done: false }] })).toBe(false)
  })
})
