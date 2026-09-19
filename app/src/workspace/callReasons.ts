import type { EngineFinding } from '../types'

// Why the client is probably calling, the same everywhere it is shown (ringing island, client card,
// what the agent is told). Only the engine's call-reason findings count, in the engine's own order
// (numbers.rank, 1 = most probable; news-based reasons carry no rank and come last). A change of the
// bank's house view is not a reason for a client to call: it is something the advisor can bring up,
// so it is listed apart and never in front of a real reason.

const rankOf = (f: EngineFinding) => f.numbers?.rank ?? 99

export const callReasonsOf = (findings: EngineFinding[] | undefined): EngineFinding[] =>
  (findings ?? []).filter((f) => f.check === 'profile.call-reason').map((f, i) => ({ f, i })).sort((a, b) => rankOf(a.f) - rankOf(b.f) || a.i - b.i).map((x) => x.f)

export const talkingPointsOf = (findings: EngineFinding[] | undefined): EngineFinding[] =>
  (findings ?? []).filter((f) => f.check === 'cio.house-view' && !!f.numbers?.changed)
