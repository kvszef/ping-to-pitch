// Shared helpers for checks. readClient is cached per raw object, so seven checks read a client once.
import { readClient, type Client, type ReferenceIndex } from '../data.ts'
import type { Evidence, Finding, RawClient } from '../types.ts'

const cache = new WeakMap<RawClient, { ref: ReferenceIndex; client: Client }>()
export function clientOf(raw: RawClient, ref: ReferenceIndex): Client {
  const hit = cache.get(raw)
  if (hit && hit.ref === ref) return hit.client
  const client = readClient(raw, ref)
  cache.set(raw, { ref, client })
  return client
}

export const findingId = (check: string, clientRef: string, subject: string) => `${check}:${clientRef}:${subject}`

// Evidence source names, so the UI and the briefing writer can group and link them.
export const SRC = {
  portfolio: (nr: string): Evidence => ({ source: 'Portfolio', ref: nr }),
  history: (nr: string, date?: string): Evidence => ({ source: 'Wertentwicklung (Monatswerte)', ref: nr, date }),
  position: (name: string, nr: string): Evidence => ({ source: 'Position', ref: nr, quote: name }),
  saa: (name: string | undefined): Evidence => ({ source: 'Strategische Asset Allocation', quote: name }),
  riskProfile: (name: string | undefined): Evidence => ({ source: 'Risikoprofil', quote: name }),
  violation: (rule: string, date?: string): Evidence => ({ source: 'Suitability-Verletzung', quote: rule, date }),
  proposal: (id: number | undefined, date?: string): Evidence => ({ source: 'Anlagevorschlag', ref: id === undefined ? undefined : String(id), date }),
  security: (name: string): Evidence => ({ source: 'Wertschriften-Stammdaten', quote: name }),
}

export type { Finding }
