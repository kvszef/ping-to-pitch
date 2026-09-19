// cio.house-view — the client's portfolio against the bank's investment view (ctx.houseView).
//
// For every measurable stance (asset class, region, sector, currency) the client's exposure, with fund
// look-through, is compared with the portfolio's own SAA target:
// - positive stance, portfolio below its target  → an opportunity (kind 'action'): move towards the target.
// - negative stance, portfolio above its target  → a deviation (kind 'interpretation') to talk about.
// Stances without an SAA target only flag large exposures against a negative view (≥ 30%).
//
// An opportunity is only shown if it passes the client's constraints (PLAN: never miss a *suitable* one):
// - the move stays inside the mandate band (it goes towards the target, and the class is below its maximum),
// - no stated wish excludes it (excluded sector, no emerging markets),
// - a named product comes from the bank's recommendation list, meets the ESG floor if the client has an ESG
//   profile, and is not already held.
// Without ctx.houseView the check says nothing. The model never sees a task here: numbers and wording are fixed.
import type { Dimension } from '../data.ts'
import { ratingDe, type Stance } from '../houseview.ts'
import { categoryDe, dateCh, pct, pts, shortName } from '../format.ts'
import { wishesOf } from '../wishes.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { clientOf, findingId, SRC } from './common.ts'
import { clientExposure, esgFloor, hasEsgProfile, heldSecurities } from './wish-common.ts'

const CHECK = 'cio.house-view'
const GAP = 0.02 // closer than 2 points to the target counts as in line with the view
const NO_TARGET_LIMIT = 0.3 // without an SAA target, a negative view only flags exposures of 30% or more
const MAX_FINDINGS = 3

// Recommendation-list names carry share-class wrappers ("Anteile -(CHF) A-dis- UBS ETF (CH) - SMI (R)"):
// keep the product, drop the wrapper, for one readable line.
const productName = (name: string) => shortName(name
  .replace(/^(Anteile|Namen-Aktie|Inhaber-Aktie|Na\. u\. Inh\. Ti\.-Aktie|Genussschein)\s+/i, '')
  .replace(/^-[^-]*-\s*/, '')
  .replace(/^(CHF|USD|EUR)\s*\(Hedged\)\s*/i, '')
  .replace(/\s*\(R\)/g, '')
  .trim())

type Hit = { stance: Stance; actual: number; target?: number; gap: number; kind: 'chance' | 'abweichung'; product?: string }

export const houseView: Check = (raw, ctx) => {
  const view = ctx.houseView
  if (!view) return []
  const client = clientOf(raw, ctx.ref)
  if (!client.portfolios.some((p) => p.positions.length)) return []

  // Targets come from the largest portfolio that has an SAA with real targets.
  const main = [...client.portfolios].sort((a, b) => b.value - a.value).find((p) => ctx.ref.saa(p.saaId)?.bands.some((b) => (b.target ?? 0) > 0))
  const saa = main ? ctx.ref.saa(main.saaId) : undefined
  const { wishes } = wishesOf(client, ctx)
  const held = new Set(heldSecurities(client).rows.map((r) => r.securityId).filter((id): id is number => id !== undefined))
  const esg = hasEsgProfile(client, ctx.ref), floor = esgFloor(client, ctx.ref)
  const exposures = new Map<Dimension, ReturnType<typeof clientExposure>>()
  const exposureOf = (d: Dimension) => exposures.get(d) ?? exposures.set(d, clientExposure(client, d, ctx.ref)).get(d)!

  const blocked = (s: Stance) => wishes.some(({ wish }) =>
    (wish.type === 'exclude-sector' && s.dimension === 'Industry' && wish.sector === s.category) ||
    (wish.type === 'exclude-emerging-markets' && s.dimension === 'CountryGroup' && s.category === 'Others') ||
    (wish.type === 'esg-only' && s.dimension === 'Industry' && s.category === 'Energy'))

  // A product for the move, from the bank's recommendation list: funds first, ESG floor respected, not held yet.
  const productFor = (s: Stance) => {
    const fits = ctx.ref.recommended().filter((x) => !held.has(x.id) && (!esg || (x.esgScore ?? 0) >= floor) && (
      s.dimension === 'AssetClass' ? x.assetClass === s.category
        : s.dimension === 'CountryGroup' ? x.assetClass === 'Shares' && x.countryGroup === s.category
          : s.dimension === 'Industry' ? x.assetClass === 'Shares' && x.industry === s.category : false))
    const fund = fits.find((x) => /fund|etf/i.test(x.type ?? '')) ?? fits[0]
    return fund ? productName(fund.name) : undefined
  }

  let measured = 0, inLine = 0
  const hits: Hit[] = []
  for (const s of view.stances) {
    if (s.dimension === 'Style' || s.rating === 0) continue
    const e = exposureOf(s.dimension)
    if (e.base <= 0) continue // e.g. regions of a portfolio without shares
    const band = saa?.bands.find((b) => b.dimension === s.dimension && b.category === s.category)
    const target = band?.target !== undefined && band.target > 0 ? band.target : undefined
    const actual = e.ofBase.get(s.category) ?? 0
    measured++
    if (s.rating > 0) {
      if (target === undefined || actual >= target - GAP) { inLine++; continue }
      if (band?.max !== undefined && actual >= band.max) { inLine++; continue } // already at the band's ceiling
      if (blocked(s)) continue
      hits.push({ stance: s, actual, target, gap: actual - target, kind: 'chance', product: productFor(s) })
    } else {
      const over = target !== undefined ? actual > target + GAP : actual >= NO_TARGET_LIMIT
      if (!over) { inLine++; continue }
      hits.push({ stance: s, actual, target, gap: actual - (target ?? 0), kind: 'abweichung' })
    }
  }

  const id = (subject: string) => findingId(CHECK, client.ref, subject)
  const viewEvidence: Evidence = { source: view.example ? 'Hausmeinung (Beispiel)' : 'Hausmeinung', quote: view.title, date: view.date }
  const within = (s: Stance) => (s.dimension === 'CountryGroup' || s.dimension === 'Industry' ? ' des Aktienteils' : '')
  const out: Finding[] = [{
    id: id('summary'), check: CHECK, kind: 'fact', severity: 'info', topic: 'house-view',
    title: `Hausmeinung vom ${dateCh(view.date)}: Portfolio in ${inLine} von ${measured} Punkten auf Linie`,
    detail: view.summary,
    numbers: { measured, inLine, chances: hits.filter((h) => h.kind === 'chance').length, deviations: hits.filter((h) => h.kind === 'abweichung').length },
    evidence: [viewEvidence],
  }]

  for (const h of hits.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, MAX_FINDINGS)) {
    const s = h.stance
    const where = h.target !== undefined ? `${pct(h.actual)}${within(s)} statt Ziel ${pct(h.target)} (${pts(h.gap)})` : `${pct(h.actual)}${within(s)}`
    out.push({
      id: id(`${s.dimension}:${s.category}`), check: CHECK,
      kind: h.kind === 'chance' ? 'action' : 'interpretation',
      severity: h.kind === 'chance' ? 'ok' : 'warn', topic: 'house-view',
      title: h.kind === 'chance'
        ? `Chance: Hausmeinung ${s.label} ${ratingDe(s.rating)}, Portfolio ${where}`
        : `Hausmeinung ${s.label} ${ratingDe(s.rating)}${s.action ? ` (${s.action})` : ''}, Portfolio ${where}`,
      detail: [
        s.why,
        h.kind === 'chance' ? `Aufstocken bis zum Ziel bleibt im Mandatsband${h.product ? `; aus der Empfehlungsliste: ${h.product}` : ''}.` : '',
        `Gemessen mit Durchsicht in Fonds, Kategorie ${categoryDe(s.category)}.`,
      ].filter(Boolean).join(' '),
      numbers: { actual: h.actual, ...(h.target !== undefined ? { target: h.target } : {}), gap: h.gap, rating: s.rating },
      evidence: [viewEvidence, SRC.saa(saa?.name), ...(main ? [SRC.portfolio(main.nr)] : [])],
    })
  }
  return out
}
