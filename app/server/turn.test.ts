import { describe, expect, it, vi } from 'vitest'
import { turnServers } from './turn.ts'

const keys = { CF_TURN_KEY_ID: 'id-1', CF_TURN_API_TOKEN: 'token-1' }
const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 201 : 401, json: async () => body })) as unknown as typeof fetch

describe('turnServers', () => {
  it('without keys there is no relay and nobody is asked', async () => {
    const ask = reply({})
    expect(await turnServers({}, ask, 0)).toBeNull()
    expect(ask).not.toHaveBeenCalled()
  })

  it('with keys it returns the relay servers, without the port browsers block', async () => {
    const ask = reply({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }] })
    const out = await turnServers(keys, ask, 0)
    expect(out).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
    ])
    const [url, init] = (ask as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    expect(url).toContain('/turn/keys/id-1/')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
  })

  it('the older answer shape (one object instead of a list) is read too', async () => {
    const out = await turnServers(keys, reply({ iceServers: { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' } }), 0)
    expect(out).toEqual([{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }])
  })

  it('a refused key or a network error means no relay, never a throw', async () => {
    expect(await turnServers(keys, reply({ error: 'no' }, false), 0)).toBeNull()
    expect(await turnServers(keys, vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch, 0)).toBeNull()
  })
})
