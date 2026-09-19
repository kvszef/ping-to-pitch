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
import { categoryName, pct } from '../format.ts'
import { breachOf, measureExclusion, saleText, smallestFix, type ExclusionWish } from '../fix.ts'
import { pick, prefix, sourceName, type Lang } from '../lang.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { unverifiableLabel, wishesOf, wishText } from '../wishes.ts'
import { clientOf, findingId } from './common.ts'
import { aiHint, noteEvidence, subjectOf, uniqueIds } from './wish-common.ts'

const TOLERANCE = 0.0005 // below 0.05% of wealth counts as none (rounding in the fund breakdowns)

function names(wish: ExclusionWish, lang?: Lang) {
  const t = pick(lang)
  if (wish.type === 'exclude-emerging-markets') return { check: 'contradiction.region', kind: 'emerging-markets', label: t('Schwellenländer', 'emerging markets'), topic: 'region' }
  if (wish.sector === 'Energy') return { check: 'contradiction.fossil-fuel', kind: wish.scope === 'direct' ? 'fossil-direct' : 'fossil', label: t('Energie', 'energy'), topic: 'esg' }
  return { check: 'contradiction.sector', kind: `sector-${wish.sector.replace(/\s+/g, '-')}${wish.scope === 'direct' ? '-direct' : ''}`, label: categoryName(wish.sector, lang), topic: 'allocation' }
}

export const exclusions: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const unique = uniqueIds()
  const { lang } = ctx
  const t = pick(lang)
  const out: Finding[] = []
  for (const w of wishesOf(client, ctx).wishes) {
    const { wish } = w
    const byAi = aiHint(w, lang)
    const wished = `${prefix('wish', lang)}«${wishText(w, lang)}»` // 'Wunsch «…»' / 'Wish «…»'
    if (wish.type === 'exclude-unverifiable') {
      out.push({
        id: unique(findingId('contradiction.unverifiable', client.ref, `${wish.label}:${subjectOf(w)}`)),
        check: 'contradiction.unverifiable', kind: 'action', severity: 'info', topic: 'esg',
        // The briefing composer strips the tail of this title, in both languages.
        title: t(`${wished} ist vermerkt, lässt sich aber nicht prüfen`, `${wished} is noted but cannot be verified`),
        detail: t(
          `Nicht automatisch prüfbar: die Daten kennen keine Kategorie «${wish.label}». Titel gemeinsam durchgehen, nicht raten.${byAi}`,
          `Cannot be checked automatically: the data has no category «${unverifiableLabel(wish.label, 'en') ?? wish.label}». Go through the securities together, do not guess.${byAi}`,
        ),
        evidence: [noteEvidence(w, lang)],
      })
      continue
    }
    if (wish.type !== 'exclude-sector' && wish.type !== 'exclude-emerging-markets') continue

    const { check, kind, label, topic } = names(wish, lang)
    const id = unique(findingId(check, client.ref, `${kind}:${subjectOf(w)}`))
    const m = measureExclusion(client, wish, ctx.ref)
    const direct = wish.type === 'exclude-sector' && wish.scope === 'direct'
    const breach = breachOf(m, wish)
    const numbers: Record<string, number> = { total: m.total, direct: m.direct, viaFunds: m.viaFunds, unclassified: m.unclassified }
    const positions: Evidence[] = m.holdings.slice(0, 4).map((h) => ({
      source: sourceName('position', lang), ref: String(h.securityId ?? h.name),
      quote: h.via === 'Fonds'
        ? t(`${h.name}: ${pct(h.share)} des Vermögens, davon ${pct(h.fraction)} ${label} = ${pct(h.exposure, 2)}`, `${h.name}: ${pct(h.share)} of total assets, of which ${pct(h.fraction)} ${label} = ${pct(h.exposure, 2)}`)
        : t(`${h.name}: ${pct(h.share)} des Vermögens, direkt`, `${h.name}: ${pct(h.share)} of total assets, held directly`),
    }))
    const unclassified = m.unclassified > 0.001
      ? t(` ${pct(m.unclassified)} des Vermögens liegen in Titeln ohne Stammdaten und sind nicht mitgezählt.`, ` ${pct(m.unclassified)} of total assets sit in securities without master data and are not counted.`)
      : ''
    const scope = wish.type === 'exclude-sector'
      ? t('Aktienteil mit Fonds-Durchsicht', 'equity part with fund look-through')
      : t('alle Positionen mit Fonds-Durchsicht', 'all positions with fund look-through')

    if (breach <= TOLERANCE) {
      out.push({
        id, check, kind: 'fact', severity: 'ok', topic, numbers,
        title: direct && m.total > TOLERANCE
          ? t(`${wished} erfüllt: keine Direktanlage, über breite Fonds ${pct(m.total)} ${label}`, `${wished} met: no direct holding, ${pct(m.total)} ${label} through broad funds`)
          : t(`${wished} erfüllt`, `${wished} met`),
        detail: t(
          `Direkt ${pct(m.direct)}, über Fonds ${pct(m.viaFunds)} des Vermögens (${scope}).${unclassified}${byAi}`,
          `Directly ${pct(m.direct)}, through funds ${pct(m.viaFunds)} of total assets (${scope}).${unclassified}${byAi}`,
        ),
        evidence: [noteEvidence(w, lang), ...positions],
      })
      continue
    }

    const fix = smallestFix(raw, ctx, wish, m)
    const where = direct
      ? t(`${pct(m.direct)} direkt`, `${pct(m.direct)} directly`)
      : m.direct <= TOLERANCE
        ? t(`${pct(m.total)} ${label}, alles über ${m.holdings.length} Fonds`, `${pct(m.total)} ${label}, all through ${m.holdings.length} ${m.holdings.length === 1 ? 'fund' : 'funds'}`)
        : t(`${pct(m.total)} ${label}, davon ${pct(m.viaFunds)} über Fonds`, `${pct(m.total)} ${label}, of which ${pct(m.viaFunds)} through funds`)
    // The re-check findings come from the portfolio checks, phrased in ctx.lang like this one.
    const recheck = fix
      ? fix.newIssues.length
        ? t(` Nach dem Verkauf: ${fix.newIssues.map((f) => f.title).join('; ')}.`, ` After the sale: ${fix.newIssues.map((f) => f.title).join('; ')}.`)
        : t(' Nach dem Verkauf: keine neue Warnung bei Allokation, Klumpen und Risiko.', ' After the sale: no new warning on allocation, cluster risk or risk.')
      : ''
    out.push({
      id, check, kind: 'fact', severity: w.by === 'rule' ? 'risk' : 'warn', topic,
      numbers: { ...numbers, before: breach, ...(fix ? { after: fix.after, newIssues: fix.newIssues.length } : {}) },
      fix: fix?.fix,
      title: `${prefix('contradiction', lang)}${wished}, ${t('Portfolio hält', 'portfolio holds')} ${where}`,
      detail: `${fix
        ? t(`Grösster Treiber: ${fix.holding.name} mit ${pct(fix.holding.exposure)}. Nach Verkauf: ${pct(fix.after)}.`, `Largest driver: ${fix.holding.name} with ${pct(fix.holding.exposure)}. Selling it leaves ${pct(fix.after)}.`)
        : t('Kein einzelner Verkauf gefunden.', 'No single sale found.')}${recheck}${unclassified}${byAi}`,
      evidence: [noteEvidence(w, lang), ...positions, ...(fix ? [{ source: sourceName('fix', lang), ref: String(fix.holding.securityId ?? fix.holding.name), quote: saleText(fix.holding, lang) }] : [])],
    })
  }
  return out
}
