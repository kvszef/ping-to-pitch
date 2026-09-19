// Shapes of POST /api/call-plan. No Node imports here: the UI imports this file type-only.

type Kind = 'fact' | 'interpretation' | 'action'
type Severity = 'risk' | 'warn' | 'ok' | 'info'

/** One of today's ranked reasons to call, as /api/outbound hands them out. */
export type CallReason = { kind: 'risk' | 'opportunity'; severity: Severity; title: string; newsId?: string; findingId?: string; url?: string }
export type PlanLine = { id: string; text: string; kind: Kind; source: string; date?: string; severity?: Severity; findings: string[]; url?: string; label?: string }

export type CallPlan = {
  ref: string
  reasons: PlanLine[] // why we call, most pressing first
  goals: PlanLine[] // what the call should achieve; the first one is the main goal
  arguments: PlanLine[] // how to convince THIS client; `label` names the lever
  open: PlanLine // the advisor's first sentence
  tone: string[]
  avoid: PlanLine[]
  questions: { id: string; q: string; a: string; findings: string[] }[] // what the client will probably ask back
  phrasedBy: 'vorlage' | 'openai' | 'apertus'
  rejected: { id: string; text: string; numbers: string[] }[]
}
