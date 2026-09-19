// wish.interest — soft wishes ("more sustainable funds", "more tech") measured today, with up to three options
// from the bank's recommendation list (E2). An option must not be held yet, must fit the client's risk profile
// (PRC ≤ MaxPRC), the ESG preference and every exclusion wish, and must match the interest (ESG score ≥ 8 for
// sustainability, the sector for a sector interest). Without a risk profile there are no options: we do not
// suggest what we cannot check. An interest the data cannot measure says so and asks what is meant.
import { currencyGroupOf, type Client, type ReferenceIndex, type Security } from '../data.ts'
import { categoryDe, pct } from '../format.ts'
import { fundName } from '../fix.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { wishesOf, type ClientWish, type Sector } from '../wishes.ts'
import { clientOf, findingId, SRC } from './common.ts'
import { aiHint, clientExposure, esgFloor, hasEsgProfile, heldSecurities, noteEvidence, score, subjectOf, uniqueIds } from './wish-common.ts'

const CHECK = 'wish.interest'
const OPTIONS = 3
const ESG_OPTION = 8 // "clearly sustainable" for an option; our judgement, well above the profile floor
const SECTOR_FUND = 0.3 // a fund counts as a sector option when look-through puts at least 30% in the sector
const CURRENCY_MENTION = 0.05

const EM = /emerging|schwellenl|\bEmMa\b|\bEM\b/i
const sectorShare = (s: Security, sector: Sector, ref: ReferenceIndex) =>
  s.industry === sector ? 1 : s.lookThrough ? ref.lookThrough(s.id, 'Industry')?.get(sector) ?? 0 : 0

// What any suggestion has to pass for this client: risk profile, ESG preference, exclusion wishes.
function suitable(client: Client, wishes: ClientWish[], ref: ReferenceIndex, today: string) {
  const maxPrc = ref.riskProfile(client.riskProfileId)?.maxPrc
  const esgMin = hasEsgProfile(client, ref) || wishes.some((w) => w.wish.type === 'esg-only') ? esgFloor(client, ref) : undefined
  const held = new Set(heldSecurities(client).rows.flatMap((r) => [r.securityId === undefined ? '' : String(r.securityId), r.isin ?? '']).filter(Boolean))
  const test = (s: Security) => {
    if (maxPrc === undefined || s.prc === undefined || s.prc > maxPrc) return false
    if (held.has(String(s.id)) || (s.isin && held.has(s.isin))) return false
    if (s.maturity && s.maturity.slice(0, 10) <= today) return false // matured bonds stay in the list
    if (esgMin !== undefined && (s.esgScore === undefined || s.esgScore < esgMin)) return false
    for (const { wish } of wishes) {
      if (wish.type === 'exclude-sector' && (s.industry === wish.sector || (wish.scope === 'any' && sectorShare(s, wish.sector, ref) > 0))) return false
      if (wish.type === 'exclude-emerging-markets' && ((s.lookThrough && (ref.lookThrough(s.id, 'CountryGroup')?.get('Others') ?? 0) > 0) || EM.test(`${s.assetClassDetail ?? ''} ${s.name}`))) return false
    }
    return true
  }
  return { maxPrc, esgMin, test }
}

const optionText = (s: Security) => `${fundName(s.name)} (ESG ${score(s.esgScore)}, Risikoklasse ${s.prc})`
// One security per name: share classes in other currencies are the same idea.
const distinct = (list: Security[]) => list.filter((s, i) => list.findIndex((x) => fundName(x.name) === fundName(s.name)) === i)

export const interest: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const unique = uniqueIds()
  const all = wishesOf(client, ctx).wishes
  const out: Finding[] = []
  const fit = suitable(client, all, ctx.ref, ctx.now.toISOString().slice(0, 10))
  const recommended = ctx.ref.recommended().filter(fit.test)
  // Funds first (one trade buys a spread), then the higher ESG score, the lower risk class.
  const isFund = (s: Security) => (/fund|etf/i.test(s.type ?? '') ? 0 : 1)
  const byEsg = (a: Security, b: Security) => isFund(a) - isFund(b) || (b.esgScore ?? 0) - (a.esgScore ?? 0) || (a.prc ?? 0) - (b.prc ?? 0) || a.id - b.id
  const rules = `nicht gehalten, Risikoklasse bis ${fit.maxPrc}${fit.esgMin !== undefined ? `, ESG ab ${fit.esgMin}` : ''}, ohne ausgeschlossene Bereiche`

  // The same interest in several notes is one finding, with every note as evidence (newest first).
  const interests = all.filter((w) => w.wish.type === 'interest').sort((a, b) => (b.note.date ?? '').localeCompare(a.note.date ?? ''))
  const keyOf = (w: ClientWish) => (w.wish.type === 'interest' ? `${w.wish.measure}${w.wish.sector ? `-${w.wish.sector.replace(/\s+/g, '-')}` : ''}` : '')
  const seen = new Set<string>()
  for (const w of interests) {
    if (w.wish.type !== 'interest' || seen.has(keyOf(w))) continue
    seen.add(keyOf(w))
    const notes = interests.filter((x) => keyOf(x) === keyOf(w)).map(noteEvidence)
    const { measure } = w.wish
    const id = unique(findingId(CHECK, client.ref, `${keyOf(w)}:${subjectOf(w)}`))
    const base = { id, check: CHECK, kind: 'interpretation' as const, severity: 'info' as const, topic: measure === 'esg-share' ? 'esg' : measure === 'currency-diversification' ? 'currency' : 'allocation' }
    let title: string, detail: string, numbers: Record<string, number>, options: Security[]

    if (measure === 'esg-share') {
      const floor = esgFloor(client, ctx.ref)
      const { rows, cashShare } = heldSecurities(client)
      const share = rows.filter((r) => (r.security?.esgScore ?? -1) >= floor).reduce((a, r) => a + r.share, 0)
      const weakest = rows.filter((r) => r.share > 0 && r.security?.esgScore !== undefined).sort((a, b) => a.security!.esgScore! - b.security!.esgScore! || b.share - a.share)[0]
      const allMeet = rows.every((r) => r.share <= 0 || (r.security?.esgScore ?? -1) >= floor)
      options = recommended.filter((s) => (s.esgScore ?? 0) >= ESG_OPTION).sort(byEsg)
      numbers = { share, cashShare, ...(weakest ? { weakestShare: weakest.share } : {}) }
      title = `Interesse «${w.de}»: heute ${pct(share)} des Vermögens mit ESG-Score ab ${floor}`
      detail = allMeet
        ? `Alle Wertschriften erreichen den Mindestscore, der Rest (${pct(cashShare)}) ist Liquidität: bereits erfüllt.`
        : `Schwächste Position: ${weakest!.name} (Score ${score(weakest!.security!.esgScore)}, ${pct(weakest!.share)}).`
    } else if (measure === 'sector' && w.wish.sector) {
      const sector = w.wish.sector
      const e = clientExposure(client, 'Industry', ctx.ref)
      const ofEquity = e.ofBase.get(sector) ?? 0, ofWealth = e.ofWealth.get(sector) ?? 0
      options = recommended.filter((s) => sectorShare(s, sector, ctx.ref) >= SECTOR_FUND).sort(byEsg)
      numbers = { equityShare: ofEquity, share: ofWealth, equityWeight: e.base }
      title = `Interesse «${w.de}»: heute ${pct(ofEquity)} des Aktienteils in ${categoryDe(sector)} (${pct(ofWealth)} des Vermögens)`
      detail = 'Aktienteil mit Fonds-Durchsicht.'
    } else if (measure === 'currency-diversification') {
      const e = clientExposure(client, 'CurrencyGroup', ctx.ref)
      const home = currencyGroupOf(client.currency)
      const homeShare = e.ofWealth.get(home) ?? 0
      const groups = [...e.ofWealth].filter(([, v]) => v >= CURRENCY_MENTION).sort((a, b) => b[1] - a[1])
      options = recommended.filter((s) => s.assetClass !== 'Liquidity' && (s.currencyGroup ?? currencyGroupOf(s.currency)) !== home).sort(byEsg)
      numbers = { homeShare, groups: groups.length }
      title = `Interesse «${w.de}»: heute ${pct(homeShare)} in ${categoryDe(home)}, ${groups.length} Währungsgruppen ab 5%`
      detail = `Verteilung mit Fonds-Durchsicht: ${groups.map(([k, v]) => `${categoryDe(k)} ${pct(v)}`).join(', ')}.`
    } else {
      const why = measure === 'dividend' ? 'Die Daten enthalten keine Dividendenrenditen' : 'Dafür gibt es in den Daten kein Mass'
      out.push({ ...base, title: `Interesse «${w.de}»: in den Daten nicht messbar`, detail: `${why}: nachfragen, was gemeint ist.${aiHint(w)}`, evidence: notes })
      continue
    }

    const picked = distinct(options).slice(0, OPTIONS)
    const optionsText = fit.maxPrc === undefined
      ? ' Kein Risikoprofil hinterlegt: keine Vorschläge.'
      : picked.length ? ` Optionen aus der Empfehlungsliste (${rules}): ${picked.map(optionText).join('; ')}.` : ` Keine passende Option in der Empfehlungsliste (${rules}).`
    const evidence: Evidence[] = [...notes, ...picked.map((s) => ({ source: 'Empfehlungsliste', ref: String(s.id), quote: fundName(s.name) }))]
    if (fit.maxPrc !== undefined) evidence.push(SRC.riskProfile(`${client.riskProfileName ?? 'Risikoprofil'}: Risikoklasse bis ${fit.maxPrc}`))
    out.push({ ...base, title, detail: `${detail}${optionsText}${aiHint(w)}`, numbers: { ...numbers, options: picked.length }, evidence })
  }
  return out
}
