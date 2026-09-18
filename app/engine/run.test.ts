import { describe, expect, it } from 'vitest'
import { exposure, readClient } from './data.ts'
import { run } from './run.ts'
import { client, clients, ctx, ref } from './test-data.ts'

describe('engine on the whole dataset', () => {
  it('runs every check on all 47 clients without a failure', () => {
    expect(clients.length).toBe(47)
    for (const c of clients) {
      const findings = run(c, ctx)
      expect(findings.failed, String(c.ClientRef)).toBeUndefined()
      for (const f of findings) {
        expect(f.id.startsWith(`${f.check}:${c.ClientRef}:`), f.id).toBe(true)
        expect(f.evidence.length, f.id).toBeGreaterThan(0)
        for (const v of Object.values(f.numbers ?? {})) expect(Number.isFinite(v), f.id).toBe(true)
      }
      expect(new Set(findings.map((f) => f.id)).size, String(c.ClientRef)).toBe(findings.length)
    }
  })

  it('survives garbage and a client full of unknown securities', () => {
    expect(run(null, ctx)).toEqual([])
    expect(run({ ClientRef: 'X', Portfolios: null, SuitabilityViolations: null }, ctx).failed).toBeUndefined()
    const unknown = structuredClone(client('CASE-037'))
    for (const p of unknown.Portfolios as { SecurityPositions: { SecurityId: number }[] }[]) for (const s of p.SecurityPositions) s.SecurityId += 9_000_000
    expect(run(unknown, ctx).failed).toBeUndefined()
  })
})

describe('exposure with fund look-through', () => {
  // The bank's own violations on CASE-037-02 report these LeftValues (share of the equity part).
  it('matches the bank rule engine for CASE-037-02 regions', () => {
    const p = readClient(client('CASE-037'), ref).portfolios.find((x) => x.nr === 'CASE-037-02')!
    const e = exposure(p, 'CountryGroup', ref)
    expect(e.shares.get('North America')).toBeCloseTo(0.2388, 3)
    expect(e.shares.get('Rest of Europe')).toBeCloseTo(0.1183, 3)
    expect(e.shares.get('Asia/Pacific (ex Japan)')).toBeCloseTo(0.0068, 3)
  })

  it('sums to 1 per dimension', () => {
    const p = readClient(client('CASE-037'), ref).portfolios[1]
    for (const d of ['AssetClass', 'CurrencyGroup', 'CountryGroup', 'Industry'] as const) {
      const sum = [...exposure(p, d, ref).shares.values()].reduce((a, b) => a + b, 0)
      expect(sum, d).toBeCloseTo(1, 2)
    }
  })
})
