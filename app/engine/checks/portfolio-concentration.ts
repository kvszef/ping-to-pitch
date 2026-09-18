// portfolio.concentration — largest positions, positions that carry far more risk than weight,
// the bank's own single-instrument cluster-risk verdicts, and a large foreign-currency share.
// We do not set a single-position limit: the bank's rule says the limit varies by instrument type, so we use its verdict.
import { categoryDe, pct, shortName } from '../format.ts'
import { exposure, type Position, type Violation } from '../data.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { SRC, clientOf, findingId } from './common.ts'

const CHECK = 'portfolio.concentration'
const CLUSTER_RULE = 'Cluster risk of a single financial instrument'
const TOP_N = 3 // largest positions named in the overview fact
// Risk share at least twice the weight: the position is a clearly outsized risk driver. Our judgement, stated as interpretation.
const RISK_TO_WEIGHT = 2
// And at least 15% of the portfolio's total risk, so small positions with a high ratio do not flood the briefing. Our judgement.
const MIN_RISK_SHARE = 0.15
// Contributions must add up to the volatility within this tolerance to be usable (CASE-041 carries amounts, not volatility).
const CONTRIBUTION_TOLERANCE = 0.25
// A foreign-currency share of 20% or more is worth mentioning to the client. Our judgement, info only.
const CURRENCY_MENTION = 0.2
const HOME_CURRENCY = 'Swiss francs'

export const concentration: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const out: Finding[] = []
  const clusterViolations = client.violations.filter((v) => v.rule === CLUSTER_RULE && v.isin)

  for (const p of client.portfolios) {
    const id = (subject: string) => findingId(CHECK, client.ref, `${p.nr}:${subject}`)
    const base = { check: CHECK, topic: 'concentration' } as const
    const securities = p.positions.filter((x) => x.kind === 'security' && x.weight > 0).sort((a, b) => b.weight - a.weight)

    if (securities.length) {
      const top = securities.slice(0, TOP_N)
      const combined = top.reduce((a, x) => a + x.weight, 0)
      const numbers: Record<string, number> = { combined }
      top.forEach((x, i) => { numbers[`top${i + 1}`] = x.weight })
      out.push({
        ...base, id: id('top'), kind: 'fact', severity: 'info',
        title: `${p.nr}: Grösste Positionen ${top.map((x) => `${shortName(x.name)} ${pct(x.weight)}`).join(', ')}, zusammen ${pct(combined)}`,
        numbers,
        evidence: top.map((x) => SRC.position(x.name, p.nr)),
      })
    }

    // Risk share per position, only when the contributions really add up to the portfolio volatility.
    const vola = p.volatility ?? 0
    const rcSum = p.positions.reduce((a, x) => a + (x.riskContribution ?? 0), 0)
    const usable = vola > 0 && Math.abs(rcSum - vola) <= CONTRIBUTION_TOLERANCE * vola
    const riskShare = (x: Position) => (usable && x.riskContribution !== undefined ? x.riskContribution / vola : undefined)

    const seen = new Set<string>()
    for (const x of securities) {
      const share = riskShare(x)
      const outsized = share !== undefined && share >= RISK_TO_WEIGHT * x.weight && share >= MIN_RISK_SHARE
      const hits = x.isin ? clusterViolations.filter((v) => v.isin === x.isin && (v.portfolioId === undefined || p.id === undefined || v.portfolioId === p.id)) : []
      if (!outsized && !hits.length) continue
      const subject = `position:${x.securityId ?? x.isin ?? x.name}`
      if (seen.has(subject)) continue
      seen.add(subject)

      const name = shortName(x.name)
      const numbers: Record<string, number> = { weight: x.weight }
      if (share !== undefined) numbers.riskShare = share
      const evidence: Evidence[] = [SRC.position(x.name, p.nr), ...hits.map((v: Violation) => SRC.violation(v.rule, v.date))]
      if (outsized && share !== undefined) {
        out.push({
          ...base, id: id(subject), kind: 'interpretation',
          severity: hits.length ? 'risk' : 'warn',
          title: `${p.nr}: ${name} macht ${pct(x.weight)} des Werts, aber ${pct(share, 0)} des Risikos aus`,
          detail: `Risikobeitrag aus der Volatilitätszerlegung der Bank (Portfolio-Volatilität ${pct(vola)}).${hits.length ? ' Die Bank meldet zudem ein Klumpenrisiko in diesem Titel.' : ''}`,
          numbers, evidence,
        })
      } else {
        out.push({
          ...base, id: id(subject), kind: 'fact', severity: 'risk',
          title: `${p.nr}: Klumpenrisiko ${name}, ${pct(x.weight)} des Portfolios`,
          detail: `Von der Bank als Klumpenrisiko eines Einzeltitels gemeldet. Die Grenze hängt von der Art des Instruments ab.${share !== undefined ? ` Anteil am Risiko: ${pct(share)}.` : ''}`,
          numbers, evidence,
        })
      }
    }

    // Currency share with fund look-through. Everything outside CHF counts; the largest one is named.
    const currencies = exposure(p, 'CurrencyGroup', ctx.ref).shares
    const foreign = [...currencies].filter(([cat]) => cat !== HOME_CURRENCY).sort((a, b) => b[1] - a[1])[0]
    if (foreign && foreign[1] >= CURRENCY_MENTION) {
      out.push({
        ...base, id: id('currency'), kind: 'fact', severity: 'info',
        title: `${p.nr}: ${pct(foreign[1])} in ${categoryDe(foreign[0])}`,
        detail: 'Währungsanteil mit Durchschau auf Fonds, wo die Bank eine Aufschlüsselung liefert.',
        numbers: { share: foreign[1] },
        evidence: [SRC.portfolio(p.nr)],
      })
    }
  }
  return out
}
