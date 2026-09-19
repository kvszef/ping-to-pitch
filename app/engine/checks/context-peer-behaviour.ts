// context.peer-behaviour — how many clients with the same risk profile accepted a proposal this year.
// Aggregate from ctx.peers; no other client is named. Gives the advisor a feel for whether a change is unusual.
import { pick, sourceName } from '../lang.ts'
import type { Check, Finding } from '../types.ts'
import { clientOf, findingId } from './common.ts'

const CHECK = 'context.peer-behaviour'
const MIN_PEERS = 3

export const peerBehaviour: Check = (raw, ctx) => {
  if (!ctx.peers) return []
  const client = clientOf(raw, ctx.ref)
  const lang = ctx.lang, t = pick(lang)
  const group = ctx.peers.of(client.ref, client.riskProfileId)
  if (group.n < MIN_PEERS) return []
  const year = String(ctx.now.getUTCFullYear())
  const accepted = group.acceptedByYear[year] ?? 0
  const level = ctx.ref.riskProfile(client.riskProfileId)?.level
  const profile = level ?? client.riskProfileName ?? group.riskProfileId
  const who = group.riskProfileId === undefined ? t(`${group.n} Kunden`, `${group.n} clients`) : t(`${group.n} Kunden mit Profil ${profile}`, `${group.n} clients with profile ${profile}`)
  const f: Finding = {
    id: findingId(CHECK, client.ref, year), check: CHECK, kind: 'fact', severity: 'info', topic: 'proposals',
    title: t(`Von ${who} haben ${accepted} im Jahr ${year} einen Vorschlag angenommen`, `Of ${who}, ${accepted} accepted a proposal in ${year}`),
    detail: t(
      'Gezählt: Kunden mit mindestens einem angenommenen Vorschlag (Status Final), vorgeschlagen in diesem Jahr. Nur die Anzahl, kein Kunde wird genannt.',
      'Counted: clients with at least one accepted proposal (status Final), proposed this year. Only the count, no client is named.',
    ),
    numbers: { peers: group.n, accepted, share: accepted / group.n },
    evidence: [
      { source: sourceName('proposal', lang), quote: t(`Status Final, vorgeschlagen ${year}`, `Status Final, proposed ${year}`) },
      { source: sourceName('peers', lang), quote: who },
    ],
  }
  return [f]
}
