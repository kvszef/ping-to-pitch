// Plan notes: the advisor's free-text notes that describe something in the future (a property purchase,
// retirement, a tax payment, ...). The case data uses a fixed set of English sentences; each known plan
// sentence gets a German label, a time window and the question to ask once the window has passed.
// Ported from server/ai/notes.ts (the stopgap's note reader); the engine must not import from server.
// Pure: no clock, no I/O.

export type PlanRule = {
  re: RegExp
  label: string // short German name, the part before ':' in a title ('Pensionierung')
  de: string // German summary for the advisor, third person
  question: string // what to ask the client (Sie form) when the note may be outdated
  horizonMonths?: number // the plan runs out this many months after the note was written; undefined = open-ended
  topic: string // 'liquidity' when the plan needs money
}

export const PLAN_RULES: PlanRule[] = [
  { re: /buy a property, possible liquidity need within the next 12 months/i, label: 'Immobilienkauf', horizonMonths: 12, topic: 'liquidity', de: 'Plant einen Immobilienkauf, Liquiditätsbedarf innert 12 Monaten', question: 'Ist Ihr Immobilienkauf inzwischen erfolgt, oder ist er noch geplant?' },
  { re: /retire in the next two years/i, label: 'Pensionierung', horizonMonths: 24, topic: 'liquidity', de: 'Pensionierung in den nächsten zwei Jahren, steigender Liquiditätsbedarf', question: 'Steht Ihr Pensionierungsdatum fest, und wie viel Liquidität brauchen Sie dann?' },
  { re: /CHF 15,000 in liquid funds for the Q1 tax/i, label: 'Steuerzahlung', horizonMonths: 6, topic: 'liquidity', de: "Braucht rund CHF 15'000 flüssig für die Steuerzahlung im ersten Quartal", question: "Ist die Steuerzahlung erledigt, oder brauchen Sie die CHF 15'000 noch?" },
  { re: /change of address next year/i, label: 'Adresswechsel', horizonMonths: 18, topic: 'admin', de: 'Möglicher Adresswechsel, Kontoangaben dann bestätigen', question: 'Hat sich Ihre Adresse inzwischen geändert?' },
  { re: /expects an inheritance/i, label: 'Erbe', topic: 'strategy', de: 'Erwartet ein Erbe, Strategie dann überprüfen', question: 'Gibt es beim erwarteten Erbe etwas Neues?' },
  { re: /charitable donation/i, label: 'Spende', topic: 'liquidity', de: 'Erwägt eine Spende aus dem Portfolio, Details offen', question: 'Ist die Spende aus dem Portfolio noch ein Thema für Sie?' },
  { re: /health concerns .* estate and succession/i, label: 'Nachlassplanung', topic: 'estate', de: 'Gesundheitliche Gründe: Nachlass- und Nachfolgeplanung wird überprüft', question: 'Wie weit ist Ihre Nachlassplanung?' },
  { re: /succession planning within the company/i, label: 'Nachfolge im Unternehmen', topic: 'admin', de: 'Nachfolgeregelung im Unternehmen läuft, Ansprechperson kann wechseln', question: 'Sind Sie weiterhin unsere Ansprechperson?' },
]

export type PlanNote = PlanRule & { quote: string; date: string; amount?: number }

/** The plan rule a note matches, or undefined for notes that are not about a plan. */
export function readPlan(quote: string, date: string): PlanNote | undefined {
  const rule = PLAN_RULES.find((r) => r.re.test(quote))
  return rule ? { ...rule, quote, date, amount: amountIn(quote) } : undefined
}

/** 'Needs approximately CHF 15,000 …' → 15000. Only CHF amounts; undefined when the note names none. */
export function amountIn(text: string): number | undefined {
  const m = /CHF\s*([\d][\d,'’]*)/i.exec(text)
  if (!m) return undefined
  const n = Number(m[1].replace(/[,'’]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Adds whole months to an ISO date, UTC. */
export function addMonths(iso: string, months: number): Date {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

/** Full months between two dates, rounded down, never negative. */
export function monthsBetween(from: Date, to: Date): number {
  const m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth() - (to.getUTCDate() < from.getUTCDate() ? 1 : 0)
  return Math.max(0, m)
}

// A plan note without its own time window counts as possibly outdated after this long. Our judgement.
export const OPEN_PLAN_STALE_MONTHS = 12

export type PlanWindow = PlanNote & {
  key: string // unique per client: date plus label, for finding ids
  ageMonths?: number
  due?: string // yyyy-MM-dd, when the time window ends; undefined for open-ended plans
  expired: boolean
  monthsLeft?: number
  overdueMonths?: number
}

const slug = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Every plan note with its time window measured against `now`, newest note first. */
export function planWindows(notes: { text: string; date?: string }[], now: Date): PlanWindow[] {
  const out: PlanWindow[] = []
  const keys = new Set<string>()
  const sorted = [...notes].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  for (const n of sorted) {
    const date = n.date && /^\d{4}-\d{2}-\d{2}$/.test(n.date) ? n.date : undefined
    const plan = readPlan(n.text, date ?? '')
    if (!plan) continue
    let key = `${date ?? 'undatiert'}:${slug(plan.label)}`
    for (let i = 2; keys.has(key); i++) key = `${date ?? 'undatiert'}:${slug(plan.label)}-${i}`
    keys.add(key)
    if (!date) { out.push({ ...plan, key, expired: false }); continue }
    const ageMonths = monthsBetween(new Date(`${date}T00:00:00Z`), now)
    if (plan.horizonMonths === undefined) { out.push({ ...plan, key, ageMonths, expired: ageMonths >= OPEN_PLAN_STALE_MONTHS }); continue }
    const due = addMonths(date, plan.horizonMonths)
    const expired = due.getTime() < now.getTime()
    out.push({
      ...plan, key, ageMonths, due: due.toISOString().slice(0, 10), expired,
      monthsLeft: expired ? undefined : monthsBetween(now, due), overdueMonths: expired ? monthsBetween(due, now) : undefined,
    })
  }
  return out
}

export const noteEvidence = (n: { quote: string; date: string }) => ({ source: 'Kundennotiz', quote: n.quote, ...(n.date ? { date: n.date } : {}) })
