// memory.call-promise — A3: promises the ADVISOR made on a previous call, still open, and points
// raised on a call that were left open. Distinct from memory.promise (a client wish read from the
// client file's notes, server/ai/provisional-findings.ts): this reads ctx.memory, the confirmed
// CallNotes from server/memory/store.ts, so it needs a real call to have happened and been confirmed.
// Absent ctx.memory (no call yet, or the caller did not pass it): no findings, never throws.
import { dateCh } from '../format.ts'
import type { CallNote, Check, Finding } from '../types.ts'
import { clientOf, findingId } from './common.ts'

const CHECK = 'memory.call-promise'
const DAY = 24 * 3600e3

function notesFor(ref: string, memory: CallNote[] | undefined): CallNote[] {
  return (memory ?? []).filter((n) => n.clientRef === ref && n.confirmed)
}

export const callPromise: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const out: Finding[] = []
  for (const note of notesFor(client.ref, ctx.memory)) {
    const ageDays = Math.round((ctx.now.getTime() - Date.parse(note.date)) / DAY)
    note.promises.forEach((p, i) => {
      if (p.done) return
      out.push({
        id: findingId(CHECK, client.ref, `${note.id}-promise-${i}`), check: CHECK, kind: 'action',
        severity: p.due && Date.parse(p.due) < ctx.now.getTime() ? 'warn' : 'info',
        title: `Zugesagt: ${p.text}`,
        detail: p.due ? `Fällig bis ${dateCh(p.due)}, zugesagt am ${dateCh(note.date)}.` : `Zugesagt am ${dateCh(note.date)}, noch offen (${ageDays} Tage).`,
        numbers: { ageDays },
        evidence: [{ source: 'Gesprächsnotiz', date: note.date, quote: p.text }],
      })
    })
    note.proposed.forEach((item, i) => {
      if (item.reaction !== 'open') return
      out.push({
        id: findingId(CHECK, client.ref, `${note.id}-open-${i}`), check: CHECK, kind: 'action', severity: 'info',
        title: `Offen aus dem letzten Gespräch: ${item.text}`,
        detail: item.why ? `Damals: ${item.why}` : undefined,
        evidence: [{ source: 'Gesprächsnotiz', date: note.date, quote: item.text }],
      })
    })
  }
  return out
}
