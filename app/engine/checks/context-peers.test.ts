import { describe, expect, it } from 'vitest'
import { peerStats } from '../peers.ts'
import { client, clients, ctx, ref } from '../test-data.ts'
import type { RawClient } from '../types.ts'
import { peerBehaviour } from './context-peer-behaviour.ts'
import { peers } from './context-peers.ts'

const withPeers = { ...ctx, peers: peerStats(clients, ref) }

describe('context.peers', () => {
  it('calls a drop in line with similar clients market-wide (CASE-038, July 2026)', () => {
    const [f] = peers(client('CASE-038'), withPeers)
    expect(f.severity).toBe('info')
    expect(f.kind).toBe('interpretation')
    expect(f.numbers!.lastMonth).toBeLessThan(0)
    expect(f.numbers!.peerN).toBe(14) // 15 clients with profile 6, the client itself left out
    expect(f.title).toMatch(/^Letzter Monat −4\.2%, ähnliche Kunden \(Profil 6, n=14\): Median −\d\.\d%: marktweit, nicht portfoliospezifisch$/)
  })

  it('warns when the client fell clearly more than its peers', () => {
    const worse = structuredClone(client('CASE-038')) as { ClientRef: string; Portfolios: { PerformanceHistory: { Value: number }[] }[] }
    worse.ClientRef = 'TEST-WORSE'
    for (const p of worse.Portfolios) p.PerformanceHistory[p.PerformanceHistory.length - 1].Value *= 0.9
    const [f] = peers(worse as unknown as RawClient, withPeers)
    expect(f.severity).toBe('warn')
    expect(f.title).toMatch(/schwächer als vergleichbare Kunden$/)
  })

  it('never names or references another client', () => {
    for (const c of clients) {
      const own = String(c.ClientRef)
      for (const f of [...peers(c, withPeers), ...peerBehaviour(c, withPeers)]) {
        const text = JSON.stringify(f).replace(new RegExp(`${own}(-\\d+)?`, 'g'), '')
        expect(text, f.id).not.toMatch(/CASE-\d+/)
      }
    }
  })

  it('says nothing with fewer than 3 peers or without peer data', () => {
    expect(peers(client('CASE-021'), withPeers)).toEqual([]) // the only client with profile 3
    expect(peers(client('CASE-038'), ctx)).toEqual([])
    const few = { ...ctx, peers: peerStats([client('CASE-038'), ...clients.filter((c) => c.RiskProfileId === 18 && c.ClientRef !== 'CASE-038').slice(0, 2)], ref) }
    expect(peers(client('CASE-038'), few)).toEqual([])
  })

  it('phrases the same finding in English (ctx.lang)', () => {
    const [f] = peers(client('CASE-038'), { ...withPeers, lang: 'en' })
    expect(f.title).toMatch(/^Last month −4\.2%, similar clients \(profile 6, n=14\): median −\d\.\d%: market-wide, not specific to this portfolio$/)
    expect(f.evidence.map((e) => e.source)).toEqual(['Performance (monthly values)', 'Peer group (aggregated)'])
    expect(f.numbers).toEqual(peers(client('CASE-038'), withPeers)[0].numbers)
  })
})

describe('context.peer-behaviour', () => {
  it('counts peers who accepted a proposal this year, without naming them', () => {
    const [f] = peerBehaviour(client('CASE-038'), withPeers)
    expect(f.title).toMatch(/^Von 14 Kunden mit Profil 6 haben \d+ im Jahr 2026 einen Vorschlag angenommen$/)
    expect(f.numbers!.accepted).toBeLessThanOrEqual(14)
    expect(peerBehaviour(client('CASE-021'), withPeers)).toEqual([])
  })

  it('phrases the same finding in English (ctx.lang)', () => {
    const [f] = peerBehaviour(client('CASE-038'), { ...withPeers, lang: 'en' })
    expect(f.title).toMatch(/^Of 14 clients with profile 6, \d+ accepted a proposal in 2026$/)
    expect(f.evidence.map((e) => e.source)).toEqual(['Investment proposal', 'Peer group (aggregated)'])
  })
})
