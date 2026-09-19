// Shared helpers for the wish checks (E2): note evidence, unique ids, client-wide holdings and the ESG floor.
import { exposure, type Client, type Dimension, type ReferenceIndex, type Security } from '../data.ts'
import { fundName } from '../fix.ts'
import type { Evidence } from '../types.ts'
import type { ClientWish } from '../wishes.ts'

// The bank's "Yes" ESG profile: MinimumPositionLevel 5.714 (reference.json → EsgProfiles). Used when a note asks
// for ESG but the profile says otherwise, or the reference data lacks the profile.
export const ESG_FLOOR = 5.714

/** ESG scores carry up to five decimals in the data; one is enough to read. */
export const score = (v: number | undefined) => (v === undefined ? '–' : String(Math.round(v * 10) / 10))

export const noteEvidence = (w: Pick<ClientWish, 'note'>): Evidence => ({ source: 'Kundennotiz', quote: w.note.text, date: w.note.date })
export const aiHint = (w: Pick<ClientWish, 'by'>) => (w.by === 'ai' ? ' Wunsch von der KI aus der Notiz gelesen, bitte bestätigen.' : '')
export const subjectOf = (w: Pick<ClientWish, 'note'>) => w.note.date ?? 'ohne-datum'

/** Several wishes can share a note date: the second id gets a suffix, so ids stay unique and stable. */
export function uniqueIds() {
  const seen = new Map<string, number>()
  return (id: string) => { const n = (seen.get(id) ?? 0) + 1; seen.set(id, n); return n === 1 ? id : `${id}:${n}` }
}

export const hasEsgProfile = (client: Client, ref: ReferenceIndex) => (ref.esgProfile(client.esgProfileId)?.name ?? client.esgProfileName) === 'Yes'
export const esgFloor = (client: Client, ref: ReferenceIndex) => (hasEsgProfile(client, ref) ? ref.esgProfile(client.esgProfileId)?.minPositionLevel ?? ESG_FLOOR : ESG_FLOOR)

export type Held = { key: string; securityId?: number; isin?: string; name: string; share: number; currency?: string; security?: Security }

/** Security positions over all portfolios, one row per security, share of the client's wealth. */
export function heldSecurities(client: Client): { rows: Held[]; cashShare: number; cash: number; total: number } {
  const total = client.portfolios.reduce((a, p) => a + p.value, 0)
  const rows = new Map<string, Held>()
  let cashShare = 0, cash = 0
  for (const p of client.portfolios) {
    const w = total > 0 ? p.value / total : client.portfolios.length === 1 ? 1 : 0
    for (const x of p.positions) {
      if (x.kind === 'account') { cashShare += x.weight * w; cash += x.weight * p.value; continue }
      const key = x.securityId !== undefined ? String(x.securityId) : x.name
      const row = rows.get(key) ?? { key, securityId: x.securityId, isin: x.isin, name: fundName(x.name), share: 0, currency: x.currency ?? x.security?.currency, security: x.security }
      row.share += x.weight * w
      rows.set(key, row)
    }
  }
  return { rows: [...rows.values()], cashShare, cash, total }
}

/** Client-wide exposure in one dimension: category → share of the base (equity part for regions and sectors) and of wealth. */
export function clientExposure(client: Client, dimension: Dimension, ref: ReferenceIndex) {
  const total = client.portfolios.reduce((a, p) => a + p.value, 0)
  const ofWealth = new Map<string, number>()
  let base = 0
  for (const p of client.portfolios) {
    const w = total > 0 ? p.value / total : client.portfolios.length === 1 ? 1 : 0
    const e = exposure(p, dimension, ref)
    base += e.baseWeight * w
    for (const [cat, share] of e.shares) ofWealth.set(cat, (ofWealth.get(cat) ?? 0) + share * e.baseWeight * w)
  }
  const ofBase = new Map([...ofWealth].map(([k, v]) => [k, base > 0 ? v / base : 0]))
  return { base, ofBase, ofWealth }
}
