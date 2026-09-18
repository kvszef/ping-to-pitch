import fs from 'node:fs'
import { config } from './config.ts'

// Nur die Felder, die der Agent tatsächlich nutzt. Alles optional: die Quelle lässt
// leere Felder weg (siehe core-case/portfolio-data/DATA.md).
export type Position = {
  SecurityId?: number; Isin?: string; SecurityName?: string; Quantity?: number; PricePerUnit?: number
  Currency?: string; TotalAmountInPortfolioCurrency?: number; PortfolioValuePercentage?: number
}
export type Account = { AccountName?: string; Currency?: string; TotalAmountInPortfolioCurrency?: number; PortfolioValuePercentage?: number }
export type Portfolio = {
  PortfolioId?: number; PortfolioNr?: string; Name?: string; PortfolioCurrency?: string
  StrategicAssetAllocationId?: number; InvestmentServiceName?: string; StrategyName?: string
  AssetsUnderManagementInDefaultCurrency?: number; LiquidityInDefaultCurrency?: number
  Volatility?: number; ExpectedReturn?: number; ValueAtRisk?: number; PerformanceYTD?: number; FactoryDateUtc?: string
  SecurityPositions?: Position[]; AccountPositions?: Account[]; PerformanceHistory?: { Date: string; Value: number }[]
}
export type Proposal = {
  ProposalId?: number; PortfolioId?: number; ProposalStatusName?: string; AdvisoryTypeName?: string
  ProposedDateUTC?: string; FinalizedDateUTC?: string; TransactionsSubmittedDateUTC?: string
  Reason?: string; Notes?: string; ExpectedReturn?: number; Volatility?: number; ValueAtRisk?: number
  SecurityPositions?: { SecurityName?: string }[]
}
export type Violation = {
  RuleCode?: string; RuleDescription?: string; Severity?: string; PortfolioId?: number
  LastViolatedDateUTC?: string; SecurityIsin?: string
}
export type Client = {
  ClientId?: number; ClientRef: string; FirstName?: string; LastName?: string; Company?: string
  IsClientACompany?: boolean; IsEmployee?: boolean; RegulatoryClientTypeName?: string; ReportingCurrency?: string
  RiskProfileId?: number; RiskProfileName?: string; EsgProfileName?: string; Birthday?: string; ProfilingDateUtc?: string
  AssetsUnderManagementInDefaultCurrency?: number; LiquidityInDefaultCurrency?: number
  Portfolios?: Portfolio[]; Proposals?: Proposal[]
  Transactions?: { SecurityName?: string; IsExpiry?: boolean }[]
  SuitabilityViolations?: Violation[]; IndividualRuleOverrides?: { RuleCode?: string; RuleDescription?: string }[]
  Tags?: { TagName?: string; TagTypeName?: string }[]; ClientNotes?: { Note?: string; CreatedByDateUTC?: string }[]
}
type Security = {
  Id: number; Name?: string; Isin?: string; AssetClassName?: string; SAA_AssetClassName?: string
  SustainabilityScore?: number; PRC?: number; InRecommendationList?: boolean
}
type Saa = {
  Id: number; Name?: string
  Mappings?: { Dimension: string; Category: string; MinPercentage?: number; TargetPercentage?: number; MaxPercentage?: number }[]
}
type RiskProfile = { Id: number; Name?: string; MaxVola?: number; MaxPRC?: number; EquityQuoteInPercent?: number }
type Reference = { Securities?: Security[]; StrategicAssetAllocations?: Saa[]; RiskProfiles?: RiskProfile[] }

export const clientName = (c: Client): string =>
  (c.IsClientACompany && c.Company ? c.Company : `${c.FirstName ?? ''} ${c.LastName ?? ''}`).replace(/\s+/g, ' ').trim() || c.ClientRef

const ASSET_DE: Record<string, string> = {
  Liquidity: 'Liquidität', Bonds: 'Obligationen', Shares: 'Aktien', 'Real estate': 'Immobilien',
  'Specialties andCommodities': 'Spezialitäten und Rohstoffe', 'Specialties and Commodities': 'Spezialitäten und Rohstoffe',
}
const de = (cat: string): string => ASSET_DE[cat] ?? cat
const pct = (f: number | undefined, digits = 1): string =>
  f == null || Number.isNaN(f) ? 'k. A.' : `${(f * 100).toFixed(digits).replace('.', ',')} %`
const money = (n: number | undefined, cur = 'CHF'): string =>
  n == null || Number.isNaN(n) ? 'k. A.' : `${cur} ${Math.round(n).toLocaleString('de-CH')}`
const day = (iso?: string): string => (iso ? iso.slice(0, 10) : 'k. A.')
const normalize = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const ageOf = (birthday?: string): number | undefined => {
  if (!birthday) return undefined
  const b = new Date(birthday)
  if (Number.isNaN(b.getTime())) return undefined
  const now = new Date()
  let a = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--
  return a
}

export class DataStore {
  clients: Client[] = []
  private securities = new Map<number, Security>()
  private byIsin = new Map<string, Security>()
  private saas = new Map<number, Saa>()
  private riskProfiles = new Map<number, RiskProfile>()
  private rosterText = ''

  load(): { clients: number; securities: number; ms: number } {
    const t0 = Date.now()
    this.clients = []
    for (const file of config.clientsJson) {
      if (!fs.existsSync(file)) throw new Error(`clients.json nicht gefunden: ${file} (CLIENTS_JSON in .env prüfen)`)
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Client[]
      if (!Array.isArray(parsed)) throw new Error(`${file}: erwartet ein Array von Kunden`)
      this.clients.push(...parsed.filter((c) => c && typeof c.ClientRef === 'string'))
    }
    this.clients.sort((a, b) => a.ClientRef.localeCompare(b.ClientRef))

    this.securities.clear(); this.byIsin.clear(); this.saas.clear(); this.riskProfiles.clear()
    if (fs.existsSync(config.referenceJson)) {
      const ref = JSON.parse(fs.readFileSync(config.referenceJson, 'utf8')) as Reference
      for (const s of ref.Securities ?? []) { this.securities.set(s.Id, s); if (s.Isin && !this.byIsin.has(s.Isin)) this.byIsin.set(s.Isin, s) }
      for (const s of ref.StrategicAssetAllocations ?? []) this.saas.set(s.Id, s)
      for (const r of ref.RiskProfiles ?? []) this.riskProfiles.set(r.Id, r)
    }
    this.rosterText = this.clients.map((c) => `${c.ClientRef}: ${clientName(c)}`).join('\n')
    return { clients: this.clients.length, securities: this.securities.size, ms: Date.now() - t0 }
  }

  /** Kundenliste für den Systemprompt: eine Zeile pro Kunde. */
  roster(): string { return this.rosterText }

  /** Findet einen Kunden per Kundennummer (auch «Case 4») oder per Name, auch mitten in einem Satz. */
  find(query: string): Client | undefined {
    const q = normalize(query.trim())
    if (!q) return undefined
    const ref = q.match(/case[\s-]*0*(\d+)/)
    if (ref) {
      const n = Number(ref[1])
      const hit = this.clients.find((c) => Number(c.ClientRef.replace(/\D/g, '')) === n)
      if (hit) return hit
    }
    let best: Client | undefined
    let bestScore = 0
    for (const c of this.clients) {
      const name = normalize(clientName(c))
      if (!name) continue
      if (name === q) return c
      const tokens = name.split(/\s+/).filter((t) => t.length > 1)
      const hits = tokens.filter((t) => q.includes(t)).length
      const score = hits === tokens.length && hits > 0 ? tokens.length + 1 : hits
      if (score > bestScore) { bestScore = score; best = c }
    }
    return bestScore > 0 ? best : undefined
  }

  /** Kompakte, deutschsprachige Zusammenfassung eines Kunden für den Modellkontext. Ohne IBANs. */
  summary(c: Client): string {
    const cur = c.ReportingCurrency ?? 'CHF'
    const risk = c.RiskProfileId != null ? this.riskProfiles.get(c.RiskProfileId) : undefined
    const riskText = [
      risk?.MaxVola != null ? `max. Volatilität ${pct(risk.MaxVola)}` : '',
      risk?.MaxPRC != null ? `max. Produktrisikoklasse ${risk.MaxPRC}` : '',
      risk?.EquityQuoteInPercent != null ? `Aktienquote ${pct(risk.EquityQuoteInPercent, 0)}` : '',
    ].filter(Boolean).join(', ')
    const age = c.IsClientACompany ? undefined : ageOf(c.Birthday)

    const out: string[] = []
    out.push(`Kunde: ${clientName(c)} · Kundennummer ${c.ClientRef} · ${c.IsClientACompany ? 'Firmenkunde' : 'Privatkunde'}${c.RegulatoryClientTypeName ? ` (${c.RegulatoryClientTypeName})` : ''}${c.IsEmployee ? ' · Bankmitarbeiter' : ''}`)
    if (!c.IsClientACompany && c.Birthday) out.push(`Geburtsdatum: ${day(c.Birthday)}${age != null ? ` (${age} Jahre)` : ''}`)
    out.push(`Berichtswährung ${cur} · Gesamtvermögen ${money(c.AssetsUnderManagementInDefaultCurrency, cur)} · davon Liquidität ${money(c.LiquidityInDefaultCurrency, cur)}`)
    out.push(`Anlageprofil: ${c.RiskProfileName ?? 'k. A.'}${riskText ? ` (${riskText})` : ''} · ESG-Präferenz: ${c.EsgProfileName ?? 'keine Angabe'} · Letztes Risikoprofiling: ${day(c.ProfilingDateUtc)}`)
    const tags = (c.Tags ?? []).map((t) => `${t.TagName}${t.TagTypeName === 'Industry' ? ' (Branche)' : t.TagTypeName === 'Region' ? ' (Region)' : ''}`)
    if (tags.length) out.push(`Interessen: ${tags.join(', ')}`)

    for (const p of c.Portfolios ?? []) { out.push(''); out.push(...this.portfolioSummary(p, c)) }

    const violations = (c.SuitabilityViolations ?? []).map((v) => {
      const pf = (c.Portfolios ?? []).find((p) => p.PortfolioId === v.PortfolioId)
      const sec = v.SecurityIsin ? this.byIsin.get(v.SecurityIsin) : undefined
      const details = [pf?.PortfolioNr ? `Portfolio ${pf.PortfolioNr}` : '', sec?.Name ? `Titel ${sec.Name}` : '', v.LastViolatedDateUTC ? `seit ${day(v.LastViolatedDateUTC)}` : ''].filter(Boolean)
      return `- ${v.Severity === 'Error' ? 'FEHLER' : 'WARNUNG'}: ${v.RuleCode ?? ''}${v.RuleDescription ? ` – ${v.RuleDescription}` : ''}${details.length ? ` (${details.join(', ')})` : ''}`
    })
    out.push('')
    out.push(violations.length ? `Aktive Verstösse gegen Anlagerichtlinien (Suitability):\n${violations.join('\n')}` : 'Aktive Verstösse gegen Anlagerichtlinien: keine')
    const overrides = (c.IndividualRuleOverrides ?? []).map((o) => o.RuleCode).filter(Boolean)
    if (overrides.length) out.push(`Für diesen Kunden individuell ausgesetzte Regeln: ${overrides.join('; ')}`)

    const proposals = [...(c.Proposals ?? [])]
      .sort((a, b) => (b.ProposedDateUTC ?? '').localeCompare(a.ProposedDateUTC ?? ''))
    if (proposals.length) {
      const lines = proposals.slice(0, 5).map((pr) => {
        const pf = (c.Portfolios ?? []).find((p) => p.PortfolioId === pr.PortfolioId)
        const stage = pr.TransactionsSubmittedDateUTC ? 'Aufträge eingereicht' : pr.FinalizedDateUTC ? 'finalisiert' : 'in Bearbeitung'
        return `- ${day(pr.ProposedDateUTC)}: ${pr.Reason ?? 'ohne Anlass'} – Status ${pr.ProposalStatusName ?? 'k. A.'} (${stage})${pr.AdvisoryTypeName ? `, ${pr.AdvisoryTypeName}` : ''}${pf?.PortfolioNr ? `, Portfolio ${pf.PortfolioNr}` : ''}; ${(pr.SecurityPositions ?? []).length} Positionen, erwartete Rendite ${pct(pr.ExpectedReturn)}, Volatilität ${pct(pr.Volatility)}${pr.Notes ? `; Notiz: ${pr.Notes}` : ''}`
      })
      out.push('')
      out.push(`Anlagevorschläge (${proposals.length} insgesamt, neueste zuerst):\n${lines.join('\n')}`)
    }

    const tx = c.Transactions ?? []
    if (tx.length) {
      const expiries = tx.filter((t) => t.IsExpiry).length
      const names = [...new Set(tx.map((t) => t.SecurityName).filter(Boolean))].slice(0, 5)
      out.push(`Transaktionen aus aktiven Vorschlägen: ${tx.length} Orderpositionen${expiries ? ` (davon ${expiries} Verfälle)` : ''}${names.length ? `, z. B. ${names.join(', ')}` : ''}`)
    }

    const notes = [...(c.ClientNotes ?? [])]
      .sort((a, b) => (b.CreatedByDateUTC ?? '').localeCompare(a.CreatedByDateUTC ?? ''))
      .map((n) => `- ${day(n.CreatedByDateUTC)}: ${n.Note ?? ''}`)
    if (notes.length) { out.push(''); out.push(`Beraternotizen (neueste zuerst):\n${notes.join('\n')}`) }

    return out.join('\n')
  }

  private portfolioSummary(p: Portfolio, c: Client): string[] {
    const cur = p.PortfolioCurrency ?? c.ReportingCurrency ?? 'CHF'
    const repCur = c.ReportingCurrency ?? 'CHF'
    const lines: string[] = []
    lines.push(`Portfolio ${p.PortfolioNr ?? '?'} «${p.Name ?? ''}» (${cur}) – ${p.InvestmentServiceName ?? 'k. A.'} / ${p.StrategyName ?? 'k. A.'}`)

    const hist = [...(p.PerformanceHistory ?? [])].filter((h) => h && h.Date).sort((a, b) => a.Date.localeCompare(b.Date))
    const last = hist.at(-1)
    const prev12 = hist.at(-13)
    const perf12 = last && prev12 && prev12.Value ? last.Value / prev12.Value - 1 : undefined
    const yearStart = last ? hist.filter((h) => h.Date < `${last.Date.slice(0, 4)}-01-01`).at(-1) : undefined
    const ytd = p.PerformanceYTD ?? (last && yearStart && yearStart.Value ? last.Value / yearStart.Value - 1 : undefined)
    lines.push(`  Vermögen ${money(p.AssetsUnderManagementInDefaultCurrency, repCur)} · Liquidität ${money(p.LiquidityInDefaultCurrency, repCur)} · Volatilität ${pct(p.Volatility)} · erwartete Rendite ${pct(p.ExpectedReturn)} · Value at Risk ${pct(p.ValueAtRisk)} · Performance seit Jahresbeginn ${pct(ytd)} · letzte 12 Monate ${pct(perf12)} (Stand ${day(p.FactoryDateUtc ?? last?.Date)})`)

    // Ist-Allokation nach SAA-Anlageklasse (Securities.SAA_AssetClassName), Konten zählen als Liquidität.
    const actual = new Map<string, number>()
    for (const pos of p.SecurityPositions ?? []) {
      const sec = pos.SecurityId != null ? this.securities.get(pos.SecurityId) : undefined
      const cat = sec?.SAA_AssetClassName ?? 'Nicht klassifiziert'
      actual.set(cat, (actual.get(cat) ?? 0) + (pos.PortfolioValuePercentage ?? 0))
    }
    for (const acc of p.AccountPositions ?? []) actual.set('Liquidity', (actual.get('Liquidity') ?? 0) + (acc.PortfolioValuePercentage ?? 0))
    const saa = p.StrategicAssetAllocationId != null ? this.saas.get(p.StrategicAssetAllocationId) : undefined
    const targets = (saa?.Mappings ?? []).filter((m) => m.Dimension === 'AssetClass')
    const parts: string[] = []
    const seen = new Set<string>()
    for (const t of targets) {
      seen.add(t.Category)
      const a = actual.get(t.Category) ?? 0
      let flag = ''
      if (t.MaxPercentage != null && a > t.MaxPercentage + 1e-9) flag = ' – ÜBER dem Maximum'
      else if (t.MinPercentage != null && a < t.MinPercentage - 1e-9) flag = ' – UNTER dem Minimum'
      parts.push(`${de(t.Category)} ${pct(a)} (Ziel ${pct(t.TargetPercentage, 0)}, Bandbreite ${pct(t.MinPercentage, 0)} bis ${pct(t.MaxPercentage, 0)})${flag}`)
    }
    for (const [cat, a] of actual) if (!seen.has(cat) && a > 0.0005) parts.push(`${de(cat)} ${pct(a)} (kein Zielwert)`)
    if (parts.length) lines.push(`  Anlageklassen Ist vs. Strategie${saa?.Name ? ` «${saa.Name}»` : ''}: ${parts.join(' · ')}`)

    const curExp = new Map<string, number>()
    for (const pos of p.SecurityPositions ?? []) curExp.set(pos.Currency ?? '?', (curExp.get(pos.Currency ?? '?') ?? 0) + (pos.PortfolioValuePercentage ?? 0))
    for (const acc of p.AccountPositions ?? []) curExp.set(acc.Currency ?? '?', (curExp.get(acc.Currency ?? '?') ?? 0) + (acc.PortfolioValuePercentage ?? 0))
    const curParts = [...curExp].filter(([, v]) => v > 0.0005).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`)
    if (curParts.length) lines.push(`  Währungen nach Positionswährung: ${curParts.join(', ')}`)

    const positions = [...(p.SecurityPositions ?? [])].sort((a, b) => (b.PortfolioValuePercentage ?? 0) - (a.PortfolioValuePercentage ?? 0))
    const top = positions.slice(0, 12).map((pos, i) => {
      const sec = pos.SecurityId != null ? this.securities.get(pos.SecurityId) : undefined
      const extra = [
        sec?.AssetClassName,
        sec?.InRecommendationList ? 'auf Empfehlungsliste' : undefined,
        sec?.SustainabilityScore != null ? `ESG-Score ${sec.SustainabilityScore}` : undefined,
        sec?.PRC != null ? `Risikoklasse ${sec.PRC}` : undefined,
      ].filter(Boolean).join(', ')
      return `${i + 1}. ${pos.SecurityName ?? sec?.Name ?? pos.Isin ?? '?'} – ${pct(pos.PortfolioValuePercentage)} (${money(pos.TotalAmountInPortfolioCurrency, cur)}${extra ? `; ${extra}` : ''})`
    })
    if (top.length) lines.push(`  Grösste Positionen (${positions.length} insgesamt): ${top.join(' | ')}`)
    const accounts = (p.AccountPositions ?? []).map((a) => `${a.AccountName ?? 'Konto'} (${a.Currency ?? '?'}): ${money(a.TotalAmountInPortfolioCurrency, cur)}`)
    if (accounts.length) lines.push(`  Konten: ${accounts.join(' | ')}`)
    return lines
  }
}

export const data = new DataStore()
