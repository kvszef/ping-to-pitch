import { useCallback, useEffect, useState } from 'react'

// The brief's tiles come in strictly top to bottom. A tile that is not ready yet (its text is still
// being translated) stays blurred in place and holds back the ones below it, so nothing pops in out
// of order and no text changes under the advisor's eyes. A tile that never reports ready (offline,
// translation failed) is let through after GIVE_UP_MS, so the brief never stays blurred.
const STEP_MS = 130
const GIVE_UP_MS = 4000

type State = { scope: string; shown: number; ready: Record<string, true> }
const fresh = (scope: string): State => ({ scope, shown: 0, ready: {} })

/** `scope` starts the reveal over (the client); `ids` are the tiles in display order. Tiles with index < shown are revealed. */
export function useReveal(scope: string, ids: string[]) {
  const [state, setState] = useState<State>(() => fresh(scope))
  const current = state.scope === scope ? state : fresh(scope)
  const next = ids[current.shown]
  const nextReady = next !== undefined && !!current.ready[next]

  useEffect(() => {
    if (next === undefined) return
    const timer = setTimeout(() => setState((s) => { const b = s.scope === scope ? s : fresh(scope); return { ...b, shown: b.shown + 1 } }), nextReady ? STEP_MS : GIVE_UP_MS)
    return () => clearTimeout(timer)
  }, [scope, next, nextReady])

  const markReady = useCallback((id: string) => setState((s) => {
    const b = s.scope === scope ? s : fresh(scope)
    return b.ready[id] ? b : { ...b, ready: { ...b.ready, [id]: true } }
  }), [scope])

  return { shown: current.shown, markReady }
}
