// After-call note, client side (server: server/calls.ts). The server drafts a CallNote from the
// finished call's transcript; nothing is stored until the advisor confirms it. A confirmed note is
// memory: the next briefing reads it (engine/checks/memory-call-promise.ts).
import type { CallNote } from '../types'
import { pick, type Lang } from '../../engine/lang.ts'
import { uiLang } from '../data/uiLang'

export type SpokenLine = { speaker: string; text: string }

// Every request names the advisor's language (`language` in the body), so the server answers in it.
async function post<T>(path: string, payload: Record<string, unknown>, lang: Lang): Promise<T> {
  const t = pick(lang)
  let r: Response
  try {
    r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, language: lang }) })
  } catch {
    throw new Error(t('Server nicht erreichbar', 'Server not reachable'))
  }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof data?.error === 'string' ? data.error : t(`Fehler ${r.status}`, `Error ${r.status}`))
  return data as T
}

// The client's name never goes to a model (CLAUDE.md): its words are blanked in the transcript first.
const SUFFIX = /^(ag|gmbh|sa|ltd|inc|und|von|van|der|die|das)$/i
export function maskName(text: string, name: string): string {
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !SUFFIX.test(w))
  return parts.reduce((t, w) => t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'), '[Name]'), text)
}

/** What was heard since the call began: the transcript minus whatever already stood there before it. */
export function sinceCallStart<T>(before: T[], now: T[]): T[] {
  return before.length <= now.length && before.every((l, i) => l === now[i]) ? now.slice(before.length) : now
}

export const isEmptyNote = (n: CallNote) => !n.proposed.length && !n.promises.length && !n.factUpdates.length

/** Draft from the transcript. Not stored. Throws with a message for the advisor when the server cannot answer. */
export async function draftNote(ref: string, lines: SpokenLine[], clientName = '', lang: Lang = uiLang()): Promise<CallNote> {
  const transcript = lines.filter((l) => l.text.trim()).map((l) => ({ speaker: l.speaker, text: clientName ? maskName(l.text, clientName) : l.text }))
  const r = await post<{ note?: CallNote }>(`/api/calls/${encodeURIComponent(ref)}/summary`, { transcript }, lang)
  if (!r.note || !Array.isArray(r.note.promises) || !Array.isArray(r.note.proposed) || !Array.isArray(r.note.factUpdates)) throw new Error(pick(lang)('Unerwartete Antwort des Servers', 'Unexpected response from the server'))
  return r.note
}

/** Stores the note the advisor confirmed; from then on it counts as memory for this client. */
export async function confirmNote(ref: string, note: CallNote, lang: Lang = uiLang()): Promise<void> {
  await post<{ ok: boolean }>(`/api/calls/${encodeURIComponent(ref)}/confirm`, { note: { ...note, clientRef: ref, confirmed: true } }, lang)
}
