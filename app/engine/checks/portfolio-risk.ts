// portfolio.risk — portfolio volatility against the client's risk profile and the portfolio's strategy band,
// and single positions whose Product Risk Class (PRC, 1–7) is above what the profile allows.
// All limits come from reference.json (RiskProfiles.MaxVola / MaxPRC, Strategies.VolatilityMinimum / Maximum); none are ours.
import { type Portfolio, type Strategy } from '../data.ts'
import { pct, pts, shortName } from '../format.ts'
import { pick, sourceName } from '../lang.ts'
import type { Check, Finding } from '../types.ts'
import { clientOf, findingId, srcOf } from './common.ts'

const CHECK = 'portfolio.risk'
// The bank's advisory rules do not apply to execution-only mandates: the client decides alone, the bank checks nothing.
const EXECUTION_ONLY = 'Execution only'
// How many position names a PRC finding lists in its title before it says "und n weitere".
const TOP_NAMES = 3

// 'No strategy' carries 0..1, which is no band at all.
const realBand = (s: Strategy | undefined): s is Strategy & { volaMin: number; volaMax: number } =>
  !!s && s.volaMin !== undefined && s.volaMax !== undefined && !(s.volaMin <= 0 && s.volaMax >= 1)

export const risk: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const t = pick(ctx.lang)
  const SRC = srcOf(ctx.lang)
  const profile = ctx.ref.riskProfile(client.riskProfileId)
  const profileName = profile?.name ?? client.riskProfileName
  const out: Finding[] = []

  for (const p of client.portfolios) {
    // Volatility 0 appears on portfolios without a risk calculation (CASE-001, CASE-046): treat it as missing.
    const vola = p.volatility
    if (vola === undefined || vola <= 0) continue
    const executionOnly = p.service === EXECUTION_ONLY
    const id = (subject: string) => findingId(CHECK, client.ref, `${p.nr}:${subject}`)
    const base = { check: CHECK, topic: 'risk' } as const
    const before = out.length

    const maxVola = profile?.maxVola
    if (maxVola !== undefined && vola > maxVola) {
      const excess = vola - maxVola
      out.push({
        ...base, id: id('profile'),
        kind: executionOnly ? 'interpretation' : 'fact',
        severity: executionOnly ? 'info' : 'risk',
        title: `${p.nr}: ${t(`Volatilität ${pct(vola)} über dem Risikoprofil`, `volatility ${pct(vola)} above the risk profile`)} (max. ${pct(maxVola)})${executionOnly ? ', Execution only' : ''}`,
        detail: executionOnly
          ? t(
            `Execution-only-Mandat: Die Beratungsregeln gelten hier nicht, die Bank prüft das Risiko nicht. Überschreitung ${pct(excess)}.`,
            `Execution-only mandate: the advisory rules do not apply here and the bank does not check the risk. Exceeded by ${pct(excess)}.`,
          )
          : t(
            `Überschreitung um ${pts(excess)} gegenüber dem Risikoprofil${profileName ? ` ${profileName}` : ''}.`,
            `${pts(excess, 'en')} above the risk profile${profileName ? ` ${profileName}` : ''}.`,
          ),
        numbers: { volatility: vola, maxVola, excess },
        evidence: [SRC.portfolio(p.nr), SRC.riskProfile(profileName)],
      })
    }

    const strategy = ctx.ref.strategy(p.strategyId)
    if (realBand(strategy) && (vola < strategy.volaMin || vola > strategy.volaMax)) {
      const below = vola < strategy.volaMin
      const strategyName = strategy.name ?? p.strategyName
      out.push({
        ...base, id: id('band'), kind: 'fact',
        severity: below ? 'warn' : 'risk',
        title: below
          ? `${p.nr}: ${t('Risiko unter Strategieband, Volatilität', 'risk below the strategy band, volatility')} ${pct(vola)} (min. ${pct(strategy.volaMin)})`
          : `${p.nr}: ${t('Risiko über Strategieband, Volatilität', 'risk above the strategy band, volatility')} ${pct(vola)} (max. ${pct(strategy.volaMax)})`,
        detail: t(
          `Strategie ${strategyName ?? 'unbekannt'}: Band ${pct(strategy.volaMin)} bis ${pct(strategy.volaMax)}.`,
          `Strategy ${strategyName ?? 'unknown'}: band ${pct(strategy.volaMin)} to ${pct(strategy.volaMax)}.`,
        ),
        numbers: { volatility: vola, volaMin: strategy.volaMin, volaMax: strategy.volaMax },
        evidence: [SRC.portfolio(p.nr), { source: sourceName('strategy', ctx.lang), quote: strategyName }],
      })
    }

    const maxPrc = profile?.maxPrc
    if (!executionOnly && maxPrc !== undefined) {
      const over = overPrc(p, maxPrc)
      if (over.length) {
        const names = over.slice(0, TOP_NAMES).map((x) => shortName(x.name)).join(', ')
        const more = over.length > TOP_NAMES ? t(` und ${over.length - TOP_NAMES} weitere`, ` and ${over.length - TOP_NAMES} more`) : ''
        const weight = over.reduce((a, x) => a + x.weight, 0)
        out.push({
          ...base, id: id('prc'), kind: 'fact', severity: 'warn',
          title: t(
            `${p.nr}: ${over.length === 1 ? '1 Position' : `${over.length} Positionen`} über Produktrisikoklasse ${maxPrc} des Profils: ${names}${more}`,
            `${p.nr}: ${over.length === 1 ? '1 position' : `${over.length} positions`} above the profile's product risk class ${maxPrc}: ${names}${more}`,
          ),
          detail: t(
            `Zusammen ${pct(weight)} des Portfolios. Produktrisikoklasse (1–7) aus den Wertschriften-Stammdaten.`,
            `Together ${pct(weight)} of the portfolio. Product risk class (1–7) from the security master data.`,
          ),
          numbers: { count: over.length, maxPrc, weight },
          evidence: [SRC.riskProfile(profileName), ...over.slice(0, TOP_NAMES).map((x) => SRC.position(x.name, p.nr))],
        })
      }
    }

    if (out.length === before) {
      out.push({
        ...base, id: id('ok'), kind: 'fact',
        severity: maxVola !== undefined ? 'ok' : 'info',
        title: maxVola !== undefined
          ? t(`${p.nr}: Volatilität ${pct(vola)}, innerhalb Profil (max. ${pct(maxVola)})`, `${p.nr}: volatility ${pct(vola)}, within the profile (max. ${pct(maxVola)})`)
          : t(`${p.nr}: Volatilität ${pct(vola)}, kein Maximum im Risikoprofil hinterlegt`, `${p.nr}: volatility ${pct(vola)}, no maximum on file in the risk profile`),
        numbers: maxVola !== undefined ? { volatility: vola, maxVola } : { volatility: vola },
        evidence: [SRC.portfolio(p.nr), SRC.riskProfile(profileName)],
      })
    }
  }
  return out
}

const overPrc = (p: Portfolio, maxPrc: number) =>
  p.positions.filter((x) => x.kind === 'security' && x.security?.prc !== undefined && x.security.prc > maxPrc).sort((a, b) => b.weight - a.weight)
