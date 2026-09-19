import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run } from '../engine/run.ts'
import { clients, ctx } from '../engine/test-data.ts'
import { mergeNewClients, type Raw } from './database.ts'

const DIR = resolve(__dirname, '../../core-case/portfolio-data/new-clients')
const handedOver: Raw[] = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')) as Raw)

describe('mergeNewClients', () => {
  const base: Raw[] = [{ ClientRef: 'A', ClientId: 1, v: 'old' }, { ClientRef: 'B', ClientId: 2 }]

  it('appends a new ref and replaces an update of the same client', () => {
    const out = mergeNewClients(base, [{ ClientRef: 'C', ClientId: 3 }, { ClientRef: 'A', ClientId: 1, v: 'new' }])
    expect(out.map((c) => c.ClientRef)).toEqual(['A', 'B', 'C'])
    expect(out[0].v).toBe('new')
  })

  it('keeps both when the same ref belongs to another person', () => {
    const out = mergeNewClients(base, [{ ClientRef: 'A', ClientId: 9 }, { ClientRef: 'A', ClientId: 10 }])
    expect(out.map((c) => c.ClientRef)).toEqual(['A', 'B', 'A-2', 'A-3'])
    expect(out[0].v).toBe('old')
  })

  it('skips entries without a ref and leaves the input alone', () => {
    expect(mergeNewClients(base, [{}, { ClientRef: '  ' }] as Raw[])).toEqual(base)
    expect(base).toHaveLength(2)
  })
})

describe('the clients handed over in new-clients/', () => {
  const merged = mergeNewClients(clients as Raw[], handedOver)

  it('all arrive next to the 47, none pushes a case client out', () => {
    expect(merged).toHaveLength(clients.length + handedOver.length)
    expect(new Set(merged.map((c) => c.ClientRef)).size).toBe(merged.length)
  })

  it('run through every check without a failure', () => {
    for (const c of merged.slice(clients.length)) {
      const findings = run(c, ctx)
      expect(findings.failed, String(c.ClientRef)).toBeUndefined()
      for (const f of findings) for (const v of Object.values(f.numbers ?? {})) expect(Number.isFinite(v), f.id).toBe(true)
    }
  })
})
