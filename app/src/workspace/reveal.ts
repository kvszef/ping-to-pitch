import { useCallback, useEffect, useState } from 'react'

// How the brief's tiles appear, so the panel never jumps around while things load.
//   one after another (an incoming call, little time): tiles come in strictly top to bottom as soon
//     as they are there. One that is not ready yet (its text is still being translated) stays a
//     skeleton and holds back the ones below it, so the advisor never loses the thread.
//   together (preparing an outgoing call, time to wait): nothing shows until everything has loaded
//     (`hold` is over and every tile is ready); then the whole brief appears at once and stays put.
// Nothing waits forever: a single tile is let through after GIVE_UP_MS, and the one wait of
// "together" ends after MAX_WAIT_MS whatever is still missing.
const STEP_MS = 130
const GIVE_UP_MS = 2500
const MAX_WAIT_MS = 9000

type State = { scope: string; shown: number; ready: Record<string, true>; opened: boolean; expired: boolean }
const fresh = (scope: string): State => ({ scope, shown: 0, ready: {}, opened: false, expired: false })

/** `scope` starts over (the client); `ids` are the tiles in display order. Tiles with index < shown are
 *  revealed; `opened` turns true once the brief has been shown in full for the first time. */
export function useReveal(scope: string, ids: string[], opts: { together?: boolean; hold?: boolean } = {}) {
  const [state, setState] = useState<State>(() => fresh(scope))
  const current = state.scope === scope ? state : fresh(scope)
  const update = useCallback((change: (s: State) => State) => setState((s) => change(s.scope === scope ? s : fresh(scope))), [scope])

  useEffect(() => {
    const timer = setTimeout(() => update((s) => ({ ...s, expired: true })), MAX_WAIT_MS)
    return () => clearTimeout(timer)
  }, [update])

  const count = ids.length
  const waitingForAll = !!opts.together && !current.opened
  const allReady = count > 0 && ids.every((id) => current.ready[id])
  // together: open as soon as nothing is held and every tile is ready, or when the one wait is over
  const openNow = waitingForAll && (current.expired || (!opts.hold && allReady))
  useEffect(() => {
    if (openNow) update((s) => ({ ...s, shown: Math.max(s.shown, count), opened: true }))
  }, [openNow, count, update])

  // one after another (also for tiles that arrive after "together" has opened). The timer hangs on the
  // next tile alone, so tiles arriving further down do not restart its patience.
  const next = waitingForAll ? undefined : ids[current.shown]
  const nextReady = next !== undefined && !!current.ready[next]
  useEffect(() => {
    if (next === undefined) return
    const timer = setTimeout(() => update((s) => ({ ...s, shown: s.shown + 1 })), nextReady ? STEP_MS : GIVE_UP_MS)
    return () => clearTimeout(timer)
  }, [next, nextReady, update])
  const allShown = !waitingForAll && count > 0 && current.shown >= count
  useEffect(() => { if (allShown) update((s) => (s.opened ? s : { ...s, opened: true })) }, [allShown, update])

  const markReady = useCallback((id: string) => update((s) => (s.ready[id] ? s : { ...s, ready: { ...s.ready, [id]: true } })), [update])

  return { shown: current.shown, opened: current.opened, markReady }
}
