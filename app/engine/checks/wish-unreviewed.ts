// wish.unreviewed — a note neither the rules nor the model could read (E2). Never dropped silently: the
// advisor gets it verbatim with its date and reads it.
import type { Check } from '../types.ts'
import { wishesOf } from '../wishes.ts'
import { clientOf, findingId } from './common.ts'
import { noteEvidence, uniqueIds } from './wish-common.ts'

const CHECK = 'wish.unreviewed'

export const unreviewed: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const unique = uniqueIds()
  return wishesOf(client, ctx).unread.map((note) => ({
    id: unique(findingId(CHECK, client.ref, note.date ?? 'ohne-datum')),
    check: CHECK, kind: 'action', severity: 'info', topic: 'notes',
    title: ctx.lang === 'en' ? 'Note not checked automatically, please read' : 'Notiz nicht automatisch geprüft, bitte lesen',
    detail: `«${note.text}»`,
    evidence: [noteEvidence({ note }, ctx.lang)],
  }))
}
