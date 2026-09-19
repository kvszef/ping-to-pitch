// A3/A2: HTTP side of the post-call summary, mounted by server/api.ts.
//   POST /api/calls/:ref/summary   body { transcript: Segment[], language?: 'de' | 'en' } -> { note: CallNote } (draft, not stored)
//   POST /api/calls/:ref/confirm   body { note: CallNote }               -> stores it, marks confirmed
// The draft is never stored on its own: the advisor confirms it (or edits it) first, same idea as a
// draft proposal in the engine. Only a confirmed note becomes memory for the client's next call.
// `language` (absent = English) is the language the model drafts the note in and of the error messages; a
// confirmed note is stored as written.
import { draftCallNote, type Segment } from './ai/callnote.ts'
import { templateFor, type Llm } from './ai/briefing-route.ts'
import { addCallNote } from './memory/store.ts'
import { langOf, pick, type Lang } from '../engine/lang.ts'
import type { CallNote } from '../engine/types.ts'

type Provider = 'openai' | 'apertus'
const providerFor = (llm: Llm): Provider | null => (llm.ready('openai') ? 'openai' : llm.ready('apertus') ? 'apertus' : null)

// Typed with the optional `lang` so this compiles before and after ai/briefing-route.ts takes it (the briefing
// points the model matches against are then phrased in the note's language).
const template: (ref: string, llm: Llm, lang?: Lang) => ReturnType<typeof templateFor> = templateFor

const isSegments = (v: unknown): v is Segment[] => Array.isArray(v) && v.every((s) => typeof s === 'object' && s !== null && typeof (s as Segment).speaker === 'string' && typeof (s as Segment).text === 'string')

function isCallNote(v: unknown): v is CallNote {
  if (typeof v !== 'object' || v === null) return false
  const n = v as Record<string, unknown>
  return typeof n.id === 'string' && typeof n.clientRef === 'string' && Array.isArray(n.proposed) && Array.isArray(n.promises) && Array.isArray(n.factUpdates)
}

/** Routes this module handles. Returns null when the path is not one of ours, so api.ts falls through. */
export async function callsRoute(path: string, method: string, body: Buffer, llm: Llm): Promise<{ status: number; data: unknown } | null> {
  const m = /^\/api\/calls\/([^/]+)\/(summary|confirm)$/.exec(path)
  if (!m || method !== 'POST') return null
  const ref = decodeURIComponent(m[1])
  const action = m[2]
  let parsed: unknown
  try { parsed = JSON.parse(body.toString('utf8') || '{}') } catch { return { status: 400, data: { error: 'Invalid JSON' } } }
  const p = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const lang = langOf(p.language)
  const t = pick(lang)

  if (action === 'confirm') {
    if (!isCallNote(p.note) || p.note.clientRef !== ref) return { status: 400, data: { error: t('Feld note fehlt oder passt nicht zum Kunden', 'Field note is missing or does not belong to this client') } }
    addCallNote({ ...p.note, confirmed: true })
    return { status: 200, data: { ok: true } }
  }

  // action === 'summary'
  if (!isSegments(p.transcript)) return { status: 400, data: { error: t('Feld transcript fehlt', 'Field transcript is missing') } }
  const found = await template(ref, llm, lang)
  if (!found) return { status: 404, data: { error: t('Kunde nicht gefunden', 'Client not found') } }
  const provider = providerFor(llm)
  if (!provider) return { status: 200, data: { note: { id: `call-${ref}-${Date.now()}`, clientRef: ref, date: new Date().toISOString(), confirmed: false, proposed: [], promises: [], factUpdates: [] } } }
  const note = await draftCallNote(ref, p.transcript, found.template, (msgs) => llm.complete(provider, msgs), lang)
  return { status: 200, data: { note } }
}
