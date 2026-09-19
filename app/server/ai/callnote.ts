// A3/A2: drafts a CallNote (engine/types.ts) from a finished call's transcript, for the advisor to
// confirm before it becomes memory for the client's next call (server/memory/store.ts → ctx.memory →
// engine/checks/memory-call-promise.ts). The model only reports what is actually in the transcript;
// nothing here is shown to the client or reaches the screen unconfirmed.

import { unsupportedNumbers } from '../../src/workspace/grounding.ts'
import type { CallNote } from '../../engine/types.ts'
import type { Briefing60 } from './briefing.ts'

export type Segment = { speaker: string; text: string }
export type Complete = (messages: { role: 'system' | 'user'; content: string }[]) => Promise<unknown>

const RULES = `Du fasst ein gerade beendetes Beratungsgespräch für die Kundenakte zusammen. Deutsch, Schweizer Schreibweise (ss statt ß).
Du bekommst BRIEFING-PUNKTE (was der Berater laut Vorbereitung ansprechen oder abfragen wollte, je mit "id" und "text") und das TRANSKRIPT des Gesprächs.
Bestimme ausschliesslich, was im Transkript tatsächlich vorkommt:
- "proposed": für jeden Briefing-Punkt, der im Gespräch vorkam: "findingId" (die id des Punkts), "text" (kurz, worum es ging), "reaction" ("accepted" wenn der Kunde zustimmte, "rejected" wenn er ablehnte, "open" wenn es offen blieb), "why" (ein kurzer Beleg aus dem Gespräch).
- "promises": offene Aufgaben für den Berater aus dem Gespräch, je mit "text" und, falls ein Termin genannt wird, "due" im Format JJJJ-MM-TT. Dazu zählen (a) Zusagen, die der BERATER macht (z. B. Unterlagen zusenden, etwas abklären), und (b) Aufträge, Bitten und offene Fragen des KUNDEN an den Berater (z. B. eine Position verkleinern, Alternativen vorschlagen), auch wenn der Berater nicht ausdrücklich zugesagt hat. Beginne den Text bei (b) mit "Kundenauftrag: ".
- Das Gespräch kann auf Englisch geführt sein; deine Texte sind trotzdem Deutsch.
- "factUpdates": pro Briefing-Punkt, der eine veraltete Kundennotiz betrifft, ob sie bestätigt ("confirmed"), im Gespräch als überholt genannt ("outdated") oder durch neue Angaben ersetzt wurde ("changed", dann "newValue").
Nichts erfinden. Kein Punkt, keine Zahl, kein Datum, das nicht im Transkript steht. Kam ein Bereich im Gespräch gar nicht vor, lass ihn weg.
Antworte als ein einziges JSON-Objekt ohne weiteren Text: {"proposed": [...], "promises": [...], "factUpdates": [...]}`

const words = (t: string) => t.split(/\s+/).filter(Boolean).length
const MAX_WORDS = 30

/** The points the advisor was told to raise or ask about, from the (possibly model-written) talk track. */
function briefingPoints(b: Briefing60): { id: string; text: string }[] {
  return [...b.blocks.mention, ...b.blocks.ask].map((l) => ({ id: l.id, text: l.text }))
}

const emptyNote = (ref: string): CallNote => ({ id: `call-${ref}-${Date.now()}`, clientRef: ref, date: new Date().toISOString(), confirmed: false, proposed: [], promises: [], factUpdates: [] })

/** Never throws: a transcript the model can't make sense of just yields an empty draft for the advisor to fill in by hand. */
export async function draftCallNote(ref: string, transcript: Segment[], briefing: Briefing60, complete: Complete): Promise<CallNote> {
  const base = emptyNote(ref)
  if (!transcript.length) return base
  const transcriptText = transcript.map((s) => `${s.speaker}: ${s.text}`).join('\n')
  const points = briefingPoints(briefing)
  try {
    const answer = await complete([
      { role: 'system', content: RULES },
      { role: 'user', content: `BRIEFING-PUNKTE:\n${JSON.stringify(points)}\n\nTRANSKRIPT:\n${transcriptText}` },
    ])
    const a = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>) : {}
    const knownIds = new Set(points.map((p) => p.id))
    const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : [])
    const grounded = (text: string) => text && words(text) <= MAX_WORDS && !unsupportedNumbers(text, transcriptText).length

    const proposed: CallNote['proposed'] = arr(a.proposed).flatMap((r) => {
      const text = typeof r.text === 'string' ? r.text.trim() : ''
      const reaction = r.reaction === 'accepted' || r.reaction === 'rejected' || r.reaction === 'open' ? r.reaction : undefined
      const why = typeof r.why === 'string' ? r.why.trim() : undefined
      if (!text || !reaction || !grounded(text) || (why && !grounded(why))) return []
      const findingId = typeof r.findingId === 'string' && knownIds.has(r.findingId) ? r.findingId : undefined
      return [{ findingId, text, reaction, ...(why ? { why } : {}) }]
    })

    const promises: CallNote['promises'] = arr(a.promises).flatMap((r) => {
      const text = typeof r.text === 'string' ? r.text.trim() : ''
      if (!text || !grounded(text)) return []
      const due = typeof r.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.due) ? r.due : undefined
      return [{ text, done: false, ...(due ? { due } : {}) }]
    })

    const factUpdates: CallNote['factUpdates'] = arr(a.factUpdates).flatMap((r) => {
      const note = typeof r.note === 'string' ? r.note.trim() : ''
      const status = r.status === 'confirmed' || r.status === 'outdated' || r.status === 'changed' ? r.status : undefined
      const newValue = typeof r.newValue === 'string' ? r.newValue.trim() : undefined
      if (!note || !status || !grounded(note) || (newValue && !grounded(newValue))) return []
      return [{ note, status, ...(newValue ? { newValue } : {}) }]
    })

    return { ...base, proposed, promises, factUpdates }
  } catch {
    return base
  }
}
