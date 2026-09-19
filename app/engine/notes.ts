// Plan notes: the advisor's free-text notes that describe something in the future (a property purchase,
// retirement, a tax payment, ...). The case data uses a fixed set of English sentences; each known plan
// sentence gets a label, a time window and the question to ask once the window has passed, in German and English.
// Ported from server/ai/notes.ts (the stopgap's note reader); the engine must not import from server.
// Pure: no clock, no I/O.
import { sourceName, type Lang } from './lang.ts'

export type PlanRule = {
  re: RegExp
  label: string // short German name, the part before ':' in a title ('Pensionierung')
  de: string // German summary for the advisor, third person
  question: string // what to ask the client (Sie form) when the note may be outdated
  labelEn: string // the same three in English; read them through planLabel/planSummary/planQuestion
  en: string
  questionEn: string
  horizonMonths?: number // the plan runs out this many months after the note was written; undefined = open-ended
  topic: string // 'liquidity' when the plan needs money
}

export const PLAN_RULES: PlanRule[] = [
  { re: /buy a property, possible liquidity need within the next 12 months/i, label: 'Immobilienkauf', horizonMonths: 12, topic: 'liquidity', de: 'Plant einen Immobilienkauf, Liquiditätsbedarf innert 12 Monaten', question: 'Ist Ihr Immobilienkauf inzwischen erfolgt, oder ist er noch geplant?',
    labelEn: 'Property purchase', en: 'Plans to buy a property, liquidity need within 12 months', questionEn: 'Has your property purchase gone through by now, or is it still planned?' },
  { re: /retire in the next two years/i, label: 'Pensionierung', horizonMonths: 24, topic: 'liquidity', de: 'Pensionierung in den nächsten zwei Jahren, steigender Liquiditätsbedarf', question: 'Steht Ihr Pensionierungsdatum fest, und wie viel Liquidität brauchen Sie dann?',
    labelEn: 'Retirement', en: 'Retirement within the next two years, rising liquidity need', questionEn: 'Is your retirement date fixed, and how much liquidity will you need then?' },
  { re: /CHF 15,000 in liquid funds for the Q1 tax/i, label: 'Steuerzahlung', horizonMonths: 6, topic: 'liquidity', de: "Braucht rund CHF 15'000 flüssig für die Steuerzahlung im ersten Quartal", question: "Ist die Steuerzahlung erledigt, oder brauchen Sie die CHF 15'000 noch?",
    labelEn: 'Tax payment', en: "Needs about CHF 15'000 in liquid funds for the tax payment in the first quarter", questionEn: "Has the tax payment been made, or do you still need the CHF 15'000?" },
  { re: /change of address next year/i, label: 'Adresswechsel', horizonMonths: 18, topic: 'admin', de: 'Möglicher Adresswechsel, Kontoangaben dann bestätigen', question: 'Hat sich Ihre Adresse inzwischen geändert?',
    labelEn: 'Change of address', en: 'Possible change of address, confirm the account details then', questionEn: 'Has your address changed in the meantime?' },
  { re: /expects an inheritance/i, label: 'Erbe', topic: 'strategy', de: 'Erwartet ein Erbe, Strategie dann überprüfen', question: 'Gibt es beim erwarteten Erbe etwas Neues?',
    labelEn: 'Inheritance', en: 'Expects an inheritance, review the strategy then', questionEn: 'Is there any news on the expected inheritance?' },
  { re: /charitable donation/i, label: 'Spende', topic: 'liquidity', de: 'Erwägt eine Spende aus dem Portfolio, Details offen', question: 'Ist die Spende aus dem Portfolio noch ein Thema für Sie?',
    labelEn: 'Donation', en: 'Considering a donation from the portfolio, details open', questionEn: 'Is the donation from the portfolio still on your mind?' },
  { re: /health concerns .* estate and succession/i, label: 'Nachlassplanung', topic: 'estate', de: 'Gesundheitliche Gründe: Nachlass- und Nachfolgeplanung wird überprüft', question: 'Wie weit ist Ihre Nachlassplanung?',
    labelEn: 'Estate planning', en: 'Health reasons: estate and succession planning is under review', questionEn: 'How far along is your estate planning?' },
  { re: /succession planning within the company/i, label: 'Nachfolge im Unternehmen', topic: 'admin', de: 'Nachfolgeregelung im Unternehmen läuft, Ansprechperson kann wechseln', question: 'Sind Sie weiterhin unsere Ansprechperson?',
    labelEn: 'Company succession', en: 'Succession planning in the company is under way, the contact person may change', questionEn: 'Are you still our contact person?' },
  // General forms, after the exact phrases of the case data: a client file handed over at the demo words its notes
  // differently. The deadline comes from the note itself when it names one (horizonIn), else the default here.
  { re: /\b(buy|buying|purchase|purchasing|acquire|acquiring)\b[^.]{0,40}\b(property|house|home|apartment|flat|chalet|real estate)\b/i, label: 'Immobilienkauf', horizonMonths: 12, topic: 'liquidity', de: 'Plant einen Immobilienkauf, Liquiditätsbedarf absehbar', question: 'Ist Ihr Immobilienkauf inzwischen erfolgt, oder ist er noch geplant?',
    labelEn: 'Property purchase', en: 'Plans to buy a property, a liquidity need is foreseeable', questionEn: 'Has your property purchase gone through by now, or is it still planned?' },
  { re: /\b(plans?|planning|intends?|wants?|going|expects?) to retire\b|\bretir(e|ing|ement) (in|within|next|at the end)\b/i, label: 'Pensionierung', horizonMonths: 24, topic: 'liquidity', de: 'Pensionierung steht bevor, steigender Liquiditätsbedarf', question: 'Steht Ihr Pensionierungsdatum fest, und wie viel Liquidität brauchen Sie dann?',
    labelEn: 'Retirement', en: 'Retirement is coming up, rising liquidity need', questionEn: 'Is your retirement date fixed, and how much liquidity will you need then?' },
]

export type PlanNote = PlanRule & { quote: string; date: string; amount?: number }

// The advisor-facing texts of a plan in the display language. Ids and keys always use the German label.
type PlanTexts = Pick<PlanRule, 'label' | 'de' | 'question' | 'labelEn' | 'en' | 'questionEn'>
export const planLabel = (p: PlanTexts, lang?: Lang) => (lang === 'en' ? p.labelEn : p.label)
export const planSummary = (p: PlanTexts, lang?: Lang) => (lang === 'en' ? p.en : p.de)
export const planQuestion = (p: PlanTexts, lang?: Lang) => (lang === 'en' ? p.questionEn : p.question)

/** The plan rule a note matches, or undefined for notes that are not about a plan. */
export function readPlan(quote: string, date: string): PlanNote | undefined {
  const rule = PLAN_RULES.find((r) => r.re.test(quote))
  if (!rule) return undefined
  // A deadline the note names wins over the rule's default, but only for rules that have a deadline at all.
  const horizonMonths = rule.horizonMonths === undefined ? undefined : horizonIn(quote) ?? rule.horizonMonths
  return { ...rule, horizonMonths, quote, date, amount: amountIn(quote) }
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, nine: 9, twelve: 12, eighteen: 18 }
/** 'within the next 6 months' → 6, 'in two years' → 24. Undefined when the note names no time span. */
export function horizonIn(text: string): number | undefined {
  const m = /\b(?:within|in|over)(?: the)?(?: next| coming)? (\d{1,2}|one|two|three|four|five|six|nine|twelve|eighteen) (month|year)s?\b/i.exec(text)
  if (!m) return undefined
  const n = NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1])
  return Number.isFinite(n) && n > 0 ? (m[2].toLowerCase() === 'year' ? n * 12 : n) : undefined
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

export const noteEvidence = (n: { quote: string; date: string }, lang?: Lang) => ({ source: sourceName('note', lang), quote: n.quote, ...(n.date ? { date: n.date } : {}) })
