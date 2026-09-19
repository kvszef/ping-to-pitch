// Peer statistics: how clients with the same risk profile did, so a check can say whether a move is
// market-wide or specific to this portfolio. Computed once over all clients by the caller (server side),
// passed in as ctx.peers. Checks only ever see aggregates: no other client's ref, name or value leaves here.
// Pure: no clock, no I/O.
import { combinedHistory, readClient, type ReferenceIndex } from './data.ts'
import { performanceStats } from './checks/portfolio-performance.ts'

export type PeerSummary = { n: number; median: number; p25: number; p75: number; min: number; max: number }

export type PeerGroup = {
  riskProfileId?: number // undefined for the fallback group of all clients
  n: number // clients in the group, the asking client left out
  asOf?: string // the month the returns refer to (yyyy-MM-01)
  lastMonth?: PeerSummary
  twelveMonths?: PeerSummary
  acceptedByYear: Record<string, number> // year → clients with at least one accepted proposal proposed that year
}

export type PeerStats = {
  asOf?: string
  /** The client's peers: same risk profile, or all clients when it has none. The client itself is left out. */
  of(clientRef: string, riskProfileId: number | undefined): PeerGroup
}

type Member = { ref: string; profile?: number; asOf?: string; lastMonth?: number; twelveMonths?: number; acceptedYears: Set<string> }

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function summarize(values: number[]): PeerSummary | undefined {
  if (!values.length) return undefined
  const s = [...values].sort((a, b) => a - b)
  return { n: s.length, median: quantile(s, 0.5), p25: quantile(s, 0.25), p75: quantile(s, 0.75), min: s[0], max: s[s.length - 1] }
}

export function peerStats(clients: unknown[], ref: ReferenceIndex): PeerStats {
  const members: Member[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(clients) ? clients : []) {
    const c = readClient(raw, ref)
    if (seen.has(c.ref)) continue // an uploaded file may repeat a case client
    seen.add(c.ref)
    const stats = performanceStats(combinedHistory(c.portfolios))
    const acceptedYears = new Set(c.proposals.filter((p) => p.status === 'Final' && p.proposed).map((p) => p.proposed!.slice(0, 4)))
    members.push({ ref: c.ref, profile: c.riskProfileId, asOf: stats?.asOf, lastMonth: stats?.lastMonth, twelveMonths: stats?.twelveMonths, acceptedYears })
  }
  // Only returns for the same month are comparable: take the newest month most clients report.
  const months = new Map<string, number>()
  for (const m of members) if (m.asOf) months.set(m.asOf, (months.get(m.asOf) ?? 0) + 1)
  const asOf = [...months].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0]

  const group = (rows: Member[], riskProfileId: number | undefined): PeerGroup => {
    const current = rows.filter((m) => m.asOf === asOf)
    const acceptedByYear: Record<string, number> = {}
    for (const m of rows) for (const y of m.acceptedYears) acceptedByYear[y] = (acceptedByYear[y] ?? 0) + 1
    return {
      riskProfileId, n: rows.length, asOf, acceptedByYear,
      lastMonth: summarize(current.flatMap((m) => (m.lastMonth === undefined ? [] : [m.lastMonth]))),
      twelveMonths: summarize(current.flatMap((m) => (m.twelveMonths === undefined ? [] : [m.twelveMonths]))),
    }
  }

  return {
    asOf,
    of(clientRef, riskProfileId) {
      const others = members.filter((m) => m.ref !== clientRef)
      return riskProfileId === undefined ? group(others, undefined) : group(others.filter((m) => m.profile === riskProfileId), riskProfileId)
    },
  }
}
