// HTTP side of the call plan, mounted by server/api.ts.
//   POST /api/call-plan   body { ref, reasons?, language?: 'de' | 'en', phrase?: 'openai' | 'apertus' }
// `reasons` are today's ranked reasons for this client exactly as /api/outbound handed them to the
// browser, so the plan opens with the same reason the "Heute anrufen" list shows. Findings are
// computed here; the model (optional) only ever sees findings and public headlines, never names.

import { templateFor, type Llm } from './briefing-route.ts'
import { langOf, type Lang } from '../../engine/lang.ts'
import { composeCallPlan, writeCallPlan, type CallReason } from './callplan.ts'

const SEVERITIES = new Set(['risk', 'warn', 'ok', 'info'])

function readReasons(v: unknown): CallReason[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((x): CallReason[] => {
    const r = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>
    if (typeof r.title !== 'string' || !r.title.trim()) return []
    const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : undefined)
    return [{ kind: r.kind === 'opportunity' ? 'opportunity' : 'risk', severity: SEVERITIES.has(r.severity as string) ? (r.severity as CallReason['severity']) : 'info', title: r.title.trim().slice(0, 300), newsId: s('newsId'), findingId: s('findingId'), url: s('url') }]
  }).slice(0, 5)
}

export async function callPlanRoute(body: Buffer, llm: Llm) {
  const p = JSON.parse(body.toString('utf8') || '{}') as { ref?: unknown; reasons?: unknown; phrase?: unknown; language?: unknown }
  const lang = langOf(p.language)
  const ref = typeof p.ref === 'string' ? p.ref : ''
  const found = ref ? await templateFor(ref, llm) : null
  if (!found) return { status: 404, data: { error: 'Kunde nicht gefunden' } }
  // The template is phrased in the language of the findings it quotes, so a line never mixes two languages.
  // templateFor runs the engine in German for now: once it takes `lang`, pass it above and set this to `lang`.
  const findingsLang: Lang = 'de'
  let plan = composeCallPlan(ref, found.findings, readReasons(p.reasons), findingsLang)
  const phrase = p.phrase === 'openai' || p.phrase === 'apertus' ? p.phrase : null
  if (phrase && llm.ready(phrase)) {
    // The model writes in the advisor's language straight away: no display-time translation for its lines.
    try { plan = await writeCallPlan(plan, found.findings, (m) => llm.complete(phrase, m), phrase, lang) } catch { /* the template stays */ }
  }
  return { status: 200, data: plan }
}
