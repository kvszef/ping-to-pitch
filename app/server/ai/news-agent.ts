// News agent (N2): live headlines for the biggest holdings of one client.
//   GET /api/news-agent?ref=CASE-012&lang=de|en  →  { items: NewsAgentItem[], fetchedAt, errors? }
//   `lang` (absent = English) decides the language of what we write about an item (position line, the model's
//   "why"). Headlines are data and never translated; the search itself stays on the Swiss German editions.
//
// Sources: Google News RSS (Swiss German edition, English as fallback for US names), Bing News RSS
// (de-CH; answers when Google rate-limits us) and Yahoo Finance RSS for the few tickers we know for sure.
// All free and keyless. Only security names, index
// names and currency pairs leave the server; never client names, IBANs or account names.
// With a model configured, one call per refresh classifies tone and writes one line per item (in the language);
// without one the items still arrive, just without tone and "why".
// Items carry the UI's NewsItem shape (src/types.ts) plus the raw fields, so N1 can adopt the fetchers.

import { langOf, pick, type Lang } from '../../engine/lang.ts'
import type { Llm } from './briefing-route.ts'
import { loadData } from '../database.ts'
import type { NewsAgentItem, NewsAgentResult, Tone } from './news-agent-types.ts'

type Provider = 'openai' | 'apertus'
type Message = { role: 'system' | 'user'; content: string }
type Raw = Record<string, unknown>

export type { NewsAgentItem, NewsAgentResult, Tone }
type Severity = NewsAgentItem['affects'][string]['severity']
type Reach = NewsAgentItem['reach']

/** What we search for. `kind` decides the NewsItem reach. */
export type SearchTerm = { security: string; query: string; weight: number; kind: 'titel' | 'thema' | 'markt'; ticker?: string; named?: string[] }

export type RssItem = { title: string; source: string; url: string; published: string }

// ---- term derivation (pure) ------------------------------------------------------------------------

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((x): x is Raw => typeof x === 'object' && x !== null) : [])

// Cleaned company name → better search name. Only names that occur in the case data.
const ALIAS: Record<string, string> = {
  'Chocoladefabriken Lindt & Spruengli': 'Lindt & Sprüngli', Nestle: 'Nestlé', 'Amazon.Com': 'Amazon', 'Amazon.com': 'Amazon',
  'Tesla Motors': 'Tesla', 'International Business Machines Corp IBM': 'IBM', 'International Business Machines': 'IBM',
  'CIE FINANCIERE RICHEMONT': 'Richemont', 'INDUSTRIA DE DISENO TEXTIL': 'Inditex', 'Kuehne + Nagel International': 'Kühne+Nagel',
  'Flughafen Zuerich': 'Flughafen Zürich', 'Vereinigte Staaten von Amerika': 'US-Staatsanleihen', 'Zurich Insurance': 'Zurich Insurance',
  'BACHEM': 'Bachem', 'Europaeischer Stabilitaetsmechanismus': 'ESM Rettungsschirm', 'The Walt Disney Company': 'Disney',
  'Baloise-Holding': 'Baloise', 'Roche Holding': 'Roche', VZ: 'VZ Holding', Partners: 'Partners Group', 'Logitech International': 'Logitech', 'The Swatch': 'Swatch',
  TX: 'TX Group', SIG: 'SIG Group', SFS: 'SFS Group', ALSO: 'ALSO Holding', 'Bell Food': 'Bell Food Group', 'Stanserhorn-Bahn-Aktiengesellschaft': 'Stanserhorn-Bahn', 'Anheuser-Busch InBev': 'AB InBev',
}

// Tickers we are sure of (Yahoo Finance symbols). Unknown name → no Yahoo query.
const TICKER: Record<string, string> = {
  Alphabet: 'GOOGL', Apple: 'AAPL', Amazon: 'AMZN', Tesla: 'TSLA', IBM: 'IBM', Visa: 'V', Oracle: 'ORCL', Linde: 'LIN',
  'Union Pacific': 'UNP', Caterpillar: 'CAT', 'Zimmer Biomet': 'ZBH', 'Nestlé': 'NESN.SW', Novartis: 'NOVN.SW', Roche: 'ROG.SW',
  UBS: 'UBSG.SW', ABB: 'ABBN.SW', 'Zurich Insurance': 'ZURN.SW', Holcim: 'HOLN.SW', 'Swiss Re': 'SREN.SW', 'Lindt & Sprüngli': 'LISN.SW',
  'VZ Holding': 'VZN.SW', Sika: 'SIKA.SW', Lonza: 'LONN.SW', Swisscom: 'SCMN.SW', Givaudan: 'GIVN.SW',
  'Partners Group': 'PGHN.SW', Alcon: 'ALC.SW', Sonova: 'SOON.SW', Geberit: 'GEBN.SW', 'Swiss Life': 'SLHN.SW', Richemont: 'CFR.SW',
  'Novo Nordisk': 'NOVO-B.CO', 'Kühne+Nagel': 'KNIN.SW', Straumann: 'STMN.SW', Sandoz: 'SDZ.SW', Swatch: 'UHR.SW',
}

// Fund, ETF and certificate names → the index or theme that actually moves them. First match wins.
const THEMES: [RegExp, string, SearchTerm['kind']][] = [
  [/reverse convertible|protection participation|underlying tracker|time deposit|festgeld|lehman/i, '', 'thema'],
  [/goldbarren|\bgold\b/i, 'Goldpreis', 'markt'],
  [/silver/i, 'Silberpreis', 'markt'],
  [/palladium/i, 'Palladiumpreis', 'markt'],
  [/precious metals/i, 'Edelmetalle', 'markt'],
  [/crypto|bitcoin/i, 'Bitcoin Kryptowährungen', 'markt'],
  [/carbon emission/i, 'CO2-Zertifikate Preis', 'markt'],
  [/high yield/i, 'Hochzinsanleihen', 'markt'],
  [/ex chf/i, 'Anleihenmärkte Zinsen', 'markt'],
  [/(chf|franc|swiss|switzerland|schweiz).*(bond|anleihe|obligation|income|credit|coco)|(bond|credit|income).*(chf|franc)/i, 'Franken Anleihen SNB Zinsen', 'markt'],
  [/usd treasury|us short duration|usd corporate bond|emerging markets usd/i, 'US-Staatsanleihen Renditen', 'markt'],
  [/eur corp|eur corporate|euro.*bond/i, 'Euro Anleihen EZB Zinsen', 'markt'],
  [/bond|credit|anleihe|aggregate|coco|fixed income/i, 'Anleihenmärkte Zinsen', 'markt'],
  [/nasdaq 100/i, 'Nasdaq 100', 'markt'],
  [/biotech/i, 'Biotech Aktien', 'thema'],
  [/s&p 500/i, 'S&P 500', 'markt'],
  [/health care|medtech|digital health/i, 'Gesundheitssektor Aktien', 'thema'],
  [/clean energy|solar|smart energy|hydrogen|climate|green tech|battery/i, 'erneuerbare Energien Aktien', 'thema'],
  [/water/i, 'Wasser Aktien', 'thema'],
  [/robotics|automation|artificial intelligence|digital security/i, 'Robotik KI Aktien', 'thema'],
  [/private equity/i, 'Private Equity', 'thema'],
  [/data center|reits/i, 'Rechenzentren REITs', 'thema'],
  [/real estate|property|immobilien/i, 'Schweizer Immobilienfonds', 'thema'],
  [/emerging markets|\bem\b|china/i, 'Schwellenländer Aktien', 'markt'],
  [/swiss dividend/i, 'Schweizer Dividendenaktien', 'markt'],
  [/smim|small & mid|mid & small|small cap.*switzerland/i, 'Schweizer Nebenwerte', 'markt'],
  [/\bsmi\b|\bspi\b|\bsli\b|switzerland|swiss/i, 'SMI Schweizer Aktien', 'markt'],
  [/\bm?dax\b/i, 'DAX', 'markt'],
  [/euro stoxx/i, 'Euro Stoxx 50', 'markt'],
  [/ftse 100/i, 'FTSE 100', 'markt'],
  [/europe|\beuro\b/i, 'Europäische Aktien', 'markt'],
  [/consumer staples/i, 'Konsumgüter Aktien', 'thema'],
  [/energy/i, 'Energieaktien Ölpreis', 'thema'],
  [/financials/i, 'Bankaktien Finanzsektor', 'thema'],
  [/msci usa|usa/i, 'US-Aktien Wall Street', 'markt'],
  [/msci world|world|acwi|all-world|global/i, 'MSCI World', 'markt'],
]

const FUNDISH = /^(anteile|units|shs|accum shs|exchange traded|underlying tracker)\b|\b(etf|etc|fund|fd|sicav|icav|index)\b|goldbarren/i
const STOCK_PREFIX = /^(namen-aktie|inhaber-aktie|genussschein|partizipationsschein|na\. u\. inh\. ti\.-aktie)\s*(-[a-z]-\s*)?/i
const LEGAL = /[\s,]+(ag|sa|inc|ltd|plc|corp|corporation|co|n\.v\.|nv|se|s\.a\.|a\/s|sa\/nv|& co\. kgaa|kgaa|reg s|pfaeffikon)\.?$/i
const GROUP = /\s+(group|holdings?)$/i

/** "Namen-Aktie Swiss Re AG" → "Swiss Re". Returns '' when nothing usable is left. */
export function companyName(name: string): string {
  let n = name.replace(STOCK_PREFIX, '').replace(/^american dep\.share repr \d+ shs\s*(-[a-z]-\s*)?/i, '').replace(/\s+aktie$/i, '')
  n = n.replace(/\s*-[a-z]-\s*/gi, ' ').replace(/^-[a-z]\s+/i, '').replace(/\s+/g, ' ').trim()
  if (ALIAS[n]) return ALIAS[n]
  for (let i = 0; i < 4; i++) {
    const before = n
    n = n.replace(LEGAL, '').trim()
    // "Swiss Life Holding" → "Swiss Life", but "VZ Holding" stays: a short stem is too ambiguous to search.
    const stem = n.replace(GROUP, '').trim()
    if (stem.length >= 6 || ALIAS[stem]) n = stem
    if (ALIAS[n]) return ALIAS[n]
    if (n === before) break
  }
  return n.length >= 2 ? n : ''
}

/** One security name → what to search. null = nothing sensible (structured products, deposits). */
export function termFor(name: string, currency = ''): Omit<SearchTerm, 'weight'> | null {
  const n = name.replace(/\s+/g, ' ').trim()
  if (!n) return null
  const bond = /^\d+(?:\.\d+)?\s*%\s+(.+?)\s*\d{4}-\d/.exec(n)
  if (/reverse convertible|protection participation|underlying tracker/i.test(n)) return null
  if (bond) {
    const issuer = companyName(bond[1])
    return issuer ? { security: issuer, query: issuer, kind: 'titel', ticker: TICKER[issuer] } : null
  }
  if (FUNDISH.test(n)) {
    // The fund's own name sits after the last dash; umbrella, issuer and share class come before it.
    const tail = / on (.+)$/i.exec(n)?.[1] ?? n.split(/\s-\s*|-\s+/).pop() ?? n
    const plain = (s: string) => s.replace(/credit suisse/gi, '')
    const hit = THEMES.find(([re]) => re.test(plain(tail))) ?? THEMES.find(([re]) => re.test(plain(n)))
    if (hit && !hit[1]) return null
    const label = tail.replace(/^(anteile|units|shs|accum shs)\s+/i, '').replace(/\((acc|dist|ch|de|r|chf|dr)\)/gi, '').replace(/\b(ucits|etf|blue)\b/gi, '').replace(/\s+/g, ' ').trim() || n
    if (hit) return { security: label, query: /real estate|property|immobilien/i.test(n) && currency && currency !== 'CHF' ? 'Immobilienaktien' : hit[1], kind: hit[2] }
    return label.length >= 3 ? { security: label, query: label, kind: 'thema' } : null
  }
  const company = companyName(n)
  return company ? { security: company, query: company, kind: 'titel', ticker: TICKER[company] } : null
}

// A currency headline has to name the foreign currency: "Franken" alone also matches fuel prices and mortgages.
const CURRENCY_NAMED: Record<string, string[]> = { USD: ['dollar', 'usd', 'greenback'], EUR: ['euro', 'eur'], GBP: ['pfund', 'gbp', 'sterling'], JPY: ['yen', 'jpy'], CHF: ['franken', 'chf', 'snb', 'nationalbank'] }
const CURRENCY_QUERY: Record<string, string> = { USD: 'Dollar Franken Wechselkurs', EUR: 'Euro Franken Wechselkurs', GBP: 'Pfund Franken Wechselkurs', JPY: 'Yen Franken Wechselkurs', CHF: 'Franken Wechselkurs SNB' }
// SAA industry → [German label, search term, English label]. The search term stays German (Swiss editions).
const SECTOR: Record<string, [string, string, string]> = {
  'Information Technology': ['Technologie', 'Technologieaktien', 'technology'], 'Health Care': ['Gesundheit', 'Pharma Aktien', 'health care'], Financials: ['Finanzen', 'Bankaktien Finanzsektor', 'financials'],
  'Consumer Staples': ['Basiskonsum', 'Nahrungsmittel Aktien', 'consumer staples'], 'Consumer Discretionary': ['Zyklischer Konsum', 'Luxusgüter Konsum Aktien', 'consumer discretionary'],
  Industrials: ['Industrie', 'Industrieaktien', 'industrials'], Materials: ['Rohstoffe', 'Rohstoffe Chemie Aktien', 'materials'], Energy: ['Energie', 'Energieaktien Ölpreis', 'energy'],
  Utilities: ['Versorger', 'Versorger Strompreis', 'utilities'], 'Real Estate': ['Immobilien', 'Immobilienaktien', 'real estate'], 'Telecommunication Services': ['Telekom', 'Telekom Aktien', 'telecoms'],
}

/**
 * Search terms for one raw client (clients.json shape): the ~8 largest holdings by share of total assets
 * (portfolios weighted by their size) plus up to two market terms (largest foreign currency, largest sector).
 * `industryOf` maps a SecurityId to its SAA_IndustryName (reference.json); without it no sector term.
 */
export function searchTerms(raw: Raw, industryOf?: (securityId: number) => string | undefined, max = 8, lang?: Lang): SearchTerm[] {
  const t = pick(lang)
  const portfolios = arr(raw.Portfolios)
  const total = portfolios.reduce((s, p) => s + num(p.AssetsUnderManagementInDefaultCurrency), 0)
  const home = str(raw.ReportingCurrency) || 'CHF'
  const byQuery = new Map<string, SearchTerm & { top: number }>()
  const currencies = new Map<string, number>()
  const sectors = new Map<string, number>()
  const sectorTop = new Map<string, number>()
  for (const p of portfolios) {
    const share = total > 0 ? num(p.AssetsUnderManagementInDefaultCurrency) / total : 1 / portfolios.length
    for (const s of arr(p.SecurityPositions)) {
      const w = num(s.PortfolioValuePercentage) * share * 100
      if (w <= 0) continue
      const cur = str(s.Currency)
      if (cur) currencies.set(cur, (currencies.get(cur) ?? 0) + w)
      const industry = industryOf?.(num(s.SecurityId))
      if (industry) { sectors.set(industry, (sectors.get(industry) ?? 0) + w); sectorTop.set(industry, Math.max(sectorTop.get(industry) ?? 0, w)) }
      const term = termFor(str(s.SecurityName), cur)
      if (!term) continue
      const prev = byQuery.get(term.query)
      if (!prev) byQuery.set(term.query, { ...term, weight: w, top: w })
      else {
        prev.weight += w
        if (w > prev.top) Object.assign(prev, { security: term.security, top: w, ticker: prev.ticker ?? term.ticker })
      }
    }
  }
  const holdings = [...byQuery.values()].sort((a, b) => b.weight - a.weight).slice(0, max).map(({ top: _top, ...rest }) => rest)
  const market: SearchTerm[] = []
  const [cur, curW] = [...currencies].filter(([c]) => c !== home).sort((a, b) => b[1] - a[1])[0] ?? []
  if (cur && curW >= 10) market.push({ security: t(`Währung ${cur}`, `Currency ${cur}`), query: CURRENCY_QUERY[cur] ?? `${cur} Franken Wechselkurs`, weight: curW, kind: 'markt', named: CURRENCY_NAMED[cur] ?? [cur.toLowerCase()] })
  const [sec, secW] = [...sectors].sort((a, b) => b[1] - a[1])[0] ?? []
  // A sector that is mostly one holding we already search for adds nothing.
  if (sec && secW >= 10 && secW >= 1.5 * (sectorTop.get(sec) ?? 0) && SECTOR[sec] && !holdings.some((h) => h.query === SECTOR[sec][1])) market.push({ security: t(`Sektor ${SECTOR[sec][0]}`, `Sector ${SECTOR[sec][2]}`), query: SECTOR[sec][1], weight: secW, kind: 'thema' })
  return [...holdings, ...market].map((x) => ({ ...x, weight: Math.round(x.weight * 10) / 10 }))
}

// ---- RSS (pure) ------------------------------------------------------------------------------------

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}
const tag = (block: string, name: string) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block); return m ? decode(m[1]) : '' }

/** Items of an RSS 2.0 feed. Malformed or empty input gives []; items without title, link or date are skipped. */
export function parseRss(xml: string, fallbackSource = ''): RssItem[] {
  if (typeof xml !== 'string') return []
  const out: RssItem[] = []
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = m[1]
    let title = tag(block, 'title')
    let url = tag(block, 'link') || tag(block, 'guid')
    // Bing wraps the article in a click tracker; the real address sits in its url parameter.
    if (/bing\.com\/news\/apiclick/i.test(url)) { try { url = new URL(url).searchParams.get('url') ?? url } catch { /* keep the wrapper */ } }
    const date = new Date(tag(block, 'pubDate'))
    const source = tag(block, 'source') || tag(block, 'News:Source') || fallbackSource
    if (!title || !/^https?:\/\//.test(url) || Number.isNaN(date.getTime())) continue
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim()
    out.push({ title, source: source || 'Unbekannte Quelle', url, published: date.toISOString() })
  }
  return out
}

// ---- merge, dedupe, rank (pure) --------------------------------------------------------------------

const words = (t: string) => new Set(t.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3))
export function similar(a: string, b: string) {
  const x = words(a), y = words(b)
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase()
  let both = 0
  for (const w of x) if (y.has(w)) both++
  return both / Math.min(x.size, y.size) >= 0.7 || both / (x.size + y.size - both) >= 0.5
}

function hash(s: string) {
  let h = 5381
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0
  return h.toString(36)
}

export type Candidate = RssItem & { term: SearchTerm }

// Extra words that count as naming a company in a headline (ticker feeds also carry market-wide noise).
const ALSO_NAMED: Record<string, string[]> = { Alphabet: ['google', 'googl', 'youtube', 'waymo'], Amazon: ['aws', 'amzn'], Apple: ['iphone', 'aapl'], 'Kühne+Nagel': ['kuehne'], 'Nestlé': ['nesn'] }
const fold = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A headline for a single title must name the company, one for a currency the currency; other theme and market terms pass. */
export function mentions(title: string, term: SearchTerm): boolean {
  if (term.kind !== 'titel' && !term.named) return true
  const t = fold(title)
  const keys = term.named ?? [fold(term.query).split(/[\s&+-]+/)[0], ...(ALSO_NAMED[term.query] ?? []), ...(term.ticker ? [fold(term.ticker.split('.')[0])] : [])]
  return keys.some((k) => k.length >= 2 && new RegExp(`(^|[^a-z0-9])${escape(k)}`).test(t))
}

// Search feeds also return price pages, converters and product sheets. They are not news.
const NOT_NEWS = /währungsrechner|devisenrechner|^kurs\b|\bkurs(e)? (und|&) chart|\bkursliste\b|\bchart\b.*\bkurs\b|\betf \d?[cd]$|\bucits etf( \((acc|dist)\))?( - [a-z]{3})?$|^\S+ \(\S+\) (aktie|kurs)/i
export const isNews = (title: string) => !NOT_NEWS.test(title.trim())

/** Drops items older than 7 days, non-news pages, near-duplicate titles and more than 3 per holding; sorts by weight × recency. */
export function rank(candidates: Candidate[], now: number, max = 12): Candidate[] {
  const week = 7 * 24 * 3600e3
  const score = (c: Candidate) => c.term.weight / (1 + (now - Date.parse(c.published)) / (24 * 3600e3))
  const fresh = candidates.filter((c) => { const age = now - Date.parse(c.published); return age <= week && age > -3600e3 && isNews(c.title) && mentions(c.title, c.term) })
  const kept: Candidate[] = []
  const perTerm = new Map<string, number>()
  for (const c of fresh.sort((a, b) => score(b) - score(a))) {
    if (kept.some((k) => similar(k.title, c.title))) continue
    const n = perTerm.get(c.term.query) ?? 0
    if (n >= 3) continue
    perTerm.set(c.term.query, n + 1)
    kept.push(c)
  }
  return kept.slice(0, max)
}

const pct = (w: number) => `${w.toFixed(1)}%`
const zurichTime = (iso: string) => new Intl.DateTimeFormat('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).format(new Date(iso))

export function toItem(c: Candidate, ref: string, note?: { tone?: Tone; why?: string }, lang?: Lang): NewsAgentItem {
  const t = pick(lang)
  const tone = note?.tone
  const severity: Severity = tone === 'negativ' ? (c.term.weight >= 5 ? 'risk' : 'warn') : tone === 'positiv' ? 'ok' : 'info'
  const reach: Reach = c.term.kind === 'titel' ? 'Titel' : c.term.kind === 'thema' ? 'Sektor' : 'Global'
  const meaning = note?.why ?? (c.term.kind === 'titel' ? t(`Direkte Position mit ${pct(c.term.weight)} Gewicht.`, `Direct position with ${pct(c.term.weight)} weight.`) : t(`Betrifft ${pct(c.term.weight)} des Vermögens.`, `Touches ${pct(c.term.weight)} of assets.`))
  return {
    id: `news-${hash(c.title.toLowerCase())}`, time: zurichTime(c.published), title: c.title, source: c.source, reach,
    affects: { [ref]: { tag: `${c.term.security} ${pct(c.term.weight)}`, position: `${c.term.security}, ${pct(c.term.weight)} ${t('des Vermögens', 'of assets')}`, meaning, severity } },
    url: c.url, published: c.published, security: c.term.security, weight: c.term.weight,
    ...(tone ? { tone } : {}), ...(note?.why ? { why: note.why } : {}),
  }
}

// ---- LLM step: tone + one line in the advisor's language -------------------------------------------

const numbersIn = (s: string) => s.match(/\d+(?:[.,']\d+)*/g) ?? []

/** Accepts a model line only if it is short and every number in it appears in the headline or the weight. */
export function checkWhy(why: unknown, title: string, weight: number): string | undefined {
  if (typeof why !== 'string') return undefined
  const line = why.replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim()
  if (!line || line.split(' ').length > 16) return undefined
  const allowed = `${title} ${weight} ${weight.toFixed(1)} ${weight.toFixed(1).replace('.', ',')} ${Math.round(weight)}`
  return numbersIn(line).every((n) => allowed.includes(n)) ? line : undefined
}

type Note = { tone?: Tone; why?: string; relevant: boolean }

// The tone values stay German in both prompts: code compares them.
const ANNOTATE_EN = `You help a client advisor at a Swiss bank. Write in English (British spelling).
For each headline ("titel") you know the position in the client's portfolio ("position") and its weight ("gewicht").
Schema: {"items": [{"i": number, "relevant": boolean, "tone": "negativ" | "positiv" | "neutral", "why": string}]}
- "relevant": false if the headline has nothing to do with the position (namesake, advertising, another topic), is mainly about another company, or is not news (price page, calculator, product sheet).
- "tone": effect of the news on the value of the position; exactly one of "negativ", "positiv", "neutral".
- "why": one sentence, at most 14 words, why this matters for THIS portfolio. Use only numbers from the headline or the weight («position with 6.2% weight», never «6.2% affected»); calculate nothing. No investment advice. Do not translate or repeat the headline.
  Connect what the news says with the position instead of only naming the weight. Good: «Antitrust ruling supports the advertising business of the largest position (25.5% weight).» Bad: «Alphabet has 25.5% weight in the portfolio.» (Do NOT copy the numbers from the example.)
Answer as one single JSON object without any other text.`

async function annotate(cands: Candidate[], complete: (m: Message[]) => Promise<unknown>, lang?: Lang): Promise<Map<number, Note>> {
  const list = cands.map((c, i) => ({ i, titel: c.title, position: c.term.security, gewicht: pct(c.term.weight) }))
  const answer = await complete([
    { role: 'system', content: lang === 'en' ? ANNOTATE_EN : `Du hilfst einem Kundenberater einer Schweizer Bank. Antworte auf Deutsch in Schweizer Schreibweise (ss statt ß).
Zu jeder Schlagzeile kennst du die Position im Portfolio des Kunden und deren Gewicht.
Schema: {"items": [{"i": number, "relevant": boolean, "tone": "negativ" | "positiv" | "neutral", "why": string}]}
- "relevant": false, wenn die Schlagzeile nichts mit der Position zu tun hat (Namensgleichheit, Werbung, anderes Thema) oder vor allem ein anderes Unternehmen betrifft, oder wenn es keine Nachricht ist (Kursseite, Rechner, Produktblatt).
- "tone": Wirkung der Nachricht auf den Wert der Position.
- "why": ein Satz, höchstens 14 Wörter, warum das für DIESES Portfolio zählt. Verwende nur Zahlen aus der Schlagzeile oder das Gewicht («Position mit 6.2% Gewicht», nie «6.2% betroffen»); rechne nichts. Keine Anlageempfehlung.
  Verbinde den Inhalt der Nachricht mit der Position, statt nur das Gewicht zu nennen. Gut: «Kartellurteil stützt das Werbegeschäft der grössten Position (25.5% Gewicht).» Schlecht: «Alphabet hat 25.5% Gewicht im Portfolio.» (Zahlen im Beispiel NICHT übernehmen.)
Antworte als ein einziges JSON-Objekt ohne weiteren Text.` },
    { role: 'user', content: JSON.stringify(list) },
  ])
  const out = new Map<number, Note>()
  const items = typeof answer === 'object' && answer !== null && Array.isArray((answer as { items?: unknown }).items) ? (answer as { items: unknown[] }).items : []
  for (const x of items) {
    if (typeof x !== 'object' || x === null) continue
    const r = x as { i?: unknown; relevant?: unknown; tone?: unknown; why?: unknown }
    if (typeof r.i !== 'number' || !cands[r.i]) continue
    const tone = r.tone === 'negativ' || r.tone === 'positiv' || r.tone === 'neutral' ? r.tone : undefined
    out.set(r.i, { tone, why: checkWhy(r.why, cands[r.i].title, cands[r.i].term.weight), relevant: r.relevant !== false })
  }
  return out
}

// ---- fetching --------------------------------------------------------------------------------------

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
export type Fetcher = (url: string) => Promise<string>
const httpText: Fetcher = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(6000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.text()
}

const google = (q: string, lang: 'de' | 'en') => `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:7d`)}&${lang === 'de' ? 'hl=de&gl=CH&ceid=CH:de' : 'hl=en-US&gl=US&ceid=US:en'}`
const bing = (q: string) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=de-CH&cc=CH&mkt=de-CH`
const yahoo = (t: string) => `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(t)}&region=US&lang=en-US`
const PER_FEED = 6

// Google answers bursts from one address with 503 "automated queries" or just hangs. After either we
// leave it alone for ten minutes (Bing and Yahoo still answer), and no host gets more than three requests at once.
let googlePausedUntil = 0
const running = new Map<string, number>()
const waiting = new Map<string, (() => void)[]>()
async function limited<T>(host: string, job: () => Promise<T>, max = 3): Promise<T> {
  if ((running.get(host) ?? 0) >= max) await new Promise<void>((go) => waiting.set(host, [...(waiting.get(host) ?? []), go]))
  running.set(host, (running.get(host) ?? 0) + 1)
  try { return await job() } finally {
    running.set(host, (running.get(host) ?? 1) - 1)
    waiting.get(host)?.shift()?.()
  }
}

async function fetchTerm(term: SearchTerm, get: Fetcher, errors: string[]): Promise<Candidate[]> {
  const tryFeed = (label: string, host: string, url: string, source = '') => limited(host, async (): Promise<RssItem[]> => {
    if (host === 'google' && Date.now() < googlePausedUntil) return []
    try { return parseRss(await get(url), source).slice(0, PER_FEED) } catch (e) {
      const msg = e instanceof Error ? (e.name === 'TimeoutError' ? 'Zeitüberschreitung' : e.message) : String(e)
      if (host === 'google' && (/HTTP (429|503)/.test(msg) || msg === 'Zeitüberschreitung')) {
        googlePausedUntil = Date.now() + 10 * 60e3
        errors.push(`Google News ${msg}: 10 Minuten Pause`)
      } else errors.push(`${label} «${term.query}»: ${msg}`)
      return []
    }
  })
  const [de, bi, yh] = await Promise.all([
    tryFeed('Google News', 'google', google(term.query, 'de')),
    tryFeed('Bing News', 'bing', bing(term.query)),
    term.ticker ? tryFeed('Yahoo Finance', 'yahoo', yahoo(term.ticker), 'Yahoo Finance') : Promise.resolve([]),
  ])
  const en = !de.length && !bi.length && term.ticker && !term.ticker.includes('.') ? await tryFeed('Google News (en)', 'google', google(term.query, 'en')) : []
  return [...de, ...bi, ...en, ...yh].map((i) => ({ ...i, term }))
}

// ---- data + cache ----------------------------------------------------------------------------------

// Same source as the briefing: the SQLite database via MCP Toolbox, case files as the fallback.
let loaded: Promise<{ clients: Raw[]; industry: Map<number, string> }> | null = null
function data() {
  loaded ??= (async () => {
    const { clients, reference } = await loadData()
    const industry = new Map<number, string>()
    for (const s of arr((reference as Raw | null)?.Securities)) if (str(s.SAA_IndustryName)) industry.set(num(s.Id), str(s.SAA_IndustryName))
    return { clients: arr(clients), industry }
  })()
  loaded.catch(() => { loaded = null })
  return loaded
}

const TTL = 5 * 60e3
const cache = new Map<string, { at: number; result: NewsAgentResult }>()
const inflight = new Map<string, Promise<NewsAgentResult>>()
const notes = new Map<string, Note>() // by item id, so a known headline is not classified twice

export type NewsDeps = { get?: Fetcher; complete?: (m: Message[]) => Promise<unknown>; now?: () => number; lang?: Lang }

/** News for one raw client. Never throws: failures end up in `errors`. */
export async function newsFor(raw: Raw, industryOf: ((id: number) => string | undefined) | undefined, deps: NewsDeps = {}): Promise<NewsAgentResult> {
  const now = (deps.now ?? Date.now)()
  const ref = str(raw.ClientRef)
  const errors: string[] = []
  let items: NewsAgentItem[] = []
  try {
    const lang = deps.lang
    const terms = searchTerms(raw, industryOf, undefined, lang)
    const found = (await Promise.all(terms.map((t) => fetchTerm(t, deps.get ?? httpText, errors)))).flat()
    let picked = rank(found, now, 20)
    // The model's line names this client's weight, so its notes are kept per client and holding.
    const idOf = (c: Candidate) => `${ref}|${lang ?? 'de'}|${c.term.query}|${toItem(c, ref).id}`
    if (deps.complete && picked.length) {
      const todo = picked.filter((c) => !notes.has(idOf(c)))
      if (todo.length) {
        try {
          const got = await annotate(todo, deps.complete, lang)
          todo.forEach((c, i) => { const n = got.get(i); if (n) notes.set(idOf(c), n) })
        } catch (e) { errors.push(`Einordnung durch das Modell: ${e instanceof Error ? e.message : String(e)}`) }
      }
      const relevant = picked.filter((c) => notes.get(idOf(c))?.relevant !== false)
      if (relevant.length) picked = relevant
    }
    items = picked.slice(0, 12).map((c) => toItem(c, ref, notes.get(idOf(c)), lang))
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }
  return { items, fetchedAt: new Date(now).toISOString(), ...(errors.length ? { errors: [...new Set(errors)] } : {}) }
}

const providerFor = (llm: Llm): Provider | null => (llm.ready('openai') ? 'openai' : llm.ready('apertus') ? 'apertus' : null)

/** GET /api/news-agent?ref=…&lang=de|en Cached for 5 minutes per client and language, so polling is cheap. */
export async function newsAgentRoute(url: string, llm: Llm): Promise<{ status: number; data: NewsAgentResult }> {
  const params = new URL(url, 'http://local').searchParams
  const ref = params.get('ref') ?? ''
  const lang = langOf(params.get('lang'))
  const t = pick(lang)
  const key = `${ref}|${lang}`
  const fetchedAt = new Date().toISOString()
  if (!/^[\w.-]{1,64}$/.test(ref)) return { status: 400, data: { items: [], fetchedAt, errors: [t('Parameter ref fehlt', 'Parameter ref is missing')] } }
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return { status: 200, data: hit.result }
  let job = inflight.get(key)
  if (!job) {
    job = (async () => {
      try {
        const { clients, industry } = await data()
        const raw = clients.find((c) => c.ClientRef === ref)
        if (!raw) return { items: [], fetchedAt, errors: [t('Kunde nicht gefunden', 'Client not found')] }
        const provider = providerFor(llm)
        const result = await newsFor(raw, (id) => industry.get(id), { complete: provider ? (m) => llm.complete(provider, m) : undefined, lang })
        // An empty answer after errors is not cached, the next poll tries again.
        if (result.items.length || !result.errors) cache.set(key, { at: Date.now(), result })
        return result
      } catch (e) {
        return { items: [], fetchedAt, errors: [e instanceof Error ? e.message : String(e)] }
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, job)
  }
  return { status: 200, data: await job }
}
