// portfolio.violations — the bank's own suitability violations, one finding each, plus the client's rule overrides.
// Operator codes in ViolationPath are undocumented: we show the actual value and the bank's thresholds, never which one was crossed.
import type { Violation } from '../data.ts'
import { categoryDe, pct, shortName } from '../format.ts'
import { pick, sourceName, type Lang } from '../lang.ts'
import type { Check, Finding } from '../types.ts'
import { ruleText } from '../../src/data/ruleText.ts'
import { clientOf, findingId, srcOf } from './common.ts'

const CHECK = 'portfolio.violations'
const TOPIC = 'violations'
// Path fields that carry a portfolio share or a volatility (seen in clients.json: "...PortfolioValueRuleField", "SimulationVolatilityRuleField").
const VALUE_FIELD = /PortfolioValue|Volatility/
// Title for violations whose PortfolioId is not among the client's portfolios (27 in clients.json).
// The bank's violation list also names portfolios that are not part of the client file (27 cases in the data).
const UNKNOWN_PORTFOLIO = 'Portfolio nicht in der Datei', UNKNOWN_PORTFOLIO_EN = 'Portfolio not in this file'
const NO_PATH = 'Details der Regelprüfung fehlen in den Daten.', NO_PATH_EN = 'The details of the rule run are missing from the data.'

// Override rule codes are not in ruleText; the two seen in clients.json are translated here.
// ruleText leaves category names it does not know in English («Rest of Europe»): finish them with the SAA translation.
const OVERRIDE_DE: Record<string, string> = { 'No structured products': 'Keine strukturierten Produkte', 'Sustainable investments only': 'Nur nachhaltige Anlagen' }
// The English run shows the bank's own rule text, tidied: «…» around the category, no full stop at the end.
// A rule text the German side does not know either may be in any language (one code in clients.json is German):
// it is shown as a quote from the data, never translated.
const known = (rule: string) => rule in OVERRIDE_DE || ruleText(rule) !== rule
const ruleDe = (rule: string, lang?: Lang) => (lang === 'en'
  ? known(rule) ? rule.replace(/"([^"]+)"/g, '«$1»').replace(/\.$/, '') : `«${rule}»`
  : OVERRIDE_DE[rule] ?? ruleText(rule).replace(/«([^»]+)»/g, (_, name: string) => `«${categoryDe(name)}»`))
// Override descriptions in clients.json are German sentences, a finite set (2 values); unknown ones are quoted as data.
const OVERRIDE_DETAIL_EN: Record<string, string> = {
  'Eine Regelverletzung wird angezeigt, wenn Positionen, die nicht auf der Empfehlungsliste Nachhaltigkeit sind, im Portfolio enthalten sind.': 'A rule violation is shown when the portfolio holds positions that are not on the sustainability recommendation list.',
  'Eine Regelverletzung wird angezeigt, wenn das Portfolio Strukturierte Produkte enthält.': 'A rule violation is shown when the portfolio holds structured products.',
}

// Filter steps look like {left: 1, right: 0} (both whole numbers); value checks carry a fraction on at least one side.
// Whole-number values stay allowed against a fractional threshold: all-cash portfolios report 0% shares and 100% liquidity.
export function decodePath(path: Violation['path']): { actual: number; thresholds: number[] } | undefined {
  const cand = path.filter((x) => VALUE_FIELD.test(x.field) && x.left !== undefined && x.right !== undefined && x.left !== x.right
    && (!Number.isInteger(x.left) || !Number.isInteger(x.right) || /Volatility/.test(x.field)))
  if (!cand.length) return undefined
  return { actual: cand[0].left!, thresholds: [...new Set(cand.map((x) => x.right!))] }
}

// One plain sentence per rule family: what the figure measures and where the bank draws the line.
// Several thresholds (one per strategy level) are listed, never narrowed down to the one that applies.
export function explain(rule: string, actual: number, thresholds: number[], lang?: Lang): string {
  const t = pick(lang)
  const a = pct(actual)
  const l = thresholds.map((x) => pct(x)).join(' / ')
  const many = thresholds.length > 1
  if (/maximum volatility|range exceeded/i.test(rule)) return t(`Das Portfolio schwankt mit ${a} pro Jahr stärker, als das Risikoprofil des Kunden erlaubt (höchstens ${l}).`, `At ${a} a year the portfolio swings more than the client's risk profile allows (at most ${l}).`)
  if (/range undershot/i.test(rule)) return t(`Das Portfolio schwankt mit ${a} pro Jahr weniger, als die Anlagestrategie vorsieht (mindestens ${l}). Es wird weniger Risiko eingegangen, als der Kunde gewählt hat.`, `At ${a} a year the portfolio swings less than the investment strategy intends (at least ${l}). It takes less risk than the client chose.`)
  const min = /^Minimum limit (shares|fixed income)/i.exec(rule)
  if (min) {
    const shares = min[1].toLowerCase() === 'shares'
    return t(`${shares ? 'Aktien' : 'Obligationen'} machen ${a} des Portfolios aus, die Strategie verlangt einen Mindestanteil (${many ? 'Schwellen je Strategiestufe' : 'Schwelle'}: ${l}).`, `${shares ? 'Shares' : 'Bonds'} make up ${a} of the portfolio, the strategy requires a minimum share (${many ? 'thresholds per strategy level' : 'threshold'}: ${l}).`)
  }
  if (/^Maximum limit liquidity/i.test(rule)) return t(`${a} des Portfolios liegen als Liquidität auf dem Konto, die Strategie erlaubt höchstens ${l}. Dieser Teil ist nicht angelegt.`, `${a} of the portfolio sits in cash, the strategy allows at most ${l}. This part is not invested.`)
  if (/^Cluster risk of a single/i.test(rule)) return t(`Eine einzelne Position macht ${a} des Portfolios aus, die Bank erlaubt pro Titel höchstens ${l}.`, `A single position makes up ${a} of the portfolio, the bank allows at most ${l} per security.`)
  if (/^Foreign currency/i.test(rule)) return t(`Fremdwährungen machen ${a} des Portfolios aus, die Schwelle der Bank liegt bei ${l}.`, `Foreign currencies make up ${a} of the portfolio, the bank's threshold is ${l}.`)
  if (/weight in the equity/i.test(rule)) return t(`Der Anteil liegt bei ${a} der Aktien, ${many ? 'die Schwellen der Bank liegen bei' : 'die Schwelle der Bank liegt bei'} ${l}.`, `The share is ${a} of the equities, the bank's threshold${many ? 's are' : ' is'} ${l}.`)
  return t(`Ist ${a}, Schwelle${many ? 'n' : ''} der Bank: ${l}`, `Actual ${a}, the bank's threshold${many ? 's' : ''}: ${l}`)
}

export const violations: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const t = pick(ctx.lang)
  const SRC = srcOf(ctx.lang)
  const out: Finding[] = []
  client.violations.forEach((v, i) => {
    const portfolio = client.portfolios.find((p) => p.id !== undefined && p.id === v.portfolioId)
    const nr = portfolio?.nr ?? t(UNKNOWN_PORTFOLIO, UNKNOWN_PORTFOLIO_EN)
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
    let detail = t(NO_PATH, NO_PATH_EN)
    if (decoded) {
      numbers.actual = decoded.actual
      decoded.thresholds.forEach((x, k) => { numbers[`threshold${k + 1}`] = x })
      detail = explain(v.rule, decoded.actual, decoded.thresholds, ctx.lang)
      // The bank's check can rest on another calculation than today's risk figure (CASE-001: flagged at 11.9%, portfolio shows 0.0%).
      const today = portfolio?.volatility
      if (/Volatility/i.test(v.rule) && today !== undefined && Math.abs(today - decoded.actual) >= 0.005) {
        numbers.portfolioVolatility = today
        detail += t(` Achtung: Das Portfolio weist heute eine Volatilität von ${pct(today)} aus, die Meldung rechnet mit ${pct(decoded.actual)}.`, ` Note: the portfolio shows a volatility of ${pct(today)} today, the violation is based on ${pct(decoded.actual)}.`)
      }
    }
    const title = `${nr}: ${ruleDe(v.rule, ctx.lang)}${position ? ` (${position})` : ''}${decoded ? `: ${pct(decoded.actual)}` : ''}`
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
      title: t(`Regel «${ruleDe(o.code)}» ist für diesen Kunden ausgeschaltet`, `Rule «${o.code}» is switched off for this client`),
      detail: t(o.description, o.description && (OVERRIDE_DETAIL_EN[o.description] ?? `«${o.description}»`)),
      evidence: [{ source: sourceName('ruleException', ctx.lang), quote: o.code }],
    })
  }
  return out
}
