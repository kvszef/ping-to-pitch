// context.peer-behaviour — how many clients with the same risk profile accepted a proposal this year.
// Aggregate from ctx.peers; no other client is named. Gives the advisor a feel for whether a change is unusual.
import type { Check, Finding } from '../types.ts'
import { clientOf, findingId } from './common.ts'

const CHECK = 'context.peer-behaviour'
const MIN_PEERS = 3

export const peerBehaviour: Check = (raw, ctx) => {
  if (!ctx.peers) return []
  const client = clientOf(raw, ctx.ref)
  const group = ctx.peers.of(client.ref, client.riskProfileId)
  if (group.n < MIN_PEERS) return []
  const year = String(ctx.now.getUTCFullYear())
  const accepted = group.acceptedByYear[year] ?? 0
  const level = ctx.ref.riskProfile(client.riskProfileId)?.level
  const who = group.riskProfileId === undefined ? `${group.n} Kunden` : `${group.n} Kunden mit Profil ${level ?? client.riskProfileName ?? group.riskProfileId}`
  const f: Finding = {
    id: findingId(CHECK, client.ref, year), check: CHECK, kind: 'fact', severity: 'info', topic: 'proposals',
    title: `Von ${who} haben ${accepted} im Jahr ${year} einen Vorschlag angenommen`,
    detail: 'Gezählt: Kunden mit mindestens einem angenommenen Vorschlag (Status Final), vorgeschlagen in diesem Jahr. Nur die Anzahl, kein Kunde wird genannt.',
    numbers: { peers: group.n, accepted, share: accepted / group.n },
    evidence: [{ source: 'Anlagevorschlag', quote: `Status Final, vorgeschlagen ${year}` }, { source: 'Vergleichsgruppe (aggregiert)', quote: who }],
  }
  return [f]
}
