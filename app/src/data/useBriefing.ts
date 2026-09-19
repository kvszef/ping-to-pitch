import { useEffect, useMemo, useState } from 'react'
import type { Card } from '../types'
import { TIERS, loadBriefing, sortCards, type Finding, type Tier } from './source'

const NONE: Partial<Record<Tier, Card[]>> = {}
const NO_FINDINGS: Finding[] = []

type State = { ref: string | null; cards: Partial<Record<Tier, Card[]>>; findings: Finding[]; order?: Card['type'][]; hidden?: Card['type'][] }

// Requests all three tiers in parallel and hands out each tier's cards as soon as it arrives.
// `version` reloads the same client, e.g. after an ex-custody statement was attached; the old cards stay until the new ones arrive.
export function useBriefing(ref: string | null, version = 0) {
  const [state, setState] = useState<State>({ ref: null, cards: {}, findings: [] })

  useEffect(() => {
    if (!ref) return
    let stale = false
    for (const tier of TIERS) {
      loadBriefing(ref, tier)
        .catch(() => ({ cards: [] as Card[], findings: [] as Finding[], order: undefined, hidden: undefined }))
        .then((b) => {
          if (stale) return
          setState((s) => {
            const base: State = s.ref === ref ? s : { ref, cards: {}, findings: [] }
            // A later tier's ranking (from the model) wins over an earlier one that had none yet.
            return { ref, cards: { ...base.cards, [tier]: b.cards }, findings: [...base.findings, ...b.findings], order: b.order ?? base.order, hidden: b.hidden ?? base.hidden }
          })
        })
    }
    return () => { stale = true }
  }, [ref, version])

  // A result for another client is ignored, so switching clients shows skeletons straight away.
  // Stable references while nothing new arrived, so consumers can memoise on them.
  const current = state.ref === ref ? state.cards : NONE
  const order = state.ref === ref ? state.order : undefined
  const hidden = state.ref === ref ? state.hidden : undefined
  const cards = useMemo(() => sortCards(TIERS.flatMap((t) => current[t] ?? []), order, hidden), [current, order, hidden])
  const pending = useMemo(() => TIERS.filter((t) => !current[t]), [current])
  return { cards, findings: state.ref === ref ? state.findings : NO_FINDINGS, pending }
}
