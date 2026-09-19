// A3 memory store: confirmed CallNotes, in-memory for this server session (same pattern as the
// uploaded-clients map in ai/briefing-route.ts — no database, cleared on restart, never committed).
// Feeds ctx.memory for engine/checks/memory-call-promise.ts, so a promise made on one call shows up
// as a finding on the next.
import type { CallNote } from '../../engine/types.ts'

const byRef = new Map<string, CallNote[]>()

export function addCallNote(note: CallNote): void {
  byRef.set(note.clientRef, [...(byRef.get(note.clientRef) ?? []), note])
}

/** Confirmed notes for one client, oldest first. */
export function notesFor(ref: string): CallNote[] {
  return byRef.get(ref) ?? []
}

/** Marks a promise or a proposed point done, e.g. once the advisor follows through. */
export function markDone(ref: string, noteId: string, kind: 'promise' | 'proposed', index: number): boolean {
  const notes = byRef.get(ref)
  const note = notes?.find((n) => n.id === noteId)
  if (!note) return false
  if (kind === 'promise' && note.promises[index]) { note.promises[index].done = true; return true }
  if (kind === 'proposed' && note.proposed[index]) { note.proposed[index].reaction = 'accepted'; return true }
  return false
}

/** Test-only: resets the store between test files. */
export function clearMemoryStore(): void {
  byRef.clear()
}
