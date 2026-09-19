// Ex-custody import (N3), step 1: statement text → positions. Pure: no I/O, no clock.
//
// Input is the text of a portfolio statement from another bank, one string per page (pdf-text.ts).
// Rules first: a position line starts with its currency and quantity and ends with market value and
// share ("USD 570 Akt Amazon.com Inc. 2 000 654 / US0231351067 202.27 235.64 31.12.25 114'638 5.59 %").
// Section headers above the lines ("Obligationen", "Aktien", ...) give the asset class.
//
// Privacy: the statement carries the client's name, address, depot number and IBANs. None of it is kept.
// Account lines keep only their currency; the IBAN is dropped at parse time. Header lines are read for
// the bank name, currency, date and stated total only.

export type SectionClass = 'Liquidity' | 'Bonds' | 'Shares' | 'Real estate' | 'Alternative' | 'Unknown'

export type ParsedPosition = {
  kind: 'security' | 'account'
  section: string // the statement's own section header, e.g. 'Obligationen'
  sectionClass: SectionClass
  currency: string // ISO code or crypto ticker as printed
  quantity: number // pieces or nominal; for accounts the balance in account currency
  name: string // accounts: 'Konto <CCY>' (never the IBAN)
  isin?: string
  price?: number // market price in position currency
  cost?: number // purchase price ("Einstand")
  value: number // market value in the statement's reference currency
  weight: number // share of the statement total, fraction 0–1 (as printed)
  line: number // index into `lines` of the parse, for the audit trail
}

export type StatementTotal = { label: string; value: number; weight?: number }

export type ParsedStatement = {
  bank?: string // custodian, from the first line of the statement
  currency: string // reference currency of the values
  asOf?: string // valuation date, yyyy-mm-dd
  mandate?: string // mandate name as printed, e.g. 'Ausgewogen'
  statedTotal?: number // total assets as printed on the statement
  sectionTotals: StatementTotal[] // "Total Obligationen 616'368 30.07 %"
  positions: ParsedPosition[]
  // Lines inside the position table that look like positions (carry an ISIN or end in "… %") but did not
  // match the rules. They go to the optional model step after scrubbing, never anywhere else.
  unparsed: string[]
}

// ── numbers and identifiers ──────────────────────────────────────────────────

/** Swiss number format: 2'049'658 · 67'589.35 · -5.91. Also accepts ’ and thin spaces as grouping. */
export function parseNumber(s: string | undefined): number | undefined {
  if (!s) return undefined
  const t = s.replace(/['’  ]/g, '').replace(/^\+/, '')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** ISIN check digit (Luhn over the letters expanded to numbers). Filters out look-alikes. */
export function isIsin(s: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(s)) return false
  const digits = s.slice(0, 11).split('').map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join('')
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return (10 - (sum % 10)) % 10 === Number(s[11])
}

const ISIN_ANY = /\b[A-Z]{2}[A-Z0-9]{9}\d\b/g
const ISIN_ONE = /\b[A-Z]{2}[A-Z0-9]{9}\d\b/
// IBAN as printed in groups of four ("CH46 0483 5012 3456 7873 9") or in one block. At least 15
// characters, which keeps 12-character ISINs out.
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:(?: [A-Z0-9]{4}){3,7}(?: [A-Z0-9]{1,3})?|[A-Z0-9]{11,30})\b/g
const ibans = (s: string) => [...s.matchAll(IBAN_RE)].map((m) => m[0])
const NUM = String.raw`-?\d{1,3}(?:['’]\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?`
const DATE_SHORT = /\b(\d{2})\.(\d{2})\.(\d{2,4})\b/

// ── sections ─────────────────────────────────────────────────────────────────

const SECTIONS: [RegExp, SectionClass][] = [
  [/^(liquidit|geldmarkt|konten|cash|flüssige)/i, 'Liquidity'],
  [/^(obligationen|anleihen|festverzinslich|bonds|fixed income)/i, 'Bonds'],
  [/^(aktien|beteiligungspapiere|equities|shares)/i, 'Shares'],
  [/^(immobilien|real estate)/i, 'Real estate'],
  [/^(alternative|rohstoffe|edelmetalle|hedge|private equity|übrige|sonstige|strukturierte|commodities)/i, 'Alternative'],
]

function sectionOf(line: string): SectionClass | undefined {
  if (/\d/.test(line) || line.length > 60 || /^total\b/i.test(line)) return undefined
  return SECTIONS.find(([re]) => re.test(line.trim()))?.[1]
}

// ── the parser ───────────────────────────────────────────────────────────────

// <CCY> <qty> <rest …> <value> <pct> %
const POSITION = new RegExp(String.raw`^([A-Z]{3,5}) (${NUM}) (.+?) (${NUM}) (${NUM}) ?%$`)
const TOTAL = new RegExp(String.raw`^Total (.+?) (${NUM}) (${NUM}) ?%$`)

const isoDate = (d: string, m: string, y: string) => `${y.length === 2 ? `20${y}` : y}-${m}-${d}`

function readSecurity(rest: string): { name: string; isin?: string; cost?: number; price?: number } {
  // Check digit not required: statements (and the fictitious samples) carry ISINs that fail it. The report flags them.
  const isins = [...rest.matchAll(ISIN_ANY)]
  const hit = isins[0]
  if (!hit || hit.index === undefined) return { name: rest.trim() }
  // Before the ISIN: name, then optionally "Valor /". After it: cost, price, price date.
  // Valor as "2 000 654" or "912828"; a maturity like "2023-2028" right before it stays in the name.
  const name = rest.slice(0, hit.index).replace(/(?:\s+(?:\d{1,3}(?: \d{3})*|\d{4,9}))?\s*\/\s*$/, '').trim()
  const after = rest.slice(hit.index + hit[0].length).replace(DATE_SHORT, ' ').trim().split(/\s+/).map(parseNumber).filter((n): n is number => n !== undefined)
  return { name, isin: hit[0], cost: after.length >= 2 ? after[0] : undefined, price: after.length >= 2 ? after[1] : after[0] }
}

/** Parses statement pages. Never throws; an unreadable statement comes back with no positions. */
export function parseStatement(pages: string[]): ParsedStatement {
  const lines = pages.flatMap((p) => p.split(/\r?\n/)).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const all = lines.join('\n')

  const currency = /Referenzw(?:ä|ae)hrung:? ([A-Z]{3})\b/i.exec(all)?.[1] ?? /Reference currency:? ([A-Z]{3})\b/i.exec(all)?.[1] ?? /\bin ([A-Z]{3})\b/.exec(all)?.[1] ?? 'CHF'
  const dateHit = /Stichtag(?: Bewertung)?:? (\d{2})\.(\d{2})\.(\d{4})/i.exec(all) ?? /\bper (\d{2})\.(\d{2})\.(\d{4})/i.exec(all)
  const mandate = /Mandat:? [«"„]([^»"“]+)[»"“]/.exec(all)?.[1]?.trim()
  const statedHead = parseNumber(new RegExp(String.raw`Vermögen per Stichtag:? [A-Z]{3} (${NUM})`).exec(all)?.[1])
  const bank = lines[0] && !/\d/.test(lines[0]) && /\b(AG|SA|Bank|Banque|Privatbank|Kantonalbank|Ltd|GmbH)\b/i.test(lines[0]) ? lines[0] : undefined

  // Only the position table: from "Detailpositionen"/"Vermögensaufstellung" to the next big chapter.
  // A statement without such a heading is read whole; the "… %" line ending keeps transactions out.
  const start = lines.findIndex((l) => /^(Detailpositionen|Vermögensaufstellung|Positionsübersicht|Depotauszug|Positionen)\b/i.test(l))
  const stop = (i: number) => /^(Transaktionen|Buchungen|Erläuterungen|Glossar)\b/i.test(lines[i])

  const positions: ParsedPosition[] = []
  const sectionTotals: StatementTotal[] = []
  const unparsed: string[] = []
  let section = '', sectionClass: SectionClass = 'Unknown'
  let statedTotal: number | undefined

  for (let i = Math.max(0, start); i < lines.length; i++) {
    if (start >= 0 && i > start && stop(i)) break
    const line = lines[i]
    const sc = sectionOf(line)
    if (sc) { section = line; sectionClass = sc; continue }

    const total = TOTAL.exec(line)
    if (total) {
      const t = { label: total[1], value: parseNumber(total[2]) ?? 0, weight: (parseNumber(total[3]) ?? 0) / 100 }
      if (/^(Vermögen|Gesamtvermögen|Portfolio|Depot)$/i.test(t.label)) statedTotal ??= t.value
      else sectionTotals.push(t)
      continue
    }

    const m = POSITION.exec(line)
    if (!m) {
      if (start >= 0 && (/\d ?%$/.test(line) || ISIN_ONE.test(line))) unparsed.push(line)
      continue
    }
    const [, ccy, qty, rest, value, pctText] = m
    const quantity = parseNumber(qty), mv = parseNumber(value), pct = parseNumber(pctText)
    if (quantity === undefined || mv === undefined || pct === undefined) { unparsed.push(line); continue }

    const isAccount = ibans(rest).length > 0 || /\b(konto|account|kontokorrent)\b/i.test(rest)
    if (isAccount) {
      positions.push({ kind: 'account', section, sectionClass, currency: ccy, quantity, name: `Konto ${ccy}`, value: mv, weight: Math.round(pct * 100) / 10_000, line: i })
      continue
    }
    const s = readSecurity(rest)
    if (!s.isin) { unparsed.push(line); continue }
    positions.push({ kind: 'security', section, sectionClass, currency: ccy, quantity, name: s.name || s.isin, isin: s.isin, price: s.price, cost: s.cost, value: mv, weight: Math.round(pct * 100) / 10_000, line: i })
  }

  return {
    bank, currency, asOf: dateHit ? isoDate(dateHit[1], dateHit[2], dateHit[3]) : undefined, mandate,
    statedTotal: statedTotal ?? statedHead, sectionTotals, positions, unparsed,
  }
}

/** Removes what could identify the client from a line: IBANs, long digit runs (account/depot numbers), names after "Kunde". */
export function scrub(line: string): string {
  let out = line
  for (const iban of ibans(line)) out = out.split(iban).join('[IBAN]')
  return out
    .replace(/\b(?:Kunde|Kundin|Inhaber|Client|Herr|Frau|Familie|Depot-Nr|Konto-Nr)\b.*$/i, '[entfernt]')
    .replace(/\b\d{4}\.\d{4}\.\d{4}\b/g, '[Nr]')
}
