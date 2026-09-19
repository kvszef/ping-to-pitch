// Baut data/unrisk.db aus den Case-Dateien. Ein Lauf ist vollständig: das Schema aus
// toolbox/schema.sql beginnt mit DROP TABLE, es gibt also kein Nachladen und kein
// Auseinanderlaufen von Schema und Lader. Mehrfach ausführen ergibt dasselbe Ergebnis.
//
// Aufruf:  npm run load-data      (aus dem Ordner phone/)
// Quellen: CLIENTS_JSON (auch mehrere, mit Komma getrennt), REFERENCE_JSON, CALLERS_JSON
//
// Die Konventionen der Quelldaten stehen in core-case/portfolio-data/DATA.md und im Kopf
// von toolbox/schema.sql. Die wichtigste: ein leeres Feld fehlt im Objekt, statt null zu
// sein. Deshalb ist hier alles optional und geht durch die Konverter weiter unten.

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ------------------------------------------------------------------ Konfiguration

// Alle Pfade zählen ab dem Ordner phone/, egal aus welchem Verzeichnis der Aufruf kommt.
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const abs = (p: string): string => path.resolve(ROOT, p.trim())
// Für die Ausgabe: der kurze Pfad, solange er in der Nähe liegt, sonst der volle.
const show = (p: string): string => {
  const rel = path.relative(ROOT, p)
  return rel && !rel.startsWith(`..${path.sep}..`) ? rel : p
}

const DB_PATH = abs(process.env.UNRISK_DB || './data/unrisk.db')
const SCHEMA_PATH = path.join(ROOT, 'toolbox', 'schema.sql')
// Kommagetrennt, weil zum Fallbeispiel weitere Kundendateien gleicher Form nachgereicht werden.
const CLIENTS_PATHS = (process.env.CLIENTS_JSON || '../core-case/portfolio-data/clients.json')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean)
  .map(abs)
const REFERENCE_PATH = abs(process.env.REFERENCE_JSON || '../core-case/portfolio-data/reference.json')
const CALLERS_PATH = abs(process.env.CALLERS_JSON || './data/callers.json')

// Ticker, die in AccountPositions[].Currency für eine Kryptowährung stehen. Bewusst eine
// feste Liste: OZG ist eine Unze Gold, also kein Krypto, und ein unbekannter Ticker aus
// einer späteren Datei soll lieber auffallen als stillschweigend falsch einsortiert werden.
const CRYPTO_TICKERS = new Set([
  'BTC', 'ETH', 'SOL', 'DOT', 'SHIB', 'ADA', 'XRP', 'LTC', 'BCH', 'DOGE',
  'AVAX', 'MATIC', 'LINK', 'UNI', 'XLM', 'TRX', 'ATOM', 'ALGO', 'XMR', 'USDT', 'USDC',
])

// ------------------------------------------------------------------ Typen

// Nur so weit typisiert, wie der Lader die Felder anfasst. Alles optional, siehe Kopf.
type Json = Record<string, unknown>

type PerfPoint = { Date?: string; Value?: number }
type Client = Json & { ClientRef?: string }

// ------------------------------------------------------------------ Hilfen

const fail = (message: string, hint?: string): never => {
  console.error(`\nFehler: ${message}`)
  if (hint) console.error(`        ${hint}`)
  process.exit(1)
}

/** Liest JSON und stirbt mit einer lesbaren Meldung statt mit einem Stacktrace. */
const readJson = (file: string, label: string): unknown => {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      fail(`${label} nicht gefunden: ${file}`, 'Pfad in phone/.env prüfen (siehe .env.example).')
    }
    return fail(`${label} nicht lesbar: ${file}`, String((err as Error).message))
  }
  try {
    // Ohne das Abschneiden scheitert jede Datei, die ein Windows-Editor mit BOM gespeichert
    // hat -- und callers.json legt man von Hand an.
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch (err) {
    return fail(`${label} ist kein gültiges JSON: ${file}`, String((err as Error).message))
  }
}

// SQLite kennt keinen booleschen Typ und node:sqlite bindet auch kein boolean, deshalb
// gehen alle Werte durch diese drei Konverter, bevor sie in eine Anweisung wandern.
const text = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() === '' ? null : v
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  return null
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v: unknown): number | null => {
  const n = num(v)
  return n === null ? null : Math.trunc(n)
}
const bool = (v: unknown): number => (v === true ? 1 : 0)
const flag = (v: unknown): number | null => (typeof v === 'boolean' ? (v ? 1 : 0) : null)

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** raw_json ohne die Sammlungen, die eine eigene Tabelle haben. Begründung im Schemakopf. */
const jsonWithout = (obj: Json, drop: string[]): string => {
  const copy: Json = { ...obj }
  for (const key of drop) delete copy[key]
  return JSON.stringify(copy)
}

const clientName = (c: Client): string => {
  if (c.IsClientACompany === true && text(c.Company)) return String(c.Company).trim()
  const full = `${text(c.FirstName) ?? ''} ${text(c.LastName) ?? ''}`.replace(/\s+/g, ' ').trim()
  // 12 Privatkunden führen nur einen Vornamen (Yoda, Spock, ...), LastName ist dort "".
  return full || String(c.ClientRef ?? '')
}

/**
 * PerformanceYTD steht zwar in DATA.md, fehlt aber in allen gelieferten Portfolios.
 * Deshalb aus PerformanceHistory rechnen: Jahresbeginn ist der letzte Stand vor dem
 * 1. Januar des jüngsten Datenjahres, zwölf Monate sind dreizehn Monatsstände zurück.
 *
 * Das Ergebnis ist eine Wertveränderung und keine Rendite: PerformanceHistory ist der
 * Depotwert, Ein- und Auszahlungen stecken also drin. Die acht reinen Cash-Portfolios
 * zeigen so bis zu +16 %, obwohl sie nichts erwirtschaftet haben. Steht in der Spalte.
 */
const performance = (history: PerfPoint[]): { nav: number | null; navDate: string | null; ytd: number | null; p12: number | null } => {
  const rows = history
    .filter((h) => h && typeof h.Date === 'string' && typeof h.Value === 'number')
    .sort((a, b) => String(a.Date).localeCompare(String(b.Date)))
  const last = rows.at(-1)
  if (!last) return { nav: null, navDate: null, ytd: null, p12: null }
  const yearStart = rows.filter((h) => String(h.Date) < `${String(last.Date).slice(0, 4)}-01-01`).at(-1)
  const before12 = rows.at(-13)
  const change = (base?: PerfPoint): number | null =>
    base && typeof base.Value === 'number' && base.Value !== 0 ? Number(last.Value) / base.Value - 1 : null
  return { nav: num(last.Value), navDate: text(last.Date), ytd: change(yearStart), p12: change(before12) }
}

/** +41 79 123 45 67 und 0041791234567 sollen dieselbe Zeile treffen. */
const normalizePhone = (raw: string): string => {
  const cleaned = raw.trim().replace(/[\s\-().\/]/g, '')
  return cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned
}

// ------------------------------------------------------------------ Einlesen

const started = Date.now()
const warnings: string[] = []

const clients: Client[] = []
const seenRefs = new Map<string, string>()
for (const file of CLIENTS_PATHS) {
  const parsed = readJson(file, 'Kundendatei (CLIENTS_JSON)')
  if (!Array.isArray(parsed)) {
    fail(`${file} enthält kein Array von Kunden.`, 'Erwartet wird dieselbe Form wie core-case/portfolio-data/clients.json.')
  }
  for (const entry of parsed as Client[]) {
    const ref = typeof entry?.ClientRef === 'string' ? entry.ClientRef.trim() : ''
    if (!ref) {
      warnings.push(`Kunde ohne ClientRef übersprungen (${path.basename(file)}).`)
      continue
    }
    const previous = seenRefs.get(ref)
    if (previous) {
      // Nachgereichte Dateien dürfen einen Kunden ersetzen; die spätere Datei gewinnt.
      warnings.push(`${ref} kommt in ${previous} und ${path.basename(file)} vor, die spätere Datei gewinnt.`)
      clients.splice(clients.findIndex((c) => c.ClientRef === ref), 1)
    }
    seenRefs.set(ref, path.basename(file))
    clients.push(entry)
  }
}
if (clients.length === 0) fail('Keine Kunden gefunden.', `Geprüft: ${CLIENTS_PATHS.join(', ')}`)
// Sortiert, damit die vergebenen Zeilennummern über Läufe und über zusätzliche Dateien stabil bleiben.
clients.sort((a, b) => String(a.ClientRef).localeCompare(String(b.ClientRef)))

const reference = readJson(REFERENCE_PATH, 'Nachschlagedatei (REFERENCE_JSON)') as Json
if (typeof reference !== 'object' || reference === null || Array.isArray(reference)) {
  fail(`${REFERENCE_PATH} enthält kein Objekt.`, 'Erwartet wird dieselbe Form wie core-case/portfolio-data/reference.json.')
}

// Jede Sammlung in reference.json kann komplett fehlen, wenn kein Kunde sie referenziert.
const securities = arr<Json>(reference.Securities)
const saas = arr<Json>(reference.StrategicAssetAllocations)
const riskProfiles = arr<Json>(reference.RiskProfiles)

// Join über Id, nicht über Isin: dieselbe ISIN erscheint je Währungstranche mehrfach.
const securityById = new Map<number, Json>()
for (const s of securities) {
  const id = int(s.Id)
  if (id !== null) securityById.set(id, s)
}

// Anruferzuordnung ist optional: ohne die Datei bleibt phone_map leer.
let callers: Json = {}
let callersMtime: string | null = null
const hasCallers = fs.existsSync(CALLERS_PATH)
if (hasCallers) {
  const parsed = readJson(CALLERS_PATH, 'Anruferzuordnung (CALLERS_JSON)')
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(`${CALLERS_PATH} enthält kein Objekt.`, 'Erwartet wird {"+41791234567": "CASE-004"}.')
  }
  callers = parsed as Json
  callersMtime = fs.statSync(CALLERS_PATH).mtime.toISOString()
}

// ------------------------------------------------------------------ Datenbank öffnen

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
const db = new DatabaseSync(DB_PATH)

let schema: string
try {
  schema = fs.readFileSync(SCHEMA_PATH, 'utf8')
} catch {
  schema = fail(`Schema nicht gefunden: ${SCHEMA_PATH}`, 'toolbox/schema.sql gehört zum Repo und darf nicht fehlen.')
}
// Der Copilot schreibt nach jedem Gespräch eine Zusammenfassung in clients.description.
// Das Schema wirft die Tabelle gleich weg, also vorher retten und nachher zurückschreiben –
// sonst wäre das Gesprächsgedächtnis nach jedem Lauf gelöscht.
const gerettet = new Map<string, string>()
try {
  for (const r of db.prepare('SELECT client_ref, description FROM clients WHERE description IS NOT NULL').all() as { client_ref: string; description: string }[]) {
    gerettet.set(r.client_ref, r.description)
  }
} catch { /* erster Lauf: die Tabelle gibt es noch nicht */ }

try {
  db.exec(schema)
} catch (err) {
  fail(`Das Schema liess sich nicht ausführen (${path.relative(ROOT, SCHEMA_PATH)}).`, String((err as Error).message))
}

const stmt = {
  client: db.prepare(`INSERT INTO clients
    (client_ref, client_id, name, first_name, last_name, company, is_company, is_employee, client_type,
     reporting_ccy, risk_profile_id, risk_profile, esg_profile_id, esg_profile, tags, birthday,
     profiling_date, aum, liquidity, description, raw_json)
    VALUES (:client_ref, :client_id, :name, :first_name, :last_name, :company, :is_company, :is_employee,
     :client_type, :reporting_ccy, :risk_profile_id, :risk_profile, :esg_profile_id, :esg_profile, :tags,
     :birthday, :profiling_date, :aum, :liquidity, :description, :raw_json)`),
  portfolio: db.prepare(`INSERT INTO portfolios
    (portfolio_id, client_ref, portfolio_nr, name, currency, reference_ccy, saa_id, service_id, service_name,
     strategy_id, strategy_name, aum, liquidity, volatility, expected_return, value_at_risk, performance_ytd,
     performance_12m, nav_latest, nav_date, factory_date, raw_json)
    VALUES (:portfolio_id, :client_ref, :portfolio_nr, :name, :currency, :reference_ccy, :saa_id, :service_id,
     :service_name, :strategy_id, :strategy_name, :aum, :liquidity, :volatility, :expected_return,
     :value_at_risk, :performance_ytd, :performance_12m, :nav_latest, :nav_date, :factory_date, :raw_json)`),
  position: db.prepare(`INSERT INTO positions
    (portfolio_id, client_ref, security_id, isin, security_name, quantity, price_per_unit, currency, amount,
     weight, contribution_volatility, security_type, asset_class, saa_asset_class, saa_currency_group,
     saa_country_group, saa_industry, raw_json)
    VALUES (:portfolio_id, :client_ref, :security_id, :isin, :security_name, :quantity, :price_per_unit,
     :currency, :amount, :weight, :contribution_volatility, :security_type, :asset_class, :saa_asset_class,
     :saa_currency_group, :saa_country_group, :saa_industry, :raw_json)`),
  account: db.prepare(`INSERT INTO accounts
    (portfolio_id, client_ref, account_name, currency, amount, weight, is_crypto, raw_json)
    VALUES (:portfolio_id, :client_ref, :account_name, :currency, :amount, :weight, :is_crypto, :raw_json)`),
  proposal: db.prepare(`INSERT INTO proposals
    (proposal_id, client_ref, portfolio_id, status, advisory_type, currency, saa_id, position_count,
     proposed_at, finalized_at, submitted_at, reason, notes, expected_return, volatility, value_at_risk, raw_json)
    VALUES (:proposal_id, :client_ref, :portfolio_id, :status, :advisory_type, :currency, :saa_id,
     :position_count, :proposed_at, :finalized_at, :submitted_at, :reason, :notes, :expected_return,
     :volatility, :value_at_risk, :raw_json)`),
  transaction: db.prepare(`INSERT INTO transactions
    (client_ref, portfolio_id, transaction_id, proposal_id, security_id, isin, security_name, quantity,
     amount, currency, is_expiry, forward_state, raw_json)
    VALUES (:client_ref, :portfolio_id, :transaction_id, :proposal_id, :security_id, :isin, :security_name,
     :quantity, :amount, :currency, :is_expiry, :forward_state, :raw_json)`),
  violation: db.prepare(`INSERT INTO violations
    (client_ref, portfolio_id, rule_code, rule_description, severity, error_level, security_isin,
     last_violated_at, is_override, raw_json)
    VALUES (:client_ref, :portfolio_id, :rule_code, :rule_description, :severity, :error_level,
     :security_isin, :last_violated_at, :is_override, :raw_json)`),
  note: db.prepare(`INSERT INTO notes (client_ref, created_at, text, raw_json)
    VALUES (:client_ref, :created_at, :text, :raw_json)`),
  security: db.prepare(`INSERT INTO securities
    (security_id, isin, name, security_type, asset_class, saa_asset_class, saa_currency_group,
     saa_country_group, saa_industry, country, industry, currency, price, volatility, expected_return,
     ytm, maturity_date, sustainability, prc, in_recommendation, raw_json)
    VALUES (:security_id, :isin, :name, :security_type, :asset_class, :saa_asset_class, :saa_currency_group,
     :saa_country_group, :saa_industry, :country, :industry, :currency, :price, :volatility,
     :expected_return, :ytm, :maturity_date, :sustainability, :prc, :in_recommendation, :raw_json)`),
  saaTarget: db.prepare(`INSERT INTO saa_targets (saa_id, saa_name, dimension, category, min_pct, target_pct, max_pct)
    VALUES (:saa_id, :saa_name, :dimension, :category, :min_pct, :target_pct, :max_pct)`),
  riskProfile: db.prepare(`INSERT INTO risk_profiles (id, name, risk_level, max_vola, max_prc, equity_quote_pct, raw_json)
    VALUES (:id, :name, :risk_level, :max_vola, :max_prc, :equity_quote_pct, :raw_json)`),
  phone: db.prepare(`INSERT INTO phone_map (phone_e164, client_ref, label, updated_at)
    VALUES (:phone_e164, :client_ref, :label, :updated_at)`),
  referenceSet: db.prepare(`INSERT INTO reference_sets (name, entries, raw_json)
    VALUES (:name, :entries, :raw_json)`),
}

// PortfolioId und ProposalId sind Primärschlüssel und müssen über alle Kundendateien hinweg
// eindeutig sein. Ohne diese beiden Karten meldet SQLite nur "UNIQUE constraint failed" und
// man sucht den betroffenen Kunden von Hand.
const portfolioOwner = new Map<number, string>()
const proposalOwner = new Map<number, string>()

const counts: Record<string, number> = {
  clients: 0, portfolios: 0, positions: 0, accounts: 0, proposals: 0,
  transactions: 0, violations: 0, notes: 0, securities: 0, saa_targets: 0,
  risk_profiles: 0, phone_map: 0, reference_sets: 0,
}
let unresolvedSecurities = 0

// ------------------------------------------------------------------ Schreiben

// Alles in einer Transaktion: einzeln bestätigt bräuchte jede der rund 2500 Zeilen eine
// eigene Festplattensynchronisation, der Lauf dauerte dann Minuten statt Sekunden.
db.exec('BEGIN')
try {
  for (const s of securities) {
    const id = int(s.Id)
    if (id === null) continue
    stmt.security.run({
      security_id: id,
      isin: text(s.Isin),
      name: text(s.Name),
      security_type: text(s.SecurityTypeName),
      asset_class: text(s.AssetClassName),
      saa_asset_class: text(s.SAA_AssetClassName),
      saa_currency_group: text(s.SAA_CurrencyGroupName),
      saa_country_group: text(s.SAA_CountryGroupName),
      saa_industry: text(s.SAA_IndustryName),
      country: text(s.CountryName),
      industry: text(s.IndustryName),
      currency: text(s.Currency),
      price: num(s.EndOfDayPrice),
      volatility: num(s.Volatility),
      expected_return: num(s.ExpectedReturn),
      ytm: num(s.YieldToMaturity),
      maturity_date: text(s.MaturityDateUtc),
      sustainability: num(s.SustainabilityScore),
      prc: num(s.PRC),
      in_recommendation: flag(s.InRecommendationList),
      raw_json: JSON.stringify(s),
    })
    counts.securities++
  }

  for (const saa of saas) {
    const saaId = int(saa.Id)
    if (saaId === null) continue
    for (const m of arr<Json>(saa.Mappings)) {
      stmt.saaTarget.run({
        saa_id: saaId,
        saa_name: text(saa.Name),
        dimension: text(m.Dimension),
        category: text(m.Category),
        min_pct: num(m.MinPercentage),
        target_pct: num(m.TargetPercentage),
        max_pct: num(m.MaxPercentage),
      })
      counts.saa_targets++
    }
  }

  for (const r of riskProfiles) {
    const id = int(r.Id)
    if (id === null) continue
    stmt.riskProfile.run({
      id,
      name: text(r.Name),
      risk_level: int(r.RiskLevel),
      max_vola: num(r.MaxVola),
      max_prc: num(r.MaxPRC),
      equity_quote_pct: num(r.EquityQuoteInPercent),
      raw_json: JSON.stringify(r),
    })
    counts.risk_profiles++
  }

  // Jede Sammlung aus reference.json noch einmal unverändert, eine Zeile je Schlüssel. Die
  // Tabellen oben sind eine Auswahl für den Copiloten; wer die Nachschlagedatei ganz braucht,
  // liest hier. Bewusst ohne Wissen über die Schlüssel: kommt in einer späteren Lieferung eine
  // Sammlung dazu, landet sie mit, statt stillschweigend zu fehlen.
  for (const [name, value] of Object.entries(reference)) {
    stmt.referenceSet.run({
      name,
      entries: Array.isArray(value) ? value.length : null,
      raw_json: JSON.stringify(value ?? null),
    })
    counts.reference_sets++
  }

  for (const c of clients) {
    const ref = String(c.ClientRef)
    const tags = arr<Json>(c.Tags)
      .map((t) => `${text(t.TagName) ?? ''}${t.TagTypeName ? ` (${t.TagTypeName})` : ''}`.trim())
      .filter(Boolean)
      .join(', ')
    stmt.client.run({
      client_ref: ref,
      client_id: int(c.ClientId),
      name: clientName(c),
      first_name: text(c.FirstName),
      last_name: text(c.LastName),
      company: text(c.Company),
      is_company: bool(c.IsClientACompany),
      is_employee: bool(c.IsEmployee),
      client_type: text(c.RegulatoryClientTypeName),
      reporting_ccy: text(c.ReportingCurrency),
      risk_profile_id: int(c.RiskProfileId),
      risk_profile: text(c.RiskProfileName),
      esg_profile_id: int(c.EsgProfileId),
      esg_profile: text(c.EsgProfileName),
      tags: tags || null,
      birthday: text(c.Birthday),
      profiling_date: text(c.ProfilingDateUtc),
      aum: num(c.AssetsUnderManagementInDefaultCurrency),
      liquidity: num(c.LiquidityInDefaultCurrency),
      // Vorrang hat, was der Copilot schon geschrieben hat: sonst löschte jeder Neuaufbau
      // der Stammdaten das Gesprächsgedächtnis.
      description: gerettet.get(ref) ?? text(c.Description),
      raw_json: jsonWithout(c, ['Portfolios', 'Proposals', 'Transactions', 'SuitabilityViolations', 'ClientNotes']),
    })
    counts.clients++

    const portfolioIds = new Set<number>()
    for (const p of arr<Json>(c.Portfolios)) {
      const portfolioId = int(p.PortfolioId)
      if (portfolioId === null) {
        warnings.push(`${ref}: Portfolio ohne PortfolioId übersprungen.`)
        continue
      }
      const owner = portfolioOwner.get(portfolioId)
      if (owner) {
        throw new Error(
          `${ref}: PortfolioId ${portfolioId} gibt es schon bei ${owner}. Zwei Kundendateien ` +
            'beschreiben dasselbe Portfolio; in CLIENTS_JSON die doppelte Datei entfernen.',
        )
      }
      portfolioOwner.set(portfolioId, ref)
      portfolioIds.add(portfolioId)
      const perf = performance(arr<PerfPoint>(p.PerformanceHistory))
      stmt.portfolio.run({
        portfolio_id: portfolioId,
        client_ref: ref,
        portfolio_nr: text(p.PortfolioNr),
        name: text(p.Name),
        currency: text(p.PortfolioCurrency),
        reference_ccy: text(p.ReferenceCurrency),
        saa_id: int(p.StrategicAssetAllocationId),
        service_id: int(p.InvestmentServiceId),
        service_name: text(p.InvestmentServiceName),
        strategy_id: int(p.StrategyId),
        strategy_name: text(p.StrategyName),
        aum: num(p.AssetsUnderManagementInDefaultCurrency),
        liquidity: num(p.LiquidityInDefaultCurrency),
        volatility: num(p.Volatility),
        expected_return: num(p.ExpectedReturn),
        value_at_risk: num(p.ValueAtRisk),
        performance_ytd: num(p.PerformanceYTD) ?? perf.ytd,
        performance_12m: perf.p12,
        nav_latest: perf.nav,
        nav_date: perf.navDate,
        factory_date: text(p.FactoryDateUtc),
        raw_json: jsonWithout(p, ['SecurityPositions', 'AccountPositions']),
      })
      counts.portfolios++

      for (const pos of arr<Json>(p.SecurityPositions)) {
        const securityId = int(pos.SecurityId)
        const sec = securityId !== null ? securityById.get(securityId) : undefined
        if (securityId !== null && !sec) unresolvedSecurities++
        stmt.position.run({
          portfolio_id: portfolioId,
          client_ref: ref,
          security_id: securityId,
          isin: text(pos.Isin),
          security_name: text(pos.SecurityName) ?? text(sec?.Name),
          quantity: num(pos.Quantity),
          price_per_unit: num(pos.PricePerUnit),
          currency: text(pos.Currency),
          amount: num(pos.TotalAmountInPortfolioCurrency),
          weight: num(pos.PortfolioValuePercentage),
          contribution_volatility: num(pos.ContributionVolatility),
          security_type: text(sec?.SecurityTypeName),
          asset_class: text(sec?.AssetClassName),
          saa_asset_class: text(sec?.SAA_AssetClassName),
          saa_currency_group: text(sec?.SAA_CurrencyGroupName),
          saa_country_group: text(sec?.SAA_CountryGroupName),
          saa_industry: text(sec?.SAA_IndustryName),
          raw_json: JSON.stringify(pos),
        })
        counts.positions++
      }

      for (const acc of arr<Json>(p.AccountPositions)) {
        const currency = text(acc.Currency)
        stmt.account.run({
          portfolio_id: portfolioId,
          client_ref: ref,
          account_name: text(acc.AccountName),
          currency,
          amount: num(acc.TotalAmountInPortfolioCurrency),
          weight: num(acc.PortfolioValuePercentage),
          is_crypto: currency && CRYPTO_TICKERS.has(currency.toUpperCase()) ? 1 : 0,
          raw_json: JSON.stringify(acc),
        })
        counts.accounts++
      }
    }

    // Transaktionen tragen keine PortfolioId, sie hängt am Vorschlag.
    const portfolioOfProposal = new Map<number, number | null>()
    for (const pr of arr<Json>(c.Proposals)) {
      const proposalId = int(pr.ProposalId)
      if (proposalId === null) {
        warnings.push(`${ref}: Anlagevorschlag ohne ProposalId übersprungen.`)
        continue
      }
      const owner = proposalOwner.get(proposalId)
      if (owner) {
        throw new Error(
          `${ref}: ProposalId ${proposalId} gibt es schon bei ${owner}. Zwei Kundendateien ` +
            'beschreiben denselben Anlagevorschlag; in CLIENTS_JSON die doppelte Datei entfernen.',
        )
      }
      proposalOwner.set(proposalId, ref)
      const portfolioId = int(pr.PortfolioId)
      portfolioOfProposal.set(proposalId, portfolioId)
      if (portfolioId !== null && !portfolioIds.has(portfolioId)) {
        warnings.push(`${ref}: Vorschlag ${proposalId} zeigt auf Portfolio ${portfolioId}, das nicht geliefert wurde.`)
      }
      stmt.proposal.run({
        proposal_id: proposalId,
        client_ref: ref,
        portfolio_id: portfolioId,
        status: text(pr.ProposalStatusName),
        advisory_type: text(pr.AdvisoryTypeName),
        currency: text(pr.Currency),
        saa_id: int(pr.StrategicAssetAllocationId),
        position_count: arr<Json>(pr.SecurityPositions).length,
        proposed_at: text(pr.ProposedDateUTC),
        finalized_at: text(pr.FinalizedDateUTC),
        submitted_at: text(pr.TransactionsSubmittedDateUTC),
        reason: text(pr.Reason),
        notes: text(pr.Notes),
        expected_return: num(pr.ExpectedReturn),
        volatility: num(pr.Volatility),
        value_at_risk: num(pr.ValueAtRisk),
        raw_json: JSON.stringify(pr),
      })
      counts.proposals++
    }

    for (const t of arr<Json>(c.Transactions)) {
      const proposalId = int(t.ProposalId)
      stmt.transaction.run({
        client_ref: ref,
        portfolio_id: proposalId !== null ? portfolioOfProposal.get(proposalId) ?? null : null,
        transaction_id: int(t.TransactionId),
        proposal_id: proposalId,
        security_id: int(t.SecurityId),
        isin: text(t.Isin),
        security_name: text(t.SecurityName),
        quantity: num(t.QuantityForTransaction),
        amount: num(t.TotalAmount),
        currency: text(t.Currency),
        is_expiry: bool(t.IsExpiry),
        // ForwardState ist das eine Feld, das auch als echtes null in der Quelle steht.
        forward_state: int(t.ForwardState),
        raw_json: JSON.stringify(t),
      })
      counts.transactions++
    }

    for (const v of arr<Json>(c.SuitabilityViolations)) {
      stmt.violation.run({
        client_ref: ref,
        portfolio_id: int(v.PortfolioId),
        rule_code: text(v.RuleCode),
        rule_description: text(v.RuleDescription),
        severity: text(v.Severity),
        error_level: int(v.ErrorLevel),
        security_isin: text(v.SecurityIsin),
        last_violated_at: text(v.LastViolatedDateUTC),
        is_override: 0,
        raw_json: JSON.stringify(v),
      })
      counts.violations++
    }

    // Ausgesetzte Regeln stehen in derselben Tabelle, unterschieden durch is_override.
    // Sie sind kein Verstoss, sondern erklären, warum ein Verstoss fehlt.
    for (const o of arr<Json>(c.IndividualRuleOverrides)) {
      stmt.violation.run({
        client_ref: ref,
        portfolio_id: null,
        rule_code: text(o.RuleCode),
        rule_description: text(o.RuleDescription),
        severity: null,
        error_level: null,
        security_isin: null,
        last_violated_at: null,
        is_override: 1,
        raw_json: JSON.stringify(o),
      })
      counts.violations++
    }

    for (const n of arr<Json>(c.ClientNotes)) {
      stmt.note.run({
        client_ref: ref,
        created_at: text(n.CreatedByDateUTC),
        text: text(n.Note),
        raw_json: JSON.stringify(n),
      })
      counts.notes++
    }
  }

  // Zuletzt, weil phone_map einen Fremdschlüssel auf clients hat.
  for (const [rawPhone, value] of Object.entries(callers)) {
    const phone = normalizePhone(rawPhone)
    const entry = typeof value === 'string' ? { client_ref: value } : (value as Json | null) ?? {}
    const clientRef = String(entry.client_ref ?? entry.clientRef ?? entry.ref ?? '').trim()
    if (!phone || !clientRef) {
      warnings.push(`Anruferzuordnung "${rawPhone}" ohne Nummer oder Kundennummer, übersprungen.`)
      continue
    }
    if (!seenRefs.has(clientRef)) {
      warnings.push(`Anruferzuordnung ${phone} zeigt auf ${clientRef}, den es in den Kundendaten nicht gibt.`)
      continue
    }
    stmt.phone.run({
      phone_e164: phone,
      client_ref: clientRef,
      label: text(entry.label),
      // Änderungsstand der Datei, nicht der Zeitpunkt des Laufs: sonst wäre kein Lauf
      // mehr mit dem vorigen identisch.
      updated_at: callersMtime,
    })
    counts.phone_map++
  }

  db.exec('COMMIT')
} catch (err) {
  // Der Rollback darf den eigentlichen Fehler nicht verdecken, deshalb hier stumm.
  try {
    db.exec('ROLLBACK')
    db.close()
  } catch {}
  fail('Das Laden ist abgebrochen, die Datenbank bleibt unverändert.', String((err as Error).message))
}

// Den WAL-Zwischenstand in die Hauptdatei schreiben, damit unrisk.db für sich allein
// vollständig ist und kopiert werden kann.
db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
db.close()

// ------------------------------------------------------------------ Zusammenfassung

const seconds = ((Date.now() - started) / 1000).toFixed(1)
const sizeMb = (fs.statSync(DB_PATH).size / 1024 / 1024).toFixed(1)

console.log(`\nunrisk.db gebaut: ${show(DB_PATH)} (${sizeMb} MB, ${seconds} s)`)
console.log(`Quellen: ${CLIENTS_PATHS.map(show).join(', ')} + ${show(REFERENCE_PATH)}`)
for (const [table, rows] of Object.entries(counts)) {
  console.log(`  ${table.padEnd(14)} ${String(rows).padStart(6)}`)
}

if (unresolvedSecurities > 0) {
  console.log(`\nHinweis: ${unresolvedSecurities} Positionen verweisen auf eine SecurityId, die in reference.json fehlt.`)
}
if (!hasCallers) {
  console.log(`\nHinweis: keine Anruferzuordnung unter ${show(CALLERS_PATH)}, phone_map bleibt leer.`)
  console.log('         Zum Anlegen: echo \'{"+41791234567": "CASE-004"}\' > data/callers.json')
  console.log('         Die Datei bleibt lokal, data/ ist in .gitignore ausgeschlossen.')
}
if (warnings.length > 0) {
  // Gesammelt und gekürzt: eine Warnung je Zeile mitten im Lauf wäre nicht zu lesen.
  console.log(`\n${warnings.length} Hinweis(e) beim Einlesen:`)
  for (const w of warnings.slice(0, 10)) console.log(`  - ${w}`)
  if (warnings.length > 10) console.log(`  ... und ${warnings.length - 10} weitere`)
}
