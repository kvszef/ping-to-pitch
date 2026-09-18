// portfolio.allocation — actual mix against the portfolio's target allocation (SAA), with fund look-through.
//
// What the data gives us (verified on reference.json):
// - Asset classes have real bands (min / target / max). Outside the band is a mandate breach.
// - Regions and sectors only have a target, measured within the equity part. The bank's own rules flag
//   ±5 points from target as over/underweight and ±10 points as significant (SuitabilityRules descriptions:
//   "Übergewicht (+/- 5% zum SAA-Sollwert der Benchmark)", "Starkes Übergewicht (+/- 10% ...)").
// - Currencies only have a target. The bank's limits live in rule texts ("USD Anteil < 35.5%", "EUR Anteil < 9%",
//   "Fremdwährungsanteil ... grösser als 50%"), so they are read from there, never hard-coded.
// - "No strategy" portfolios have 0–100% bands and no targets: nothing to compare against, and we say so.
import { exposure, type Band, type Client, type Dimension, type Exposure, type Portfolio, type ReferenceIndex } from '../data.ts'
import { categoryDe, pct, pts, shortName } from '../format.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { clientOf, findingId, SRC } from './common.ts'

const CHECK = 'portfolio.allocation'
const WEIGHT_WARN = 0.05 // bank rule: over/underweight at ±5 points from the SAA target
const WEIGHT_RISK = 0.1 // bank rule: significant over/underweight at ±10 points
const OPAQUE_NOTE = 0.1 // mention funds without a breakdown when they hold ≥ 10% of the base

const isTrivial = (b: Band) => (b.min ?? 0) <= 0 && (b.max ?? 1) >= 1 && !b.target

function ruleLimit(ref: ReferenceIndex, code: string): number | undefined {
  const m = /<\s*([\d.]+)\s*%/.exec(ref.rule(code)?.description ?? '')
  return m ? Number(m[1]) / 100 : undefined
}

// Rule texts and SAA targets name one sector differently.
const RULE_NAME: Record<string, string> = { 'Telecommunication Services': 'Communication Services' }

// The bank's own violation for the same category, so the briefing can show one statement, not two.
// The violation list is a snapshot of the bank's last rule run: positions moved since, so both can disagree
// (verified: 83 region/sector findings agree, 25 are only ours, 7 only the bank's). We compute from today's positions.
function bankViolation(client: Client, p: Portfolio, category: string, kind: 'sector' | 'region' | 'currency') {
  const name = RULE_NAME[category] ?? category
  return client.violations.find((v) => v.portfolioId === p.id && (
    kind === 'currency' ? v.rule.includes(`risk ${name}`) : v.rule.includes(`equity ${kind} "${name}"`)))
}

function contributorsText(e: Exposure, category: string) {
  const top = (e.contributors.get(category) ?? []).slice(0, 3)
  return top.map((c) => `${shortName(c.name)} ${pct(c.share * e.baseWeight)}${c.viaFund ? ' (über Fonds)' : ''}`).join(', ')
}

export const allocation: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const out: Finding[] = []

  for (const p of client.portfolios) {
    const saa = ctx.ref.saa(p.saaId)
    const saaEvidence = SRC.saa(saa?.name)
    const bands = (saa?.bands ?? []).filter((b) => !isTrivial(b))
    const id = (subject: string) => findingId(CHECK, client.ref, `${p.nr}:${subject}`)
    const exposures = Object.fromEntries((['AssetClass', 'CurrencyGroup', 'CountryGroup', 'Industry'] as Dimension[]).map((d) => [d, exposure(p, d, ctx.ref)])) as Record<Dimension, Exposure>
    if (!p.positions.length) continue

    // The mix itself, for the allocation chart and the briefing's situation block.
    const ac = exposures.AssetClass, cur = exposures.CurrencyGroup
    const mix = (e: Exposure) => [...e.shares].filter(([, v]) => v >= 0.005).sort((a, b) => b[1] - a[1])
    const numbers: Record<string, number> = {}
    for (const [k, v] of ac.shares) numbers[`AssetClass.${k}`] = v
    for (const [k, v] of cur.shares) numbers[`CurrencyGroup.${k}`] = v
    const equity = exposures.CountryGroup
    const opaque = equity.baseWeight > 0 && equity.opaqueFundShare >= OPAQUE_NOTE
      ? ` ${pct(equity.opaqueFundShare)} des Aktienteils liegen in Fonds ohne Aufschlüsselung und zählen nach dem Fondslabel.` : ''
    out.push({
      id: id('mix'), check: CHECK, kind: 'fact', severity: 'info', topic: 'allocation',
      title: `${p.nr}: ${mix(ac).slice(0, 3).map(([k, v]) => `${categoryDe(k)} ${pct(v)}`).join(', ')}`,
      detail: `Währungen: ${mix(cur).map(([k, v]) => `${categoryDe(k)} ${pct(v)}`).join(', ')}.${equity.baseWeight > 0 ? ` Aktienfonds mit Durchsicht: ${pct(equity.lookThroughShare)} des Aktienteils.` : ''}${opaque}`,
      numbers: { ...numbers, lookThroughShare: equity.lookThroughShare, opaqueFundShare: equity.opaqueFundShare },
      evidence: [SRC.portfolio(p.nr), saaEvidence],
    })

    if (!bands.length) {
      out.push({
        id: id('no-target'), check: CHECK, kind: 'interpretation', severity: 'info', topic: 'allocation',
        title: `${p.nr}: keine Zielallokation hinterlegt, Abweichungen werden nicht geprüft`,
        detail: `Strategie «${p.strategyName ?? 'keine'}», Dienstleistung «${p.service ?? 'unbekannt'}»: alle Bandbreiten 0–100%.`,
        evidence: [saaEvidence],
      })
      continue
    }

    // Asset classes: hard bands. One finding per portfolio: an all-cash portfolio breaks three bands at once,
    // and that is one fact for the advisor, not three.
    const breaches = bands.filter((x) => x.dimension === 'AssetClass').map((b) => {
      const actual = ac.shares.get(b.category) ?? 0
      const below = b.min !== undefined && actual < b.min, above = b.max !== undefined && actual > b.max
      const limit = below ? b.min! : above ? b.max! : undefined
      return { b, actual, below, limit, gap: limit === undefined ? 0 : actual - limit }
    }).filter((x) => x.limit !== undefined).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    if (breaches.length) {
      const text = (x: (typeof breaches)[number]) => `${categoryDe(x.b.category)} ${pct(x.actual)}, ${x.below ? 'unter dem Minimum' : 'über dem Maximum'} von ${pct(x.limit!)}`
      const [first] = breaches
      const numbers: Record<string, number> = { actual: first.actual, limit: first.limit!, gap: first.gap }
      for (const x of breaches) Object.assign(numbers, { [`${x.b.category}.actual`]: x.actual, [`${x.b.category}.min`]: x.b.min ?? 0, [`${x.b.category}.max`]: x.b.max ?? 1, [`${x.b.category}.target`]: x.b.target ?? 0 })
      out.push({
        id: id('AssetClass'), check: CHECK, kind: 'fact', severity: 'risk', topic: 'allocation',
        title: `${p.nr}: ${text(first)}`,
        detail: [
          breaches.length > 1 ? `Ebenfalls ausserhalb: ${breaches.slice(1).map(text).join('; ')}.` : '',
          `Band ${categoryDe(first.b.category)} ${pct(first.b.min ?? 0)}–${pct(first.b.max ?? 1)}, Ziel ${pct(first.b.target ?? 0)}.`,
          contributorsText(ac, first.b.category) ? `Grösste Beiträge: ${contributorsText(ac, first.b.category)}.` : '',
        ].filter(Boolean).join(' '),
        numbers,
        evidence: [saaEvidence, SRC.portfolio(p.nr)],
      })
    }

    // Regions and sectors: target only, within equities.
    for (const dim of ['CountryGroup', 'Industry'] as const) {
      const e = exposures[dim]
      if (e.baseWeight <= 0) continue
      for (const b of bands.filter((x) => x.dimension === dim && x.target !== undefined)) {
        const actual = e.shares.get(b.category) ?? 0
        const deviation = actual - b.target!
        if (Math.abs(deviation) < WEIGHT_WARN) continue
        const strong = Math.abs(deviation) >= WEIGHT_RISK
        const kind = dim === 'Industry' ? 'sector' : 'region'
        const bank = bankViolation(client, p, b.category, kind)
        const evidence: Evidence[] = [saaEvidence, SRC.portfolio(p.nr)]
        if (bank) evidence.push(SRC.violation(bank.rule, bank.date))
        out.push({
          id: id(`${dim}:${b.category}`), check: CHECK, kind: 'fact', severity: strong ? 'risk' : 'warn', topic: 'allocation',
          title: `${p.nr}: ${strong ? 'deutliches ' : ''}${deviation > 0 ? 'Übergewicht' : 'Untergewicht'} ${kind === 'sector' ? 'Sektor' : 'Region'} ${categoryDe(b.category)}: ${pct(actual)} statt ${pct(b.target!)} (${pts(deviation)})`,
          detail: [
            `Anteil am Aktienteil (${pct(e.baseWeight)} des Portfolios), Fonds durchgeschaut.`,
            deviation > 0 ? `Grösste Beiträge: ${contributorsText(e, b.category)}.` : '',
            bank ? 'Die letzte Regelprüfung der Bank meldet dies ebenfalls.' : '',
          ].filter(Boolean).join(' '),
          numbers: { actual, target: b.target!, deviation, equityWeight: e.baseWeight, bankFlagged: bank ? 1 : 0 },
          evidence,
        })
      }
    }

    // Currencies: the bank's limits from its rule texts.
    const limits: [string, string, number | undefined][] = [
      ['US-Dollar', 'Foreign currency cluster risk USD', ruleLimit(ctx.ref, 'Foreign currency cluster risk USD')],
      ['Euro', 'Foreign currency cluster risk EUR', ruleLimit(ctx.ref, 'Foreign currency cluster risk EUR')],
    ]
    for (const [category, code, limit] of limits) {
      const actual = cur.shares.get(category) ?? 0
      if (limit === undefined || actual <= limit) continue
      const bank = bankViolation(client, p, category === 'US-Dollar' ? 'USD' : 'EUR', 'currency')
      out.push({
        id: id(`CurrencyGroup:${category}`), check: CHECK, kind: 'fact', severity: 'warn', topic: 'allocation',
        title: `${p.nr}: ${categoryDe(category)}-Anteil ${pct(actual)}, Grenze der Bank ${pct(limit)} (${pts(actual - limit)})`,
        detail: `Regel «${code}». Grösste Beiträge: ${contributorsText(cur, category)}.${bank ? ' Die letzte Regelprüfung der Bank meldet dies ebenfalls.' : ''}`,
        numbers: { actual, limit, gap: actual - limit, target: bands.find((b) => b.dimension === 'CurrencyGroup' && b.category === category)?.target ?? 0, bankFlagged: bank ? 1 : 0 },
        evidence: [{ source: 'Suitability-Regel', quote: ctx.ref.rule(code)?.description ?? code }, SRC.portfolio(p.nr)],
      })
    }
    const foreign = 1 - (cur.shares.get('Swiss francs') ?? 0)
    const foreignRule = ctx.ref.rule('Foreign currency exposure exceeds 50%')
    if (foreignRule && foreign > 0.5) {
      out.push({
        id: id('CurrencyGroup:foreign'), check: CHECK, kind: 'fact', severity: 'warn', topic: 'allocation',
        title: `${p.nr}: Fremdwährungsanteil ${pct(foreign)}, über der Grenze von 50%`,
        numbers: { actual: foreign, limit: 0.5, gap: foreign - 0.5 },
        evidence: [{ source: 'Suitability-Regel', quote: foreignRule.description ?? foreignRule.code }, SRC.portfolio(p.nr)],
      })
    }
  }
  return out
}
