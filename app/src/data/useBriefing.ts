import { useEffect, useState } from 'react'
import type { Card } from '../types'
import { TIERS, loadBriefing, sortCards, type Finding, type Tier } from './source'

type State = { ref: string | null; cards: Partial<Record<Tier, Card[]>>; findings: Finding[] }

// Requests all three tiers in parallel and hands out each tier's cards as soon as it arrives.
export function useBriefing(ref: string | null) {
  const [state, setState] = useState<State>({ ref: null, cards: {}, findings: [] })

  useEffect(() => {
    if (!ref) return
    let stale = false
    for (const tier of TIERS) {
      loadBriefing(ref, tier)
        .catch(() => ({ cards: [] as Card[], findings: [] as Finding[] }))
        .then((b) => {
          if (stale) return
          setState((s) => {
            const base: State = s.ref === ref ? s : { ref, cards: {}, findings: [] }
            return { ref, cards: { ...base.cards, [tier]: b.cards }, findings: [...base.findings, ...b.findings] }
          })
        })
    }
    return () => { stale = true }
  }, [ref])

  // A result for another client is ignored, so switching clients shows skeletons straight away.
  const current = state.ref === ref ? state.cards : {}
  const pending = TIERS.filter((t) => !current[t])
  return { cards: sortCards(TIERS.flatMap((t) => current[t] ?? [])), findings: state.ref === ref ? state.findings : [], pending }
}
