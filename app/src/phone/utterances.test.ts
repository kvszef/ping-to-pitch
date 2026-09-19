import { afterEach, describe, expect, it, vi } from 'vitest'
import { inOrder, TRANSCRIBE_TIMEOUT_MS } from './utterances.ts'

const answer = (text: string) => ({ ok: true, status: 200, json: async () => ({ segments: [{ text }] }) })
// A request that never answers, like one lost in the tunnel: it only ends when it is aborted.
const lost = (init?: RequestInit) => new Promise((_, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))) })

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('inOrder', () => {
  it('delivers texts in spoken order even when a later one finishes first', async () => {
    let first: (v: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { first = r }))
      .mockImplementationOnce(async () => answer('second')))
    const got: string[] = []
    const send = inOrder((t) => got.push(t), () => {})
    send(new Blob(['a'])); send(new Blob(['b']))
    await new Promise((r) => setTimeout(r, 10))
    expect(got).toEqual([])
    first(answer('first'))
    await new Promise((r) => setTimeout(r, 10))
    expect(got).toEqual(['first', 'second'])
  })

  it('a request that never answers is dropped after the time limit and the next ones still arrive', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => lost(init))
      .mockImplementationOnce(async () => answer('second')))
    const got: string[] = [], errors: unknown[] = []
    const send = inOrder((t) => got.push(t), (e) => errors.push(e))
    send(new Blob(['a'])); send(new Blob(['b']))
    await vi.advanceTimersByTimeAsync(TRANSCRIBE_TIMEOUT_MS + 100)
    expect(errors).toHaveLength(1)
    expect(got).toEqual(['second'])
  })
})
