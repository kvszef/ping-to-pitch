// Check registry. One file per check, one line here.
import type { Check } from '../types.ts'
import { history } from './context-history.ts'
import { peerBehaviour } from './context-peer-behaviour.ts'
import { peers } from './context-peers.ts'
import { plan } from './context-plan.ts'
import { staleNote } from './context-stale-note.ts'
import { liquidity } from './portfolio-liquidity.ts'
import { allocation } from './portfolio-allocation.ts'
import { concentration } from './portfolio-concentration.ts'
import { maturities } from './portfolio-maturities.ts'
import { performance } from './portfolio-performance.ts'
import { proposals } from './portfolio-proposals.ts'
import { risk } from './portfolio-risk.ts'
import { violations } from './portfolio-violations.ts'
import { callReason } from './profile-call-reason.ts'
import { persona } from './profile-persona.ts'
import { tone } from './profile-tone.ts'
import { traits } from './profile-traits.ts'

export const checks: Record<string, Check> = {
  'portfolio.performance': performance,
  'portfolio.allocation': allocation,
  'portfolio.concentration': concentration,
  'portfolio.risk': risk,
  'portfolio.violations': violations,
  'portfolio.proposals': proposals,
  'portfolio.maturities': maturities,
  'portfolio.liquidity': liquidity,
  'context.stale-note': staleNote,
  'context.plan': plan,
  'context.peers': peers,
  'context.history': history,
  'context.peer-behaviour': peerBehaviour,
  'profile.trait': traits,
  'profile.persona': persona,
  'profile.tone': tone,
  'profile.call-reason': callReason,
}
