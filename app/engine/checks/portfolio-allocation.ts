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
import { exposure, UNCLASSIFIED, type Band, type Client, type Dimension, type Exposure, type Portfolio, type ReferenceIndex } from '../data.ts'
import { categoryName, pct, pts, shortName } from '../format.ts'
import { pick, sourceName, type Lang } from '../lang.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { clientOf, findingId, srcOf } from './common.ts'

const CHECK = 'portfolio.allocation'
const WEIGHT_WARN = 0.05 // bank rule: over/underweight at ±5 points from the SAA target
const WEIGHT_RISK = 0.1 // bank rule: significant over/underweight at ±10 points
const OPAQUE_NOTE = 0.1 // mention funds without a breakdown when they hold ≥ 10% of the base

// From this share of unclassified securities on, shares are reported as lower bounds. Our judgement.
const UNCLASSIFIED_MENTION = 0.05
const UNCLASSIFIED_WARN = 0.2
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

// Accounts are named 'Konto <currency>' when the file is read (data.ts), before any language is known.
const shownName = (name: string, lang?: Lang) => (lang === 'en' ? shortName(name).replace(/^Konto(?= |$)/, 'Account') : shortName(name))

function contributorsText(e: Exposure, category: string, lang?: Lang) {
  const top = (e.contributors.get(category) ?? []).slice(0, 3)
  return top.map((c) => `${shownName(c.name, lang)} ${pct(c.share * e.baseWeight)}${c.viaFund ? pick(lang)(' (über Fonds)', ' (via funds)') : ''}`).join(', ')
}

export const allocation: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const t = pick(ctx.lang)
  const SRC = srcOf(ctx.lang)
  const cat = (x: string) => categoryName(x, ctx.lang)
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
      ? t(` ${pct(equity.opaqueFundShare)} des Aktienteils liegen in Fonds ohne Aufschlüsselung und zählen nach dem Fondslabel.`, ` ${pct(equity.opaqueFundShare)} of the equity part sits in funds without a breakdown and counts by the fund's label.`) : ''
    out.push({
      id: id('mix'), check: CHECK, kind: 'fact', severity: 'info', topic: 'allocation',
      title: `${p.nr}: ${mix(ac).slice(0, 3).map(([k, v]) => `${cat(k)} ${pct(v)}`).join(', ')}`,
      detail: `${t('Währungen', 'Currencies')}: ${mix(cur).map(([k, v]) => `${cat(k)} ${pct(v)}`).join(', ')}.${equity.baseWeight > 0 ? t(` Aktienfonds mit Durchsicht: ${pct(equity.lookThroughShare)} des Aktienteils.`, ` Equity funds with look-through: ${pct(equity.lookThroughShare)} of the equity part.`) : ''}${opaque}`,
      numbers: { ...numbers, lookThroughShare: equity.lookThroughShare, opaqueFundShare: equity.opaqueFundShare },
      evidence: [SRC.portfolio(p.nr), saaEvidence],
    })

    if (!bands.length) {
      out.push({
        id: id('no-target'), check: CHECK, kind: 'interpretation', severity: 'info', topic: 'allocation',
        title: t(`${p.nr}: keine Zielallokation hinterlegt, Abweichungen werden nicht geprüft`, `${p.nr}: no target allocation on file, deviations are not checked`),
        detail: t(
          `Strategie «${p.strategyName ?? 'keine'}», Dienstleistung «${p.service ?? 'unbekannt'}»: alle Bandbreiten 0–100%.`,
          `Strategy «${p.strategyName ?? 'none'}», service «${p.service ?? 'unknown'}»: all bands 0–100%.`,
        ),
        evidence: [saaEvidence],
      })
      continue
    }

    // Asset classes: hard bands. One finding per portfolio: an all-cash portfolio breaks three bands at once,
    // and that is one fact for the advisor, not three.
    // Securities the reference data does not know (an uploaded client file) have no asset class, region or sector.
    // A measured share is then a lower bound: "above the maximum" still holds, "below the minimum" only if
    // the unknown part could not close the gap. We say so instead of asserting it.
    const unknown = ac.shares.get(UNCLASSIFIED) ?? 0
    const unsure = unknown >= UNCLASSIFIED_MENTION
    if (unsure) {
      out.push({
        id: id('unclassified'), check: CHECK, kind: 'fact', severity: unknown >= UNCLASSIFIED_WARN ? 'warn' : 'info', topic: 'allocation',
        title: t(
          `${p.nr}: ${pct(unknown)} des Portfolios nicht klassifizierbar, der Vergleich mit der Strategie ist unvollständig`,
          `${p.nr}: ${pct(unknown)} of the portfolio cannot be classified, the comparison with the strategy is incomplete`,
        ),
        detail: [
          contributorsText(ac, UNCLASSIFIED, ctx.lang) ? `${t('Grösste', 'Largest')}: ${contributorsText(ac, UNCLASSIFIED, ctx.lang)}.` : '',
          t('Diese Titel fehlen in den Stammdaten der Bank: Anlageklasse, Region und Sektor sind unbekannt. Anteile sind deshalb Mindestwerte, und Ausschlusswünsche lassen sich für diese Titel nicht prüfen.',
            "These securities are not in the bank's reference data: asset class, region and sector are unknown. Shares are therefore minimum values, and exclusion wishes cannot be checked for these securities."),
        ].filter(Boolean).join(' '),
        numbers: { unclassified: unknown },
        evidence: [SRC.portfolio(p.nr)],
      })
    }

    const measured = bands.filter((x) => x.dimension === 'AssetClass').map((b) => {
      const actual = ac.shares.get(b.category) ?? 0
      const below = b.min !== undefined && actual < b.min, above = b.max !== undefined && actual > b.max
      const limit = below ? b.min! : above ? b.max! : undefined
      return { b, actual, below, limit, gap: limit === undefined ? 0 : actual - limit }
    }).filter((x) => x.limit !== undefined).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    const open = measured.filter((x) => x.below && x.actual + unknown >= x.limit!)
    const breaches = measured.filter((x) => !open.includes(x))
    if (open.length) {
      const [first] = open
      out.push({
        id: id('AssetClass:uncertain'), check: CHECK, kind: 'interpretation', severity: 'info', topic: 'allocation',
        title: t(
          `${p.nr}: ${open.map((x) => `${cat(x.b.category)} ${pct(x.actual)} (Minimum ${pct(x.limit!)})`).join(', ')}: mit den Daten nicht zu beurteilen`,
          `${p.nr}: ${open.map((x) => `${cat(x.b.category)} ${pct(x.actual)} (minimum ${pct(x.limit!)})`).join(', ')}: cannot be judged from the data`,
        ),
        detail: t(
          `Gemessen unter dem Minimum, aber ${pct(unknown)} des Portfolios sind nicht klassifizierbar und könnten die Lücke schliessen. Titel gemeinsam durchgehen, nicht als Verletzung ansprechen.`,
          `Measured below the minimum, but ${pct(unknown)} of the portfolio cannot be classified and could close the gap. Go through the securities together; do not raise it as a breach.`,
        ),
        numbers: { actual: first.actual, limit: first.limit!, unclassified: unknown },
        evidence: [saaEvidence, SRC.portfolio(p.nr)],
      })
    }
    if (breaches.length) {
      const text = (x: (typeof breaches)[number]) => t(
        `${cat(x.b.category)} ${pct(x.actual)}, ${x.below ? 'unter dem Minimum' : 'über dem Maximum'} von ${pct(x.limit!)}`,
        `${cat(x.b.category)} ${pct(x.actual)}, ${x.below ? 'below the minimum' : 'above the maximum'} of ${pct(x.limit!)}`,
      )
      const [first] = breaches
      const numbers: Record<string, number> = { actual: first.actual, limit: first.limit!, gap: first.gap }
      for (const x of breaches) Object.assign(numbers, { [`${x.b.category}.actual`]: x.actual, [`${x.b.category}.min`]: x.b.min ?? 0, [`${x.b.category}.max`]: x.b.max ?? 1, [`${x.b.category}.target`]: x.b.target ?? 0 })
      out.push({
        id: id('AssetClass'), check: CHECK, kind: 'fact', severity: 'risk', topic: 'allocation',
        title: `${p.nr}: ${text(first)}`,
        detail: [
          breaches.length > 1 ? `${t('Ebenfalls ausserhalb', 'Also outside')}: ${breaches.slice(1).map(text).join('; ')}.` : '',
          `Band ${cat(first.b.category)} ${pct(first.b.min ?? 0)}–${pct(first.b.max ?? 1)}, ${t('Ziel', 'target')} ${pct(first.b.target ?? 0)}.`,
          contributorsText(ac, first.b.category, ctx.lang) ? `${t('Grösste Beiträge', 'Largest contributions')}: ${contributorsText(ac, first.b.category, ctx.lang)}.` : '',
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
          id: id(`${dim}:${b.category}`), check: CHECK, kind: 'fact', severity: strong && !unsure ? 'risk' : 'warn', topic: 'allocation',
          title: t(
            `${p.nr}: ${strong ? 'deutliches ' : ''}${deviation > 0 ? 'Übergewicht' : 'Untergewicht'} ${kind === 'sector' ? 'Sektor' : 'Region'} ${cat(b.category)}: ${pct(actual)} statt ${pct(b.target!)} (${pts(deviation)})`,
            `${p.nr}: ${strong ? 'significant ' : ''}${deviation > 0 ? 'overweight' : 'underweight'} in the equity ${kind} ${cat(b.category)}: ${pct(actual)} instead of ${pct(b.target!)} (${pts(deviation, 'en')})`,
          ),
          detail: [
            t(`Anteil am Aktienteil (${pct(e.baseWeight)} des Portfolios), Fonds durchgeschaut.`, `Share of the equity part (${pct(e.baseWeight)} of the portfolio), with fund look-through.`),
            deviation > 0 ? `${t('Grösste Beiträge', 'Largest contributions')}: ${contributorsText(e, b.category, ctx.lang)}.` : '',
            bank ? t('Die letzte Regelprüfung der Bank meldet dies ebenfalls.', "The bank's last rule run reports this as well.") : '',
            unsure ? t(`${pct(unknown)} des Portfolios sind nicht klassifizierbar und fehlen in dieser Messung.`, `${pct(unknown)} of the portfolio cannot be classified and is missing from this measure.`) : '',
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
        title: t(
          `${p.nr}: ${cat(category)}-Anteil ${pct(actual)}, Grenze der Bank ${pct(limit)} (${pts(actual - limit)})`,
          `${p.nr}: ${cat(category)} share ${pct(actual)}, the bank's limit is ${pct(limit)} (${pts(actual - limit, 'en')})`,
        ),
        detail: t(
          `Regel «${code}». Grösste Beiträge: ${contributorsText(cur, category)}.${bank ? ' Die letzte Regelprüfung der Bank meldet dies ebenfalls.' : ''}`,
          `Rule «${code}». Largest contributions: ${contributorsText(cur, category, 'en')}.${bank ? " The bank's last rule run reports this as well." : ''}`,
        ),
        numbers: { actual, limit, gap: actual - limit, target: bands.find((b) => b.dimension === 'CurrencyGroup' && b.category === category)?.target ?? 0, bankFlagged: bank ? 1 : 0 },
        evidence: [{ source: sourceName('rule', ctx.lang), quote: ctx.ref.rule(code)?.description ?? code }, SRC.portfolio(p.nr)],
      })
    }
    const foreign = 1 - (cur.shares.get('Swiss francs') ?? 0)
    const foreignRule = ctx.ref.rule('Foreign currency exposure exceeds 50%')
    if (foreignRule && foreign > 0.5) {
      out.push({
        id: id('CurrencyGroup:foreign'), check: CHECK, kind: 'fact', severity: 'warn', topic: 'allocation',
        title: t(`${p.nr}: Fremdwährungsanteil ${pct(foreign)}, über der Grenze von 50%`, `${p.nr}: foreign-currency share ${pct(foreign)}, above the limit of 50%`),
        numbers: { actual: foreign, limit: 0.5, gap: foreign - 0.5 },
        evidence: [{ source: sourceName('rule', ctx.lang), quote: foreignRule.description ?? foreignRule.code }, SRC.portfolio(p.nr)],
      })
    }
  }
  return out
}
