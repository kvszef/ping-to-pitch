// Ex-custody import (N3), optional step: position lines the rules could not read go to a model.
//
// Only those lines are sent, after scrub() removes IBANs, depot numbers and anything after "Kunde".
// Headers, addresses and names never leave the server. Every number the model returns must appear
// verbatim in the line it names; otherwise the position is rejected as unverified and not imported.
// No model, no key or an error: the rules result stands on its own.

import { parseNumber, scrub, type ParsedPosition, type SectionClass } from './statement.ts'

type Message = { role: 'system' | 'user'; content: string }
export type Complete = (messages: Message[]) => Promise<unknown>

const RULES = `You read single position lines from a bank portfolio statement. For each line, return what is written in it, never more.
Fields: i (line index), currency (3-5 letter code written at the start or next to the amount), quantity, name (security name only),
isin (12 characters, only if written), value (market value in the statement currency, usually the second-to-last number),
weightPercent (share in percent, the number before %). Copy numbers exactly as written in the line. Skip a line that is not a position.
Answer with one JSON object: {"positions":[{"i":0,"currency":"CHF","quantity":"1'000","name":"...","isin":"CH...","value":"12'345","weightPercent":"1.23"}]}`

export type AssistResult = { positions: ParsedPosition[]; unverified: { line: string; reason: string }[] }

// A number counts as verified when its digits appear in the line as written (apostrophes ignored).
const digitsOf = (s: string) => s.replace(/['’\s]/g, '')
function inLine(line: string, raw: unknown): number | undefined {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : undefined
  const n = parseNumber(text?.replace(/\s/g, ''))
  if (text === undefined || n === undefined) return undefined
  const tokens = line.split(/\s+/).map(digitsOf)
  return tokens.includes(digitsOf(text)) ? n : undefined
}

export async function assistUnparsed(lines: string[], complete: Complete, section = 'Unbekannt', sectionClass: SectionClass = 'Unknown'): Promise<AssistResult> {
  const scrubbed = lines.map(scrub).slice(0, 40)
  if (!scrubbed.length) return { positions: [], unverified: [] }
  const answer = await complete([
    { role: 'system', content: RULES },
    { role: 'user', content: `LINES:\n${JSON.stringify(scrubbed.map((text, i) => ({ i, text })))}` },
  ])
  const items = typeof answer === 'object' && answer !== null && Array.isArray((answer as { positions?: unknown }).positions) ? (answer as { positions: unknown[] }).positions : []
  const positions: ParsedPosition[] = []
  const unverified: AssistResult['unverified'] = []
  const used = new Set<number>()
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const x = item as Record<string, unknown>
    const i = typeof x.i === 'number' && Number.isInteger(x.i) ? x.i : -1
    const line = scrubbed[i]
    if (line === undefined || used.has(i)) continue
    used.add(i)
    const currency = typeof x.currency === 'string' && /^[A-Z]{3,5}$/.test(x.currency) && line.split(/\s+/).includes(x.currency) ? x.currency : undefined
    const isin = typeof x.isin === 'string' && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(x.isin) && line.includes(x.isin) ? x.isin : undefined
    const name = typeof x.name === 'string' && x.name.trim() && line.includes(x.name.trim()) ? x.name.trim() : undefined
    const quantity = inLine(line, x.quantity), value = inLine(line, x.value), pct = inLine(line.replace(/%/g, ' %'), x.weightPercent)
    const missing = [!currency && 'Währung', !name && 'Name', quantity === undefined && 'Stückzahl', value === undefined && 'Marktwert', pct === undefined && 'Anteil'].filter(Boolean)
    if (missing.length) { unverified.push({ line, reason: `nicht im Text belegt: ${missing.join(', ')}` }); continue }
    positions.push({ kind: 'security', section, sectionClass, currency: currency!, quantity: quantity!, name: name!, isin, value: value!, weight: Math.round(pct! * 100) / 10_000, line: -1 })
  }
  return { positions, unverified }
}
