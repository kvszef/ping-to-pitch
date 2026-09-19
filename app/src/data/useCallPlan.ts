import { useEffect, useState } from 'react'
import type { CallPlan, CallReason } from '../../server/ai/callplan-types'

// The plan for an outbound call (server/ai/callplan.ts): why we call, the goal, the arguments.
// The deterministic plan arrives first; with a model configured its wording follows and replaces
// goal, arguments and opener (numbers checked on the server). Without a server: the reasons from
// the ranking alone, so the card still says why this client is on today's list.

const post = async (payload: unknown): Promise<CallPlan> => {
  const r = await fetch('/api/call-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  if (!r.ok) throw new Error(String(r.status))
  return await r.json() as CallPlan
}

const offline = (ref: string, reasons: CallReason[]): CallPlan => ({
  ref, goals: [], arguments: [], tone: [], avoid: [], questions: [], phrasedBy: 'vorlage', rejected: [],
  reasons: reasons.slice(0, 3).map((r, i) => ({ id: `reason-${i + 1}`, text: r.title, kind: 'fact', source: r.newsId ? 'Nachrichten' : 'Analyse', severity: r.severity, findings: [], url: r.url })),
  open: { id: 'open', text: '', kind: 'action', source: '', findings: [] },
})

export function useCallPlan(ref: string | null, reasons: CallReason[], provider: 'openai' | 'apertus' | null, language: 'de' | 'en') {
  const [state, setState] = useState<{ ref: string | null; language?: string; plan: CallPlan | null; writing: boolean }>({ ref: null, plan: null, writing: false })
  // The ranking is polled and re-created; only a change of its content asks again.
  const key = `${ref}|${provider}|${language}|${reasons.map((r) => r.findingId ?? r.newsId ?? r.title).join('|')}`

  useEffect(() => {
    if (!ref) return
    let stale = false
    // Another language is another text: the old plan goes, so German never lingers under an English switch.
    setState((s) => (s.ref === ref && s.language === language ? { ...s, writing: !!provider } : { ref, language, plan: null, writing: !!provider }))
    post({ ref, reasons, language })
      .then((plan) => { if (!stale) setState((s) => (s.plan?.phrasedBy !== 'vorlage' && s.ref === ref && s.plan ? s : { ...s, ref, plan })) })
      .catch(() => { if (!stale) setState((s) => ({ ...s, ref, plan: s.plan ?? offline(ref, reasons) })) })
    if (provider) {
      post({ ref, reasons, language, phrase: provider })
        .then((plan) => { if (!stale) setState({ ref, language, plan, writing: false }) })
        .catch(() => { if (!stale) setState((s) => ({ ...s, writing: false })) })
    }
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state.ref === ref ? state : { ref, plan: null, writing: false }
}
