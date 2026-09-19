// Null-safe reading of clients.json / reference.json, the reference index, and exposures with fund look-through.
// Pure: no clock, no I/O. Every check reads the data through here, never the raw JSON.
//
// Traps handled here (see CLAUDE.md "Data traps"):
// - null and absent both happen, so every collection goes through list()
// - join on SecurityId, never ISIN; unknown securities fall back to the position's own fields
// - SAA comparisons use the SAA_* fields; fund look-through uses a finer taxonomy, mapped below
// - region and sector targets are shares of the equity part, not of the whole portfolio.
//   Verified: CASE-037-02 gives North America 23.9%, Rest of Europe 11.8%, Asia/Pacific 0.7% of equities with
//   look-through, the exact LeftValues in the bank's own violations.

export type Raw = Record<string, unknown>
export const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
export const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isObj) : [])
export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
export const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
export const bool = (v: unknown): boolean => v === true

export const UNCLASSIFIED = 'Not classified'

// ── reference.json ───────────────────────────────────────────────────────────

export type Security = {
  id: number; isin?: string; name: string; type?: string; currency?: string
  assetClass?: string; currencyGroup?: string; countryGroup?: string; industry?: string // SAA_* taxonomy
  maturity?: string; esgScore?: number; prc?: number; recommended: boolean; lookThrough: boolean
  assetClassDetail?: string // the finer AssetClassName, e.g. 'Equities EmMa' (not for SAA comparisons)
}

export type Dimension = 'AssetClass' | 'CurrencyGroup' | 'CountryGroup' | 'Industry'
export type Band = { dimension: Dimension; category: string; min?: number; target?: number; max?: number }
export type Saa = { id: number; name?: string; bands: Band[] }
export type RiskProfile = { id: number; name?: string; level?: number; maxVola?: number; maxPrc?: number; equityQuote?: number }
export type Strategy = { id: number; name?: string; level?: number; volaMin?: number; volaMax?: number }
export type EsgProfile = { id: number; name?: string; minLevel?: number; minPositionLevel?: number }
export type Rule = { code: string; description?: string; level?: number }

export type ReferenceIndex = {
  security(id: number | undefined): Security | undefined
  // Fund breakdown as fractions summing to 1, in SAA category names. Undefined when the fund has none.
  lookThrough(fundId: number, dimension: Exclude<Dimension, 'AssetClass'>): Map<string, number> | undefined
  saa(id: number | undefined): Saa | undefined
  riskProfile(id: number | undefined): RiskProfile | undefined
  strategy(id: number | undefined): Strategy | undefined
  esgProfile(id: number | undefined): EsgProfile | undefined
  rule(code: string | undefined): Rule | undefined
  recommended(): Security[] // the bank's recommendation list (RecommendationLists + InRecommendationList), by id
}

// Look-through rows use their own names. Map them onto the SAA categories.
const LT_COUNTRY: Record<string, string> = {
  'Equities Switzerland': 'Switzerland', 'Equities Euroland': 'Rest of Europe', 'Aktien UK': 'Great Britain',
  'Equities North America': 'North America', 'Equities Japan': 'Japan', 'Equities Pacific': 'Asia/Pacific (ex Japan)', 'Equities EmMa': 'Others',
}
const LT_INDUSTRY: Record<string, string> = { 'Raw materials': 'Materials', 'Communication Services': 'Telecommunication Services' }
const SAA_CURRENCIES: Record<string, string> = { 'Swiss francs': 'Swiss francs', 'US-Dollar': 'US-Dollar', Euro: 'Euro' }
const ISO_TO_GROUP: Record<string, string> = { CHF: 'Swiss francs', USD: 'US-Dollar', EUR: 'Euro' }

export const currencyGroupOf = (iso: string | undefined) => (iso && ISO_TO_GROUP[iso]) || 'Andere'
const ltCategory = (dimension: Exclude<Dimension, 'AssetClass'>, name: string) =>
  dimension === 'CountryGroup' ? LT_COUNTRY[name] ?? 'Others'
    : dimension === 'Industry' ? LT_INDUSTRY[name] ?? name
      : SAA_CURRENCIES[name] ?? 'Andere'

const LT_FIELD = { CurrencyGroup: 'CurrencyGroupName', CountryGroup: 'CountryGroupName', Industry: 'IndustryName' } as const
const DIMENSIONS = new Set<string>(['AssetClass', 'CurrencyGroup', 'CountryGroup', 'Industry'])

export function indexReference(reference: unknown): ReferenceIndex {
  const r: Raw = isObj(reference) ? reference : {}
  const byId = <T>(rows: Raw[], make: (row: Raw, id: number) => T) => {
    const m = new Map<number, T>()
    for (const row of rows) { const id = num(row.Id); if (id !== undefined) m.set(id, make(row, id)) }
    return m
  }

  const recommended = new Set<number>()
  for (const l of list(r.RecommendationLists)) for (const s of list(l.Securities)) { const id = num(s.SecurityId); if (id !== undefined) recommended.add(id) }

  const securities = byId(list(r.Securities), (s, id): Security => ({
    id, isin: str(s.Isin), name: str(s.Name) ?? str(s.Isin) ?? `#${id}`, type: str(s.SecurityTypeName), currency: str(s.Currency),
    assetClass: str(s.SAA_AssetClassName), currencyGroup: str(s.SAA_CurrencyGroupName), countryGroup: str(s.SAA_CountryGroupName), industry: str(s.SAA_IndustryName),
    maturity: str(s.MaturityDateUtc), esgScore: num(s.SustainabilityScore), prc: num(s.PRC),
    recommended: bool(s.InRecommendationList) || recommended.has(id), lookThrough: bool(s.IsUnbundlingEnabled),
    assetClassDetail: str(s.AssetClassName),
  }))
  const recommendedList = [...securities.values()].filter((s) => s.recommended).sort((a, b) => a.id - b.id)

  // Rows are a full cross product (asset class × currency × country × industry): sum by one field per dimension.
  const lt = new Map<number, Record<string, Map<string, number>>>()
  for (const row of list(r.FundUnbundlingMappings)) {
    const fund = num(row.FundSecurityId), weight = num(row.Weight)
    if (fund === undefined || weight === undefined) continue
    const entry = lt.get(fund) ?? {}
    for (const dim of ['CurrencyGroup', 'CountryGroup', 'Industry'] as const) {
      const name = str(row[LT_FIELD[dim]])
      if (!name) continue
      const m = entry[dim] ?? (entry[dim] = new Map())
      const cat = ltCategory(dim, name)
      m.set(cat, (m.get(cat) ?? 0) + weight)
    }
    lt.set(fund, entry)
  }
  for (const entry of lt.values()) for (const m of Object.values(entry)) {
    const total = [...m.values()].reduce((a, b) => a + b, 0)
    if (total > 0) for (const [k, v] of m) m.set(k, v / total)
  }

  const saas = byId(list(r.StrategicAssetAllocations), (s, id): Saa => ({
    id, name: str(s.Name),
    bands: list(s.Mappings).filter((m) => DIMENSIONS.has(String(m.Dimension)) && str(m.Category)).map((m) => ({
      dimension: m.Dimension as Dimension, category: str(m.Category)!, min: num(m.MinPercentage), target: num(m.TargetPercentage), max: num(m.MaxPercentage),
    })),
  }))
  const risk = byId(list(r.RiskProfiles), (p, id): RiskProfile => ({ id, name: str(p.Name), level: num(p.RiskLevel), maxVola: num(p.MaxVola), maxPrc: num(p.MaxPRC), equityQuote: num(p.EquityQuoteInPercent) }))
  const strategies = byId(list(r.Strategies), (s, id): Strategy => ({ id, name: str(s.Name), level: num(s.RiskLevel), volaMin: num(s.VolatilityMinimum), volaMax: num(s.VolatilityMaximum) }))
  const esg = byId(list(r.EsgProfiles), (e, id): EsgProfile => ({ id, name: str(e.Name), minLevel: num(e.MinimumLevel), minPositionLevel: num(e.MinimumPositionLevel) }))
  const rules = new Map<string, Rule>()
  for (const x of list(r.SuitabilityRules)) { const code = str(x.RuleCode); if (code) rules.set(code, { code, description: str(x.Description), level: num(x.Level) }) }

  const get = <T>(m: Map<number, T>) => (id: number | undefined) => (id === undefined ? undefined : m.get(id))
  return {
    security: get(securities),
    lookThrough: (fundId, dimension) => lt.get(fundId)?.[dimension],
    saa: get(saas), riskProfile: get(risk), strategy: get(strategies), esgProfile: get(esg),
    rule: (code) => (code ? rules.get(code) : undefined),
    recommended: () => recommendedList,
  }
}

// ── clients.json ─────────────────────────────────────────────────────────────

export type Position = {
  kind: 'security' | 'account'
  securityId?: number; isin?: string; name: string; currency?: string
  amount: number // in portfolio currency
  weight: number // fraction of the portfolio, 0–1
  riskContribution?: number // ContributionVolatility: sums to the portfolio volatility
  security?: Security // undefined for accounts and for securities reference.json does not know
}

export type NavPoint = { date: string; value: number } // date = yyyy-MM-dd

export type Portfolio = {
  id?: number; nr: string; name?: string; currency?: string
  service?: string; strategyId?: number; strategyName?: string; saaId?: number
  value: number; liquidity?: number // in the client's reporting currency
  volatility?: number; expectedReturn?: number; valueAtRisk?: number; riskDate?: string
  positions: Position[] // securities and accounts
  history: NavPoint[] // ascending
  isExCustody: boolean
}

export type Proposal = {
  id?: number; portfolioId?: number; status?: string; type?: string; reason?: string
  proposed?: string; finalized?: string; submitted?: string
  securities: { isin?: string; name: string; weight?: number; amount?: number }[]
}

export type Violation = {
  id?: number; rule: string; description?: string; severity: 'Error' | 'Warning'; portfolioId?: number
  date?: string; isin?: string; path: { field: string; left?: number; right?: number; op?: number }[]
}

export type Note = { text: string; date?: string }

export type Client = {
  ref: string; isCompany: boolean; clientType?: string; currency: string
  riskProfileId?: number; riskProfileName?: string; esgProfileId?: number; esgProfileName?: string
  birthday?: string; profilingDate?: string
  aum: number; liquidity?: number
  portfolios: Portfolio[]; proposals: Proposal[]; violations: Violation[]
  overrides: { code: string; description?: string }[]; tags: { name: string; type?: string }[]; notes: Note[]
}

const day = (v: unknown) => str(v)?.slice(0, 10)

function readPosition(p: Raw, kind: Position['kind'], ref: ReferenceIndex): Position {
  const securityId = num(p.SecurityId)
  const security = kind === 'security' ? ref.security(securityId) : undefined
  return {
    kind, securityId, isin: str(p.Isin), currency: str(p.Currency),
    // Account names can carry IBAN-like text: accounts are named by currency only.
    name: kind === 'account' ? `Konto ${str(p.Currency) ?? ''}`.trim() : str(p.SecurityName) ?? security?.name ?? str(p.Isin) ?? 'Position ohne Namen',
    amount: num(p.TotalAmountInPortfolioCurrency) ?? 0,
    weight: num(p.PortfolioValuePercentage) ?? 0,
    riskContribution: num(p.ContributionVolatility),
    security,
  }
}

export function readClient(input: unknown, ref: ReferenceIndex): Client {
  const c: Raw = isObj(input) ? input : {}
  const portfolios = list(c.Portfolios).map((p, i): Portfolio => ({
    id: num(p.PortfolioId), nr: str(p.PortfolioNr) ?? `${str(c.ClientRef) ?? 'Portfolio'}-${i + 1}`, name: str(p.Name), currency: str(p.PortfolioCurrency),
    service: str(p.InvestmentServiceName), strategyId: num(p.StrategyId), strategyName: str(p.StrategyName), saaId: num(p.StrategicAssetAllocationId),
    value: num(p.AssetsUnderManagementInDefaultCurrency) ?? 0, liquidity: num(p.LiquidityInDefaultCurrency),
    volatility: num(p.Volatility), expectedReturn: num(p.ExpectedReturn), valueAtRisk: num(p.ValueAtRisk), riskDate: day(p.FactoryDateUtc),
    positions: [
      ...list(p.SecurityPositions).map((x) => readPosition(x, 'security', ref)),
      ...list(p.AccountPositions).map((x) => readPosition(x, 'account', ref)),
    ],
    history: list(p.PerformanceHistory)
      .map((h) => ({ date: day(h.Date) ?? '', value: num(h.Value) ?? 0 }))
      .filter((h) => h.date && h.value > 0)
      .sort((a, b) => a.date.localeCompare(b.date)),
    isExCustody: bool(p.isExCustody),
  }))
  const portfolioTotal = portfolios.reduce((a, p) => a + p.value, 0)
  return {
    ref: str(c.ClientRef) ?? 'unbekannt',
    isCompany: bool(c.IsClientACompany), clientType: str(c.RegulatoryClientTypeName), currency: str(c.ReportingCurrency) ?? 'CHF',
    riskProfileId: num(c.RiskProfileId), riskProfileName: str(c.RiskProfileName), esgProfileId: num(c.EsgProfileId), esgProfileName: str(c.EsgProfileName),
    birthday: day(c.Birthday), profilingDate: day(c.ProfilingDateUtc),
    aum: num(c.AssetsUnderManagementInDefaultCurrency) ?? portfolioTotal, liquidity: num(c.LiquidityInDefaultCurrency),
    portfolios,
    proposals: list(c.Proposals).map((p) => ({
      id: num(p.ProposalId), portfolioId: num(p.PortfolioId), status: str(p.ProposalStatusName), type: str(p.AdvisoryTypeName), reason: str(p.Reason),
      proposed: day(p.ProposedDateUTC), finalized: day(p.FinalizedDateUTC), submitted: day(p.TransactionsSubmittedDateUTC),
      securities: list(p.SecurityPositions).map((s) => ({ isin: str(s.Isin), name: str(s.SecurityName) ?? str(s.Isin) ?? 'Position', weight: num(s.ProposalValuePercentage), amount: num(s.TotalAmountInProposalCurrency) })),
    })),
    violations: list(c.SuitabilityViolations).map((v) => ({
      id: num(v.Id), rule: str(v.RuleCode) ?? 'Unbekannte Regel', description: str(v.RuleDescription),
      severity: v.Severity === 'Warning' || num(v.ErrorLevel) === 1 ? 'Warning' : 'Error',
      portfolioId: num(v.PortfolioId), date: day(v.LastViolatedDateUTC), isin: str(v.SecurityIsin),
      path: list(v.ViolationPath).map((x) => ({ field: str(x.FieldName) ?? '', left: num(x.LeftValue), right: num(x.RightValue), op: num(x.Operator) })),
    })),
    overrides: list(c.IndividualRuleOverrides).map((o) => ({ code: str(o.RuleCode) ?? '', description: str(o.RuleDescription) })).filter((o) => o.code),
    tags: list(c.Tags).map((t) => ({ name: str(t.TagName) ?? '', type: str(t.TagTypeName) })).filter((t) => t.name),
    notes: list(c.ClientNotes).map((n) => ({ text: str(n.Note) ?? '', date: day(n.CreatedByDateUTC) })).filter((n) => n.text),
  }
}

// ── exposures ────────────────────────────────────────────────────────────────

export type Exposure = {
  dimension: Dimension
  base: 'portfolio' | 'equity' // region and sector are measured within the equity part, like the bank's rules
  baseWeight: number // weight of the base in the portfolio (1 for 'portfolio')
  shares: Map<string, number> // category → fraction of the base
  contributors: Map<string, { name: string; securityId?: number; share: number; viaFund: boolean }[]> // share = fraction of the base
  lookThroughShare: number // fraction of the base that was opened up via fund look-through
  opaqueFundShare: number // fraction of the base in funds without a breakdown (counted by the fund's own label)
}

const isFund = (p: Position) => /fund|etf/i.test(p.security?.type ?? '')

function directCategory(p: Position, dimension: Dimension): string {
  const s = p.security
  if (p.kind === 'account') return dimension === 'AssetClass' ? 'Liquidity' : dimension === 'CurrencyGroup' ? currencyGroupOf(p.currency) : UNCLASSIFIED
  if (!s) return dimension === 'CurrencyGroup' ? currencyGroupOf(p.currency) : UNCLASSIFIED
  const v = dimension === 'AssetClass' ? s.assetClass : dimension === 'CurrencyGroup' ? s.currencyGroup ?? currencyGroupOf(p.currency) : dimension === 'CountryGroup' ? s.countryGroup : s.industry
  return v ?? UNCLASSIFIED
}

export function exposure(portfolio: Portfolio, dimension: Dimension, ref: ReferenceIndex): Exposure {
  const base: Exposure['base'] = dimension === 'CountryGroup' || dimension === 'Industry' ? 'equity' : 'portfolio'
  const members = base === 'equity' ? portfolio.positions.filter((p) => p.security?.assetClass === 'Shares') : portfolio.positions
  const baseWeight = base === 'equity' ? members.reduce((a, p) => a + p.weight, 0) : 1
  const shares = new Map<string, number>()
  const contributors: Exposure['contributors'] = new Map()
  let lookThrough = 0, opaque = 0
  const add = (cat: string, w: number, p: Position, viaFund: boolean) => {
    if (baseWeight <= 0 || w === 0) return
    const share = w / baseWeight
    shares.set(cat, (shares.get(cat) ?? 0) + share)
    const list = contributors.get(cat) ?? []
    list.push({ name: p.name, securityId: p.securityId, share, viaFund })
    contributors.set(cat, list)
  }
  for (const p of members) {
    const split = dimension !== 'AssetClass' && p.securityId !== undefined && p.security?.lookThrough ? ref.lookThrough(p.securityId, dimension) : undefined
    if (split) {
      lookThrough += p.weight
      for (const [cat, f] of split) add(cat, p.weight * f, p, true)
    } else {
      if (dimension !== 'AssetClass' && isFund(p)) opaque += p.weight
      add(directCategory(p, dimension), p.weight, p, false)
    }
  }
  for (const l of contributors.values()) l.sort((a, b) => b.share - a.share)
  return {
    dimension, base, baseWeight, shares, contributors,
    lookThroughShare: baseWeight > 0 ? lookThrough / baseWeight : 0,
    opaqueFundShare: baseWeight > 0 ? opaque / baseWeight : 0,
  }
}

// ── value history ────────────────────────────────────────────────────────────

// Sum of the portfolios' month values, on the dates every portfolio reports.
export function combinedHistory(portfolios: Portfolio[]): NavPoint[] {
  const withHistory = portfolios.filter((p) => p.history.length)
  if (!withHistory.length) return []
  const sum = new Map<string, { value: number; n: number }>()
  for (const p of withHistory) for (const h of p.history) {
    const hit = sum.get(h.date) ?? { value: 0, n: 0 }
    sum.set(h.date, { value: hit.value + h.value, n: hit.n + 1 })
  }
  return [...sum].filter(([, v]) => v.n === withHistory.length).map(([date, v]) => ({ date, value: v.value })).sort((a, b) => a.date.localeCompare(b.date))
}

export const ageInYears = (birthday: string | undefined, now: Date) => {
  if (!birthday) return undefined
  const b = new Date(birthday)
  if (Number.isNaN(b.getTime())) return undefined
  let age = now.getUTCFullYear() - b.getUTCFullYear()
  if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) age--
  return age
}

export const daysBetween = (from: string | Date, to: string | Date) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)
