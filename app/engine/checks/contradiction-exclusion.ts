// contradiction.* — exclusion wishes from the notes against what the client really holds, fund look-through
// included, with the smallest fix and its re-check (E2). Check names match the briefing's stopgap
// (contradiction.fossil-fuel, .region, .unverifiable), so the engine replaces it per check.
//
// - fulfilled: 'ok' fact; a "no direct positions" wish met while funds still hold some says how much.
// - broken: 'risk' when the note itself says the thing is excluded (read by the rules), 'warn' when the model read
//   the note (an interpretation). Comes with one sale as a draft proposal, before and after, and any new
//   breach the sale would cause.
// - not checkable (defense, tobacco, human rights: no such category in the data): an 'info' action to go
//   through the titles with the client.
// Ids: `${check}:${client}:${kind}:${note date}`. The main app's contradiction card reads the kind from the id
// (fossil, fossil-direct, emerging-markets).
import { categoryDe, pct } from '../format.ts'
import { breachOf, measureExclusion, saleText, smallestFix, type ExclusionWish } from '../fix.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { wishesOf } from '../wishes.ts'
import { clientOf, findingId } from './common.ts'
import { aiHint, noteEvidence, subjectOf, uniqueIds } from './wish-common.ts'

const TOLERANCE = 0.0005 // below 0.05% of wealth counts as none (rounding in the fund breakdowns)

function names(wish: ExclusionWish) {
  if (wish.type === 'exclude-emerging-markets') return { check: 'contradiction.region', kind: 'emerging-markets', label: 'Schwellenländer', topic: 'region' }
  if (wish.sector === 'Energy') return { check: 'contradiction.fossil-fuel', kind: wish.scope === 'direct' ? 'fossil-direct' : 'fossil', label: 'Energie', topic: 'esg' }
  return { check: 'contradiction.sector', kind: `sector-${wish.sector.replace(/\s+/g, '-')}${wish.scope === 'direct' ? '-direct' : ''}`, label: categoryDe(wish.sector), topic: 'allocation' }
}

export const exclusions: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const unique = uniqueIds()
  const out: Finding[] = []
  for (const w of wishesOf(client, ctx).wishes) {
    const { wish } = w
    const byAi = aiHint(w)
    if (wish.type === 'exclude-unverifiable') {
      out.push({
        id: unique(findingId('contradiction.unverifiable', client.ref, `${wish.label}:${subjectOf(w)}`)),
        check: 'contradiction.unverifiable', kind: 'action', severity: 'info', topic: 'esg',
        title: `Wunsch «${w.de}» ist vermerkt, lässt sich aber nicht prüfen`,
        detail: `Nicht automatisch prüfbar: die Daten kennen keine Kategorie «${wish.label}». Titel gemeinsam durchgehen, nicht raten.${byAi}`,
        evidence: [noteEvidence(w)],
      })
      continue
    }
    if (wish.type !== 'exclude-sector' && wish.type !== 'exclude-emerging-markets') continue

    const { check, kind, label, topic } = names(wish)
    const id = unique(findingId(check, client.ref, `${kind}:${subjectOf(w)}`))
    const m = measureExclusion(client, wish, ctx.ref)
    const direct = wish.type === 'exclude-sector' && wish.scope === 'direct'
    const breach = breachOf(m, wish)
    const numbers: Record<string, number> = { total: m.total, direct: m.direct, viaFunds: m.viaFunds, unclassified: m.unclassified }
    const positions: Evidence[] = m.holdings.slice(0, 4).map((h) => ({
      source: 'Position', ref: String(h.securityId ?? h.name),
      quote: h.via === 'Fonds' ? `${h.name}: ${pct(h.share)} des Vermögens, davon ${pct(h.fraction)} ${label} = ${pct(h.exposure, 2)}` : `${h.name}: ${pct(h.share)} des Vermögens, direkt`,
    }))
    const unclassified = m.unclassified > 0.001 ? ` ${pct(m.unclassified)} des Vermögens liegen in Titeln ohne Stammdaten und sind nicht mitgezählt.` : ''
    const scope = wish.type === 'exclude-sector' ? 'Aktienteil mit Fonds-Durchsicht' : 'alle Positionen mit Fonds-Durchsicht'

    if (breach <= TOLERANCE) {
      out.push({
        id, check, kind: 'fact', severity: 'ok', topic, numbers,
        title: direct && m.total > TOLERANCE ? `Wunsch «${w.de}» erfüllt: keine Direktanlage, über breite Fonds ${pct(m.total)} ${label}` : `Wunsch «${w.de}» erfüllt`,
        detail: `Direkt ${pct(m.direct)}, über Fonds ${pct(m.viaFunds)} des Vermögens (${scope}).${unclassified}${byAi}`,
        evidence: [noteEvidence(w), ...positions],
      })
      continue
    }

    const fix = smallestFix(raw, ctx, wish, m)
    const where = direct ? `${pct(m.direct)} direkt` : m.direct <= TOLERANCE ? `${pct(m.total)} ${label}, alles über ${m.holdings.length} Fonds` : `${pct(m.total)} ${label}, davon ${pct(m.viaFunds)} über Fonds`
    const recheck = fix
      ? fix.newIssues.length ? ` Nach dem Verkauf: ${fix.newIssues.map((f) => f.title).join('; ')}.` : ' Nach dem Verkauf: keine neue Warnung bei Allokation, Klumpen und Risiko.'
      : ''
    out.push({
      id, check, kind: 'fact', severity: w.by === 'rule' ? 'risk' : 'warn', topic,
      numbers: { ...numbers, before: breach, ...(fix ? { after: fix.after, newIssues: fix.newIssues.length } : {}) },
      fix: fix?.fix,
      title: `Widerspruch: Wunsch «${w.de}», Portfolio hält ${where}`,
      detail: `${fix ? `Grösster Treiber: ${fix.holding.name} mit ${pct(fix.holding.exposure)}. Nach Verkauf: ${pct(fix.after)}.` : 'Kein einzelner Verkauf gefunden.'}${recheck}${unclassified}${byAi}`,
      evidence: [noteEvidence(w), ...positions, ...(fix ? [{ source: 'Vorschlag', ref: String(fix.holding.securityId ?? fix.holding.name), quote: saleText(fix.holding) }] : [])],
    })
  }
  return out
}
