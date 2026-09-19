// What a client wants from the portfolio, read from the advisor's notes (E2).
//
// Notes come in four kinds: a hard wish ("no fossil fuels"), a soft wish or interest ("more tech"), something
// about the person (tone, E4) and a dated plan (E3). This file reads the first two into a closed menu, so every
// wish maps to something the engine can measure. The ESG profile "Yes" is the same wish in data form.
//
// classifyNote() uses fixed rules that cover every note in today's data, with tolerant patterns for close
// variants (English, some German and French). A note the rules do not know comes back undefined; the server
// may then ask a model to pick a menu item (app/server/ai/wishes.ts) and passes the answer in ctx.wishes.
// A note neither can read is never dropped: the engine reports it as "not checked, please read".
import type { Client } from './data.ts'
import { categoryDe } from './format.ts'
import type { CheckContext } from './types.ts'

export const SECTORS = [
  'Energy', 'Materials', 'Industrials', 'Consumer Discretionary', 'Consumer Staples', 'Health Care',
  'Financials', 'Information Technology', 'Telecommunication Services', 'Utilities', 'Real Estate',
] as const
export type Sector = (typeof SECTORS)[number]
export const INTEREST_MEASURES = ['esg-share', 'sector', 'dividend', 'currency-diversification', 'none'] as const
export type InterestMeasure = (typeof INTEREST_MEASURES)[number]

export type Wish =
  | { type: 'exclude-sector'; sector: Sector; scope: 'any' | 'direct' } // scope 'direct': funds that hold some are fine
  | { type: 'exclude-emerging-markets' }
  | { type: 'exclude-unverifiable'; label: string } // e.g. defense, tobacco: the data has no such category
  | { type: 'keep-cash'; amountChf?: number }
  | { type: 'prefer-chf-hedged' }
  | { type: 'esg-only' }
  | { type: 'interest'; measure: InterestMeasure; sector?: Sector }
  | { type: 'not-a-wish' } // about the person, a plan, or background: E3/E4 read it, not E2

export type NoteReading = { wishes: Wish[]; de: string; by: 'rule' | 'ai' }

// ── rules ────────────────────────────────────────────────────────────────────

const NEG = /\b(no|not|avoid\w*|exclud\w*|without|never|keine?[nrs]?|ohne|vermeid\w*|ausschl\w*|pas|sans|évit\w*|exclu\w*|aucun\w*)\b/i
// Bare German "Öl" is left out on purpose (Speiseöl, Ölbild): such notes go to the model instead of a guess.
const FOSSIL = /fossil|petrol|pétrol|erdöl|\boil\b|\bcoal\b|kohle|charbon/i
const DIRECT = /\bdirect|direkt/i
const EM_WORDS = /emerging|schwellenl|émergent/i
const EM_ABBR = /\bEM\b|\bEmMa\b/ // case-sensitive: "em" is a word in German and French
const EM = { test: (t: string) => EM_WORDS.test(t) || EM_ABBR.test(t) }
const DEVELOPED_ONLY = /developed markets only|only developed|nur (in )?industriel|seulement.*développés/i
const DEFENSE = /defen[cs]e|weapon|\barms\b|armament|rüstung|waffe|armement/i
const TOBACCO = /tobacco|tabak|tabac/i
const HUMAN_RIGHTS = /human[- ]rights?|menschenrecht|droits de l.homme|droits humains/i
const ESG = /\besg\b|sustainab|nachhaltig|durable/i
const CASH = /\b(cash|liquid\w*|bargeld|barreserve|reserve|réserve|liquidität|liquidité)\b/i
const KEEP = /\b(keep|hold|on hand|needs?|halten|braucht|benötigt|garder|besoin)\b/i
const CHF_AMOUNT = /\bCHF\s*[\d']/

type Rule = { test: (text: string) => boolean; wishes: (text: string) => Wish[]; de: (text: string) => string }
const rule = (re: { test: (t: string) => boolean }, wishes: Wish[], de: string, negated = false): Rule =>
  ({ test: (t) => re.test(t) && (!negated || NEG.test(t)), wishes: () => wishes, de: () => de })
const swiss = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "'")
function chfAmount(text: string): number | undefined {
  const m = /(?:CHF|Fr\.)\s*([\d'’,.]+)\s*(k\b)?/i.exec(text)
  if (!m) return undefined
  const n = Number(m[1].replace(/['’,]/g, '').replace(/\.(?=\d{3}\b)/g, ''))
  return Number.isFinite(n) && n > 0 ? n * (m[2] ? 1000 : 1) : undefined
}

// Hard wishes: an exclusion or a rule for the whole portfolio. Exclusions need a negation in the note.
const HARD: Rule[] = [
  rule(HUMAN_RIGHTS, [{ type: 'exclude-unverifiable', label: 'Menschenrechts-Kontroversen' }], 'Keine Firmen mit Menschenrechts-Kontroversen', true),
  {
    test: (t) => (DEFENSE.test(t) || TOBACCO.test(t)) && NEG.test(t),
    wishes: (t) => [
      ...(ESG.test(t) ? [{ type: 'esg-only' } as Wish] : []),
      { type: 'exclude-unverifiable', label: [DEFENSE.test(t) ? 'Rüstung' : '', TOBACCO.test(t) ? 'Tabak' : ''].filter(Boolean).join(' und ') },
    ],
    de: (t) => {
      const parts = [DEFENSE.test(t) ? 'keine Rüstung' : '', TOBACCO.test(t) ? 'kein Tabak' : ''].filter(Boolean).join(' und ')
      return ESG.test(t) ? `ESG-konform, ${parts}` : parts.charAt(0).toUpperCase() + parts.slice(1)
    },
  },
  { test: (t) => FOSSIL.test(t) && DIRECT.test(t) && NEG.test(t), wishes: () => [{ type: 'exclude-sector', sector: 'Energy', scope: 'direct' }], de: () => 'Keine direkten Positionen in fossilen Energien' },
  rule(FOSSIL, [{ type: 'exclude-sector', sector: 'Energy', scope: 'any' }], 'Kein Engagement in fossilen Energien', true),
  rule(DEVELOPED_ONLY, [{ type: 'exclude-emerging-markets' }], 'Nur Industrieländer, keine Schwellenländer'),
  rule(EM, [{ type: 'exclude-emerging-markets' }], 'Keine Schwellenländer', true),
  rule(/chf[- ]?hedged|hedged.*\bchf\b|chf[- ]?abgesichert|währungsgesichert|währungsabgesichert|couvert.*chf/i, [{ type: 'prefer-chf-hedged' }], 'Fremdwährungen CHF-abgesichert'),
  rule(/esg[- ]compliant|esg[- ]konform|only (esg|sustainable)|nur nachhaltig|ausschliesslich nachhaltig|uniquement durable/i, [{ type: 'esg-only' }], 'Nur ESG-konforme Anlagen'),
]

// Known notes that are not wishes about holdings (E3/E4 read them). Specific phrases, so they never swallow a wish.
const NOT_A_WISH: RegExp[] = [
  /power of attorney|vollmacht|procuration/i,
  /patient investor|philosophical|simple, disciplined strategy|much to learn|risk-averse|risikoscheu|comfortable with|forward-looking|high-conviction|politely declines/i,
  /risk profile discussed|informed of the risks|open to increasing the equity/i,
  /prefers email|hard to reach|best contacted|not to be contacted|phone contact|unannounced visits|written summary|written correspondence|discretion/i,
  /follow-up call before|standing order|dauerauftrag/i,
  /change of address|adresswechsel|\bretire|pensionierung|buy a property|immobilienkauf|inheritance|erbschaft|charitable donation|spende|estate and succession|nachlass|succession planning|nachfolge/i,
  /comparison against the benchmark|transaction fees|gebühren|annual review meeting|jahresgespräch/i,
  /long-time small holder|consolidating multiple accounts|konten zusammen|car-wash|settle smaller amounts in cash/i,
]

// A cash reserve: "keep a reserve on hand", "needs CHF 15,000 liquid".
const KEEP_CASH: Rule = {
  test: (t) => CASH.test(t) && KEEP.test(t),
  wishes: (t) => { const amountChf = chfAmount(t); return [amountChf ? { type: 'keep-cash', amountChf } : { type: 'keep-cash' }] },
  de: (t) => { const a = chfAmount(t); return a ? `Braucht rund CHF ${swiss(a)} flüssig` : 'Will eine Barreserve halten' },
}

// Soft wishes: interests the advisor can serve. Checked after the non-wish phrases.
const SOFT: Rule[] = [
  rule(/sustainab|nachhaltig|durable|\besg\b/i, [{ type: 'interest', measure: 'esg-share' }], 'Möglichst viele nachhaltige Anlagen'),
  rule(/dividend|dividende|ausschüttung/i, [{ type: 'interest', measure: 'dividend' }], 'Fokus auf Dividendentitel für laufendes Einkommen'),
  rule(/technolog|tech stocks|tech-aktien/i, [{ type: 'interest', measure: 'sector', sector: 'Information Technology' }], 'Technologietitel ausbauen'),
  rule(/space|aerospace|raumfahrt|aérospatial|luftfahrt/i, [{ type: 'interest', measure: 'sector', sector: 'Industrials' }], 'Mehr Luft- und Raumfahrt'),
  rule(/pharma|chemi|biotech|health ?care/i, [{ type: 'interest', measure: 'sector', sector: 'Health Care' }], 'Interesse an Chemie und Pharma'),
  rule(/(diversif|streu).*(currenc|währung|devise)|(currenc|währung|devise).*(diversif|streu)/i, [{ type: 'interest', measure: 'currency-diversification' }], 'Breitere Streuung über Währungen'),
  rule(/small ?-?caps?|nebenwerte/i, [{ type: 'interest', measure: 'none' }], 'Mehr Schweizer Nebenwerte'),
  rule(/structured products?|strukturierte produkte|produits structurés/i, [{ type: 'interest', measure: 'none' }], 'Interesse an strukturierten Produkten'),
  KEEP_CASH,
]

/** Reads one note. Undefined when neither a wish rule nor a known non-wish phrase matches. */
export function classifyNote(text: string): NoteReading | undefined {
  const t = text.trim()
  if (!t) return undefined
  const read = (r: Rule): NoteReading => ({ wishes: r.wishes(t), de: r.de(t), by: 'rule' })
  const hard = HARD.find((r) => r.test(t))
  if (hard) return read(hard)
  // A CHF amount to keep liquid is a cash wish even when the note also names a plan (the Q1 tax payment).
  if (CHF_AMOUNT.test(t) && KEEP_CASH.test(t)) return read(KEEP_CASH)
  if (NOT_A_WISH.some((re) => re.test(t))) return { wishes: [{ type: 'not-a-wish' }], de: t, by: 'rule' }
  const soft = SOFT.find((r) => r.test(t))
  return soft ? read(soft) : undefined
}

// ── the menu as data: validation and German labels ───────────────────────────

const isSector = (v: unknown): v is Sector => typeof v === 'string' && (SECTORS as readonly string[]).includes(v)

/** Strict check of a menu item from outside (a model answer). Anything off the menu is undefined. */
export function parseWish(v: unknown): Wish | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const w = v as Record<string, unknown>
  const only = (...allowed: string[]) => Object.keys(w).every((k) => k === 'type' || allowed.includes(k))
  switch (w.type) {
    case 'exclude-sector':
      return only('sector', 'scope') && isSector(w.sector) && (w.scope === 'any' || w.scope === 'direct') ? { type: 'exclude-sector', sector: w.sector, scope: w.scope } : undefined
    case 'exclude-unverifiable': {
      const label = typeof w.label === 'string' ? w.label.trim() : ''
      return only('label') && label && label.length <= 60 && !/[\d<>{}]/.test(label) ? { type: 'exclude-unverifiable', label } : undefined
    }
    case 'keep-cash': {
      if (!only('amountChf')) return undefined
      if (w.amountChf === undefined || w.amountChf === null) return { type: 'keep-cash' }
      return typeof w.amountChf === 'number' && Number.isFinite(w.amountChf) && w.amountChf > 0 && w.amountChf < 1e10 ? { type: 'keep-cash', amountChf: w.amountChf } : undefined
    }
    case 'interest': {
      if (!only('measure', 'sector') || !(INTEREST_MEASURES as readonly string[]).includes(String(w.measure))) return undefined
      const measure = w.measure as InterestMeasure
      if (measure === 'sector') return isSector(w.sector) ? { type: 'interest', measure, sector: w.sector } : undefined
      return w.sector === undefined || w.sector === null ? { type: 'interest', measure } : undefined
    }
    case 'exclude-emerging-markets': case 'prefer-chf-hedged': case 'esg-only': case 'not-a-wish':
      return only() ? { type: w.type } : undefined
    default:
      return undefined
  }
}

/** Short German label, used for wishes the model classified (the rules carry their own wording). */
export function wishLabel(w: Wish): string {
  switch (w.type) {
    case 'exclude-sector':
      if (w.sector === 'Energy') return w.scope === 'direct' ? 'Keine direkten Positionen in fossilen Energien' : 'Kein Engagement in fossilen Energien'
      return `Keine ${w.scope === 'direct' ? 'Direktanlagen' : 'Anlagen'} im Sektor ${categoryDe(w.sector)}`
    case 'exclude-emerging-markets': return 'Keine Schwellenländer'
    case 'exclude-unverifiable': return `Keine ${w.label}`
    case 'keep-cash': return w.amountChf ? `Braucht rund CHF ${swiss(w.amountChf)} flüssig` : 'Will eine Barreserve halten'
    case 'prefer-chf-hedged': return 'Fremdwährungen CHF-abgesichert'
    case 'esg-only': return 'Nur ESG-konforme Anlagen'
    case 'interest':
      return w.measure === 'esg-share' ? 'Mehr nachhaltige Anlagen' : w.measure === 'sector' ? `Mehr ${categoryDe(w.sector ?? '')}`
        : w.measure === 'dividend' ? 'Mehr Dividendentitel' : w.measure === 'currency-diversification' ? 'Breitere Streuung über Währungen' : 'Interesse laut Notiz'
    case 'not-a-wish': return ''
  }
}

// ── the client's wishes, for the checks ──────────────────────────────────────

export type WishNote = { text: string; date?: string }
export type ClientWish = { wish: Wish; de: string; by: NoteReading['by']; note: WishNote }

/** Every note of the client: its wishes (rules first, then the server's AI answer) and the notes nobody could read. */
export function wishesOf(client: Client, ctx: Pick<CheckContext, 'wishes'>): { wishes: ClientWish[]; unread: WishNote[] } {
  const wishes: ClientWish[] = [], unread: WishNote[] = []
  for (const note of client.notes) {
    const rule = classifyNote(note.text)
    const ai = rule ? undefined : ctx.wishes?.[note.text.trim()]
    const reading: NoteReading | undefined = rule ?? (ai && ai !== 'unknown' ? { wishes: [ai], de: wishLabel(ai), by: 'ai' } : undefined)
    if (!reading) { unread.push(note); continue }
    for (const wish of reading.wishes) if (wish.type !== 'not-a-wish') wishes.push({ wish, de: reading.de, by: reading.by, note })
  }
  return { wishes, unread }
}
