// Shared helpers for checks. readClient is cached per raw object, so seven checks read a client once.
import { readClient, type Client, type ReferenceIndex } from '../data.ts'
import { sourceName, type Lang } from '../lang.ts'
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

// Evidence source names, so the UI and the briefing writer can group and link them. SRC answers in German;
// a check that phrases in ctx.lang uses srcOf(ctx.lang). Readers match with isSource() from lang.ts.
export const srcOf = (lang?: Lang) => ({
  portfolio: (nr: string): Evidence => ({ source: sourceName('portfolio', lang), ref: nr }),
  history: (nr: string, date?: string): Evidence => ({ source: sourceName('history', lang), ref: nr, date }),
  position: (name: string, nr: string): Evidence => ({ source: sourceName('position', lang), ref: nr, quote: name }),
  saa: (name: string | undefined): Evidence => ({ source: sourceName('saa', lang), quote: name }),
  riskProfile: (name: string | undefined): Evidence => ({ source: sourceName('riskProfile', lang), quote: name }),
  violation: (rule: string, date?: string): Evidence => ({ source: sourceName('violation', lang), quote: rule, date }),
  proposal: (id: number | undefined, date?: string): Evidence => ({ source: sourceName('proposal', lang), ref: id === undefined ? undefined : String(id), date }),
  security: (name: string): Evidence => ({ source: sourceName('security', lang), quote: name }),
})
export const SRC = srcOf('de')

export type { Finding }
