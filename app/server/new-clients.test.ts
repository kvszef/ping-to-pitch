import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run } from '../engine/run.ts'
import { clients, ctx } from '../engine/test-data.ts'
import { mergeNewClients, type Raw } from './database.ts'

// Every client in a folder of extra client files, in file name order. A file holds one client or an array.
const load = (dir: string): Raw[] => (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith('.json')).sort()
  .flatMap((f) => { const parsed = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as Raw | Raw[]; return Array.isArray(parsed) ? parsed : [parsed] })

// Our own demo clients, in the repo. The files handed over at the live demo stay local, so their tests skip without them.
const demo = load(resolve(__dirname, '../../demo-clients'))
const handedOver = load(resolve(__dirname, '../../core-case/portfolio-data/new-clients'))

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

describe('the demo clients in demo-clients/', () => {
  const merged = mergeNewClients(clients as Raw[], demo)
  const findings = (ref: string) => run(demo.find((c) => c.ClientRef === ref)!, { ...ctx, lang: 'en' })

  it('all arrive next to the 47, none pushes a case client out', () => {
    expect(demo.map((c) => c.ClientRef)).toEqual(['DEMO-01', 'DEMO-02', 'DEMO-03'])
    expect(merged).toHaveLength(clients.length + demo.length)
    expect(new Set(merged.map((c) => c.ClientRef)).size).toBe(merged.length)
  })

  it('run through every check without a failure', () => {
    for (const c of demo) {
      const all = run(c, ctx)
      expect(all.failed, String(c.ClientRef)).toBeUndefined()
      for (const f of all) for (const v of Object.values(f.numbers ?? {})) expect(Number.isFinite(v), f.id).toBe(true)
    }
  })

  it('DEMO-01: the fossil-fuel wish is contradicted through funds, with the smallest fix', () => {
    const f = findings('DEMO-01').find((x) => x.check === 'contradiction.fossil-fuel')!
    expect(f.severity).toBe('risk')
    expect(f.numbers?.direct).toBe(0)
    expect(f.fix?.Reason).toBe('Sell SPDR MSCI World Energy UCITS ETF')
  })

  it('DEMO-02: the property plan whose window has passed becomes a stale note', () => {
    expect(findings('DEMO-02').find((x) => x.check === 'context.stale-note')?.severity).toBe('warn')
  })

  it('DEMO-03: the single position is a cluster risk and the rejected ideas are known', () => {
    const all = findings('DEMO-03')
    expect(all.some((x) => x.check === 'portfolio.concentration' && x.severity === 'risk')).toBe(true)
    expect(all.find((x) => x.check === 'portfolio.proposals')?.numbers?.rejected).toBe(5)
  })
})

describe.skipIf(!handedOver.length)('the clients handed over at the live demo (local only, in new-clients/)', () => {
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
