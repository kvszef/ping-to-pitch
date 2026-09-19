import { factsFromRaw } from './facts.ts'
import { talkTrackFromRaw } from './talkTrack.ts'
import { ruleText } from './ruleText.ts'
import type { Card, Client, Severity } from '../types.ts'
import { pick, type Lang } from '../../engine/lang.ts'
import { uiLang } from './uiLang.ts'

// Maps one raw client (shape of core-case/portfolio-data/clients.json) to the UI's `Client` with a
// basic, purely factual briefing. It is the offline fallback for uploaded files until the engine
// serves /api/briefing. Pure: no DOM, no network, no wall clock (`now` is passed in).
//
// Rules: explicit null and absent keys both occur, percentages are fractions 0–1, account
// currencies can be crypto tickers, and nothing from AccountPositions except numbers is ever
// copied (account names and IBANs stay out of the output). Unknown fields never throw.
//
// Language: values and sentences are written in `lang` (German when none is passed outside the browser).
// The `label` of a context fact and of a metric stays German in both languages: other code looks facts up
// by it (Stage.tsx: fact('Alter'), fact('ESG-Profil')), and the cards translate labels for display.

type Raw = Record<string, unknown>

const EMPTY = '–'
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,}(?:[ ]?[A-Z0-9]{1,3})?\b/g

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isObj) : [])
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
// Every string that reaches the screen passes through here, so an IBAN typed into a note or a name is masked.
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(IBAN, '[entfernt]').trim() : '')

/** 1240000 → "1'240'000.00" */
export function formatAmount(value: number, decimals = 2): string {
  const [int, frac] = Math.abs(value).toFixed(decimals).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "'")
  return `${value < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`
}

/** Fraction 0–1 → "12.3%" */
export const formatShare = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`

/** ISO date or date-time → "dd.MM.yyyy". Reads the calendar date as written, without time-zone shifts. */
export function formatDate(value: unknown): string {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null
  return m ? `${m[3]}.${m[2]}.${m[1]}` : EMPTY
}

const isoDay = (value: unknown): string => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '')

function ageAt(birthday: unknown, now: Date): number | null {
  const m = typeof birthday === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday) : null
  if (!m || Number.isNaN(now.getTime())) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const hadBirthday = now.getUTCMonth() + 1 > mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() >= d)
  const age = now.getUTCFullYear() - y - (hadBirthday ? 0 : 1)
  return age >= 0 && age < 130 ? age : null
}

const clientTypes: Record<string, string> = { 'Private client': 'Privatkunde', 'Professional client': 'Professioneller Kunde', 'Institutional client': 'Institutioneller Kunde' }
// 'Yes'/'No' alone says nothing on a client card: the value explains itself.
const esgWish: Record<string, { de: string; en: string }> = {
  Yes: { de: 'Nachhaltig anlegen gewünscht', en: 'Wants sustainable investing' },
  No: { de: 'Keine Nachhaltigkeitspräferenz', en: 'No sustainability preference' },
}

function displayName(raw: Raw, ref: string): string {
  const person = [str(raw.FirstName), str(raw.LastName)].filter(Boolean).join(' ')
  return str(raw.Company) || person || ref
}

function violations(raw: Raw, lang: Lang): { severity: Severity; text: string; source: string }[] {
  const t = pick(lang)
  const seen = new Map<string, { severity: Severity; text: string; count: number }>()
  for (const v of list(raw.SuitabilityViolations)) {
    const severity: Severity = v.Severity === 'Error' ? 'risk' : v.Severity === 'Warning' ? 'warn' : 'info'
    const text = ruleText(str(v.RuleCode), lang) || str(v.RuleDescription) || t('Regel ohne Bezeichnung', 'Rule without a name')
    const key = `${severity}|${text}`
    const hit = seen.get(key)
    if (hit) hit.count++
    else seen.set(key, { severity, text, count: 1 })
  }
  const rank: Record<Severity, number> = { risk: 0, warn: 1, info: 2, ok: 3 }
  return [...seen.values()]
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .map((v) => ({ severity: v.severity, text: v.count > 1 ? `${v.text} (${v.count}×)` : v.text, source: t('Regelverletzung', 'Rule violation') }))
}

export function fromRaw(input: unknown, now: Date, lang: Lang = uiLang()): Client {
  const t = pick(lang)
  const raw: Raw = isObj(input) ? input : {}
  const ref = str(raw.ClientRef) || 'UNBEKANNT'
  const portfolios = list(raw.Portfolios)
  const first: Raw = portfolios[0] ?? {}
  const currency = str(raw.ReportingCurrency) || 'CHF'

  const portfolioSum = portfolios.reduce((n, p) => n + num(p.AssetsUnderManagementInDefaultCurrency), 0)
  const aum = num(raw.AssetsUnderManagementInDefaultCurrency) || portfolioSum
  const liquidity = num(raw.LiquidityInDefaultCurrency) || portfolios.reduce((n, p) => n + num(p.LiquidityInDefaultCurrency), 0)
  // Ex-custody portfolios (imported statements from other banks) count in the totals and are labelled as such.
  const external = portfolios.filter((p) => p.isExCustody === true)
  const externalValue = external.reduce((n, p) => n + num(p.AssetsUnderManagementInDefaultCurrency), 0)

  // Largest security position as a share of the client's total: position share × portfolio weight.
  let positions = 0
  let largest = 0
  for (const p of portfolios) {
    const weight = portfolioSum > 0 ? num(p.AssetsUnderManagementInDefaultCurrency) / portfolioSum : portfolios.length === 1 ? 1 : 0
    for (const s of list(p.SecurityPositions)) {
      positions++
      largest = Math.max(largest, num(s.PortfolioValuePercentage) * weight)
    }
  }

  const all = list(raw.SuitabilityViolations)
  const errors = all.filter((v) => v.Severity === 'Error').length
  const warnings = all.filter((v) => v.Severity === 'Warning').length

  const lastProposal = list(raw.Proposals).map((p) => isoDay(p.ProposedDateUTC)).filter(Boolean).sort().pop()

  const notes: { text: string; date: string }[] = []
  for (const n of list(raw.ClientNotes).map((n) => ({ text: str(n.Note), day: isoDay(n.CreatedByDateUTC) })).filter((n) => n.text).sort((a, b) => b.day.localeCompare(a.day))) {
    if (notes.length < 4 && !notes.some((x) => x.text === n.text)) notes.push({ text: n.text, date: formatDate(n.day) })
  }

  const age = ageAt(raw.Birthday, now)
  const typeName = str(raw.RegulatoryClientTypeName)
  const esg = str(raw.EsgProfileName)
  const clientType = lang === 'en' ? typeName : clientTypes[typeName] ?? typeName // the data's own names are English
  const facts = [
    { label: 'Kundentyp', value: clientType },
    { label: 'Kundenprofil', value: str(raw.RiskProfileName) },
    { label: 'ESG-Profil', value: esgWish[esg]?.[lang] ?? esg },
    { label: 'Alter', value: age === null ? '' : t(`${age} Jahre`, `${age} years`) },
    { label: 'Referenzwährung', value: currency },
    { label: 'Portfolios', value: portfolios.length ? `${portfolios.length}${external.length ? t(`, davon ${external.length} Fremddepot (ex-custody)`, `, of which ${external.length} external custody (ex-custody)`) : ''}` : '' },
    { label: 'Letzte Profilierung', value: isoDay(raw.ProfilingDateUtc) ? formatDate(raw.ProfilingDateUtc) : '' },
    { label: 'Offene Regelverletzungen', value: all.length ? t(`${errors} Fehler, ${warnings} Warnungen`, `${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`) : '' },
  ].filter((f) => f.value)

  const flagItems = violations(raw, lang)
  const clientFacts = factsFromRaw(raw, lang)
  const briefing: Card[] = [
    talkTrackFromRaw(raw, clientFacts, flagItems, now, lang),
    { type: 'metrics', items: [
      { label: 'Vermögen', value: formatAmount(aum, 0), delta: external.length ? t(`${currency}, inkl. Fremddepot ${formatAmount(externalValue, 0)}`, `${currency}, incl. external custody ${formatAmount(externalValue, 0)}`) : currency },
      { label: 'Liquiditätsanteil', value: aum > 0 ? formatShare(liquidity / aum) : EMPTY, delta: aum > 0 ? `${currency} ${formatAmount(liquidity, 0)}` : undefined },
      { label: 'Positionen', value: String(positions), delta: portfolios.length > 1 ? t(`in ${portfolios.length} Portfolios`, `in ${portfolios.length} portfolios`) : undefined },
      { label: 'Grösste Position', value: positions > 0 ? formatShare(largest) : EMPTY, delta: positions > 0 ? t('des Vermögens', 'of the assets') : undefined },
    ] },
    { type: 'flags', title: t('Regelverletzungen', 'Rule violations'), items: flagItems.length ? flagItems : [{ severity: 'ok', text: t('Die Kundendatei enthält keine Regelverletzungen.', 'The client file holds no rule violations.'), source: t('Regelverletzung', 'Rule violation') }] },
    { type: 'context', title: t('Kundenkontext', 'Client context'), facts, changes: [], notes },
  ]

  return {
    ref,
    name: displayName(raw, ref),
    clientType: clientType || EMPTY,
    profile: str(raw.RiskProfileName) || EMPTY,
    portfolioNr: str(first.PortfolioNr) || EMPTY,
    service: str(first.InvestmentServiceName) || EMPTY,
    strategy: str(first.StrategyName) || EMPTY,
    aum: `${currency} ${formatAmount(aum)}`,
    context: errors > 0 ? t('Regelverletzung', 'Rule violation') : warnings > 0 ? t('Warnung', 'Warning') : EMPTY,
    birthday: formatDate(raw.Birthday),
    lastProfiling: formatDate(raw.ProfilingDateUtc),
    lastConsultation: formatDate(lastProposal),
    errors,
    warnings,
    facts: clientFacts,
    briefing,
  }
}

/** Validates the content of an uploaded client file. Returns the raw clients or an error for the advisor, in `lang`. */
export function parseClientFile(text: string, lang: Lang = uiLang()): { ok: true; raw: Raw[] } | { ok: false; error: string } {
  const t = pick(lang)
  let data: unknown
  try { data = JSON.parse(text) } catch { return { ok: false, error: t('Die Datei ist kein gültiges JSON.', 'The file is not valid JSON.') } }
  const items = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.clients) ? data.clients : isObj(data) && 'ClientRef' in data ? [data] : null
  if (!items) return { ok: false, error: t('Die Datei enthält keine Kundenliste (erwartet wird eine Liste wie in clients.json).', 'The file holds no client list (expected is a list as in clients.json).') }
  if (!items.length) return { ok: false, error: t('Die Datei enthält keine Kunden.', 'The file holds no clients.') }
  const bad = items.findIndex((c) => !isObj(c) || !str(c.ClientRef))
  if (bad >= 0) return { ok: false, error: t(`Eintrag ${bad + 1} hat keine Kundennummer (ClientRef).`, `Entry ${bad + 1} has no client number (ClientRef).`) }
  return { ok: true, raw: items as Raw[] }
}
