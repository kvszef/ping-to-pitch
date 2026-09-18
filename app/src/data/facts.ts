// Deterministic key figures from one raw client record. Pure: no clock, no network. Everything the
// conversation workspace says about a real client starts here, so the model only phrases numbers
// that this file computed. Account names and IBANs are never read.

export type ClientFacts = {
  asOf?: string
  performance?: {
    month: number; ytd: number; sinceStart: number; startLabel: string
    worst: { label: string; value: number }
    series: { label: string; value: number }[] // last 13 month-ends, indexed to 100
    note: string
  }
  risk?: { volatility: number; expectedReturn: number; valueAtRisk: number }
  positions: { name: string; share: number; currency: string; riskShare?: number }[]
  positionCount: number
  currencies: { label: string; share: number }[]
  liquidityShare?: number
  proposals: { total: number; accepted: number; rejected: number; draft: number; last?: { date: string; status: string; reason: string } }
  tags: string[]
}

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isObj) : [])
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,}(?:[ ]?[A-Z0-9]{1,3})?\b/g
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(IBAN, '[entfernt]').trim() : '')
const round = (v: number) => Math.round(v * 10) / 10
const pct = (v: number) => round(v * 100)

const MONTHS = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.']
const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`.trim()
const dayLabel = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

// Security names in the file lead with the share class ("Namen-Aktie Swiss Life Holding AG").
// Fund names repeat the issuer before a dash ("iShares IV PLC - iShares Edge MSCI World Value"): keep the part after it.
const shortName = (name: string) => name.replace(/^[^-]{3,40}\s-\s(?=\S)/, '').replace(/^(Namen-Aktien?|Inhaber-Aktien?|Aktien?|Anteile|Partizipationsscheine?|Genussscheine?)\s+(-[^-]+-\s+)?/i, '').slice(0, 48).trim() || name

// Total value per month-end, summed over the portfolios. Only dates every portfolio reports.
function navSeries(portfolios: Raw[]): { date: string; value: number }[] {
  const histories = portfolios.map((p) => list(p.PerformanceHistory).filter((h) => str(h.Date) && num(h.Value) > 0)).filter((h) => h.length)
  if (!histories.length) return []
  const sum = new Map<string, { value: number; n: number }>()
  for (const h of histories) for (const point of h) {
    const date = str(point.Date).slice(0, 10)
    const hit = sum.get(date) ?? { value: 0, n: 0 }
    sum.set(date, { value: hit.value + num(point.Value), n: hit.n + 1 })
  }
  return [...sum.entries()].filter(([, v]) => v.n === histories.length).map(([date, v]) => ({ date, value: v.value })).sort((a, b) => a.date.localeCompare(b.date))
}

function performance(portfolios: Raw[]): ClientFacts['performance'] {
  const nav = navSeries(portfolios)
  if (nav.length < 2) return undefined
  const last = nav[nav.length - 1]
  const year = last.date.slice(0, 4)
  const base = nav.find((p) => p.date.startsWith(year)) ?? nav[0]
  let worst = { label: '', value: 0 }
  for (let i = 1; i < nav.length; i++) {
    const change = nav[i].value / nav[i - 1].value - 1
    if (change < worst.value) worst = { label: monthLabel(nav[i - 1].date), value: change }
  }
  const tail = nav.slice(-13)
  return {
    month: pct(last.value / nav[nav.length - 2].value - 1),
    ytd: pct(last.value / base.value - 1),
    sinceStart: pct(last.value / nav[0].value - 1),
    startLabel: monthLabel(nav[0].date),
    worst: { label: worst.label, value: pct(worst.value) },
    series: tail.map((p) => ({ label: monthLabel(p.date), value: round((p.value / tail[0].value) * 100) })),
    note: 'Wertveränderung aus Monatsendwerten, nicht um Ein- und Auszahlungen bereinigt.',
  }
}

export function factsFromRaw(input: unknown): ClientFacts {
  const raw: Raw = isObj(input) ? input : {}
  const portfolios = list(raw.Portfolios)
  const total = portfolios.reduce((n, p) => n + num(p.AssetsUnderManagementInDefaultCurrency), 0)
  const weightOf = (p: Raw) => (total > 0 ? num(p.AssetsUnderManagementInDefaultCurrency) / total : portfolios.length === 1 ? 1 : 0)

  const positions: ClientFacts['positions'] = []
  const currencies = new Map<string, number>()
  for (const p of portfolios) {
    const weight = weightOf(p)
    const volatility = num(p.Volatility)
    for (const s of list(p.SecurityPositions)) {
      const share = num(s.PortfolioValuePercentage) * weight
      const currency = str(s.Currency) || 'unbekannt'
      currencies.set(currency, (currencies.get(currency) ?? 0) + share)
      positions.push({
        name: shortName(str(s.SecurityName) || str(s.Isin) || 'Position ohne Namen'), share: pct(share), currency,
        riskShare: portfolios.length === 1 && volatility > 0 && num(s.ContributionVolatility) > 0 ? pct(num(s.ContributionVolatility) / volatility) : undefined,
      })
    }
    for (const a of list(p.AccountPositions)) {
      const currency = str(a.Currency) || 'unbekannt'
      currencies.set(currency, (currencies.get(currency) ?? 0) + num(a.PortfolioValuePercentage) * weight)
    }
  }
  positions.sort((a, b) => b.share - a.share)

  const main = [...portfolios].sort((a, b) => num(b.AssetsUnderManagementInDefaultCurrency) - num(a.AssetsUnderManagementInDefaultCurrency))[0]
  const proposals = list(raw.Proposals)
  const status = (p: Raw) => str(p.ProposalStatusName)
  const lastProposal = proposals.filter((p) => str(p.ProposedDateUTC)).sort((a, b) => str(a.ProposedDateUTC).localeCompare(str(b.ProposedDateUTC))).pop()
  const nav = navSeries(portfolios)
  const aum = num(raw.AssetsUnderManagementInDefaultCurrency) || total

  return {
    asOf: nav.length ? dayLabel(nav[nav.length - 1].date) : undefined,
    performance: performance(portfolios),
    risk: main && num(main.Volatility) > 0 ? { volatility: pct(num(main.Volatility)), expectedReturn: pct(num(main.ExpectedReturn)), valueAtRisk: pct(num(main.ValueAtRisk)) } : undefined,
    positions: positions.slice(0, 5),
    positionCount: positions.length,
    currencies: [...currencies.entries()].map(([label, share]) => ({ label, share: pct(share) })).filter((c) => c.share >= 0.5).sort((a, b) => b.share - a.share).slice(0, 6),
    liquidityShare: aum > 0 ? pct(num(raw.LiquidityInDefaultCurrency) / aum) : undefined,
    proposals: {
      total: proposals.length,
      accepted: proposals.filter((p) => status(p) === 'Final').length,
      rejected: proposals.filter((p) => status(p) === 'Abgelehnt').length,
      draft: proposals.filter((p) => status(p) === 'Entwurf').length,
      last: lastProposal ? { date: dayLabel(str(lastProposal.ProposedDateUTC).slice(0, 10)), status: status(lastProposal) || 'ohne Status', reason: str(lastProposal.Reason) } : undefined,
    },
    tags: list(raw.Tags).map((t) => str(t.TagName)).filter(Boolean).slice(0, 8),
  }
}
