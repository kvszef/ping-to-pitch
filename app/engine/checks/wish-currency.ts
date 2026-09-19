// wish.currency — "foreign-currency positions CHF-hedged" against the holdings (E2). A security traded in a
// currency other than CHF counts as unhedged unless its name says it is a CHF-hedged share class ("Hedged CHF",
// "(H2-CHF)"): the data has no hedge flag, so this is read from names and labelled an interpretation.
// Funds traded in CHF that invest abroad are not counted (their hedging is not in the data either).
import { pct } from '../format.ts'
import type { Check, Finding } from '../types.ts'
import { wishesOf } from '../wishes.ts'
import { clientOf, findingId, SRC } from './common.ts'
import { heldSecurities, noteEvidence, subjectOf, uniqueIds } from './wish-common.ts'

const CHECK = 'wish.currency'
const HEDGED = /hedged|\(H\d?-CHF\)|CHF[- ]H\b|abgesichert|couvert/i
const TOLERANCE = 0.0005

export const currency: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const unique = uniqueIds()
  const wishes = wishesOf(client, ctx).wishes.filter((w) => w.wish.type === 'prefer-chf-hedged')
  if (!wishes.length) return []
  const { rows } = heldSecurities(client)
  const foreign = rows.filter((r) => r.share > 0 && r.currency && r.currency !== 'CHF')
  const unhedged = foreign.filter((r) => !HEDGED.test(`${r.name} ${r.security?.name ?? ''}`)).sort((a, b) => b.share - a.share)
  const unhedgedShare = unhedged.reduce((a, r) => a + r.share, 0)
  const foreignShare = foreign.reduce((a, r) => a + r.share, 0)
  const note = 'Absicherung aus dem Titelnamen gelesen (z. B. «Hedged CHF»), die Daten haben kein eigenes Feld dafür. CHF-Fonds mit Auslandanlagen sind nicht mitgezählt.'

  return wishes.map((w): Finding => {
    const id = unique(findingId(CHECK, client.ref, subjectOf(w)))
    const numbers = { unhedgedShare, foreignShare }
    if (unhedgedShare <= TOLERANCE) {
      return {
        id, check: CHECK, kind: 'interpretation', severity: 'ok', topic: 'currency', numbers,
        title: `Wunsch «${w.de}» erfüllt: keine ungesicherten Fremdwährungstitel`,
        detail: note, evidence: [noteEvidence(w)],
      }
    }
    return {
      id, check: CHECK, kind: 'interpretation', severity: 'warn', topic: 'currency', numbers,
      title: `Wunsch «${w.de}»: ${pct(unhedgedShare)} des Vermögens in Fremdwährungstiteln ohne CHF-Absicherung`,
      detail: `Grösste: ${unhedged.slice(0, 3).map((r) => `${r.name} (${r.currency}, ${pct(r.share)})`).join(', ')}. ${note}`,
      evidence: [noteEvidence(w), ...unhedged.slice(0, 3).map((r) => ({ ...SRC.position(r.name, r.currency ?? ''), ref: r.securityId === undefined ? undefined : String(r.securityId) }))],
    }
  })
}
