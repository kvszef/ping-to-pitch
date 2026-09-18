// portfolio.violations — the bank's own suitability violations, one finding each, plus the client's rule overrides.
// Operator codes in ViolationPath are undocumented: we show the actual value and the bank's thresholds, never which one was crossed.
import type { Violation } from '../data.ts'
import { categoryDe, pct, shortName } from '../format.ts'
import type { Check, Finding } from '../types.ts'
import { ruleText } from '../../src/data/ruleText.ts'
import { clientOf, findingId, SRC } from './common.ts'

const CHECK = 'portfolio.violations'
const TOPIC = 'violations'
// Path fields that carry a portfolio share or a volatility (seen in clients.json: "...PortfolioValueRuleField", "SimulationVolatilityRuleField").
const VALUE_FIELD = /PortfolioValue|Volatility/
// Title for violations whose PortfolioId is not among the client's portfolios (27 in clients.json).
const UNKNOWN_PORTFOLIO = 'Portfolio unbekannt'
const NO_PATH = 'Details der Regelprüfung fehlen in den Daten.'

// Override rule codes are not in ruleText; the two seen in clients.json are translated here.
// ruleText leaves category names it does not know in English («Rest of Europe»): finish them with the SAA translation.
const OVERRIDE_DE: Record<string, string> = { 'No structured products': 'Keine strukturierten Produkte', 'Sustainable investments only': 'Nur nachhaltige Anlagen' }
const ruleDe = (rule: string) => OVERRIDE_DE[rule] ?? ruleText(rule).replace(/«([^»]+)»/g, (_, name: string) => `«${categoryDe(name)}»`)

// Filter steps look like {left: 1, right: 0} (both whole numbers); value checks carry a fraction on at least one side.
// Whole-number values stay allowed against a fractional threshold: all-cash portfolios report 0% shares and 100% liquidity.
export function decodePath(path: Violation['path']): { actual: number; thresholds: number[] } | undefined {
  const cand = path.filter((x) => VALUE_FIELD.test(x.field) && x.left !== undefined && x.right !== undefined && x.left !== x.right
    && (!Number.isInteger(x.left) || !Number.isInteger(x.right) || /Volatility/.test(x.field)))
  if (!cand.length) return undefined
  return { actual: cand[0].left!, thresholds: [...new Set(cand.map((x) => x.right!))] }
}

export const violations: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const out: Finding[] = []
  client.violations.forEach((v, i) => {
    const portfolio = client.portfolios.find((p) => p.id !== undefined && p.id === v.portfolioId)
    const nr = portfolio?.nr ?? UNKNOWN_PORTFOLIO
    let position: string | undefined, positionNr: string | undefined
    if (v.isin) {
      const holders = portfolio ? [portfolio, ...client.portfolios.filter((p) => p !== portfolio)] : client.portfolios
      for (const p of holders) {
        const hit = p.positions.find((x) => x.isin === v.isin || x.security?.isin === v.isin)
        if (hit) { position = shortName(hit.name); positionNr = p.nr; break }
      }
      position ??= v.isin
    }
    const decoded = decodePath(v.path)
    const numbers: Record<string, number> = {}
    let detail = NO_PATH
    if (decoded) {
      numbers.actual = decoded.actual
      decoded.thresholds.forEach((t, k) => { numbers[`threshold${k + 1}`] = t })
      detail = `Ist ${pct(decoded.actual)}, Schwelle${decoded.thresholds.length > 1 ? 'n' : ''} der Bank: ${decoded.thresholds.map((t) => pct(t)).join(' / ')}`
    }
    const title = `${nr}: ${ruleDe(v.rule)}${position ? ` (${position})` : ''}${decoded ? `: ${pct(decoded.actual)}` : ''}`
    out.push({
      id: findingId(CHECK, client.ref, v.id !== undefined ? String(v.id) : `${v.rule}:${v.portfolioId ?? 'x'}:${v.isin ?? i}`),
      check: CHECK, kind: 'fact', severity: v.severity === 'Error' ? 'risk' : 'warn', topic: TOPIC,
      title, detail, numbers: decoded ? numbers : undefined,
      evidence: [
        SRC.violation(v.rule, v.date),
        ...(portfolio ? [SRC.portfolio(portfolio.nr)] : []),
        ...(position && positionNr ? [SRC.position(position, positionNr)] : []),
      ],
    })
  })
  for (const o of client.overrides) {
    out.push({
      id: findingId(CHECK, client.ref, `override:${o.code}`),
      check: CHECK, kind: 'fact', severity: 'info', topic: TOPIC,
      title: `Regel «${ruleDe(o.code)}» ist für diesen Kunden ausgeschaltet`,
      detail: o.description,
      evidence: [{ source: 'Individuelle Regelausnahme', quote: o.code }],
    })
  }
  return out
}
