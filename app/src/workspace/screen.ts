import type { Card, Client, EngineFinding, NewsItem, Severity } from '../types'
import { briefFor, readSeconds, type BriefItem } from './brief'
import type { Hint, ModuleSpec } from './types'

// The screen as a catalogue of elements the agent can choose from, and the plan it returns.
// Elements carry their own numbers (computed from the data); the agent only picks, orders and
// shortens text, so nothing it says can put a new figure on screen.
//
//   tiles    left column, scrolls, the 60-second brief in speaking order
//   charts   right column, graphs built from the data, referenced by id
//   plan     which tiles in which order (with optional shorter text), which tile is in focus,
//            which charts or tile figures show on the right, three talking points, the live answer

export type Tile = { id: string; group: string; topics: string[]; words: string; seconds: number; severity?: Severity; item?: BriefItem; news?: NewsItem[]; card?: Card; chart?: string }
export type Chart = { id: string; title: string; note: string; spec: ModuleSpec }
export type Suggestion = { id: string; label: string; text: string; tile?: string }
export type Plan = {
  order: string[]                // tile ids in speaking order
  texts: Record<string, string>  // shorter wording per tile, optional
  focus: string | null           // the tile the conversation is about
  widgets: string[]              // 'chart:<id>' or 'tile:<id>' shown on the right
  suggestions: Suggestion[]      // three talking points
  answer: { heard: string; text: string } | null
  by: 'agent' | 'lokal'
}

// What the agent is told about each element kind (German, like everything it writes).
export const CATALOGUE = {
  kacheln: 'Linke Spalte, scrollbar, Reihenfolge = Sprechreihenfolge des 60-Sekunden-Briefings. Jede Kachel hat eine Kennzahl und einen Satz. Du wählst 5 bis 8 und darfst den Text kürzen (Stichpunkt, höchstens 12 Wörter, keine neuen Zahlen).',
  fokus: 'Die Kachel, um die es gerade geht. Sie wird in die Mitte geholt.',
  grafiken: 'Rechte Spalte, höchstens 3 gleichzeitig: "chart:<id>" für eine Grafik aus GRAFIKEN oder "tile:<id>" für die Kennzahl einer Kachel. Nur zeigen, was jetzt hilft.',
  vorschlaege: 'Genau 3 Stichpunkte, was der Berater als Nächstes sagt: höchstens 10 Wörter, Nominalstil, ohne Artikel am Anfang, ohne Anrede, eine Kernzahl. "text" muss für sich allein verständlich sein (nennt Gegenstand und Zahl), "label" ist nur das Thema in 2–3 Wörtern, "tile" die id der passenden Kachel.',
  antwort: 'Nur wenn der Kunde in NEUE ABSCHNITTE ein Anliegen äussert: {"heard": seine Aussage, "text": Stichpunkt für die Antwort, höchstens 12 Wörter}.',
}

const severityRank: Record<Severity, number> = { risk: 0, warn: 1, ok: 2, info: 3 }
const rankOf = (n: NewsItem, ref: string) => severityRank[n.affects[ref].severity]
// The holding's share of the client's assets in %: the news agent sends it as `weight`, the engine's news only in the tag ("Nestle 3.4%").
const weightOf = (n: NewsItem & { weight?: number }, ref: string) => n.weight ?? (Number(/([\d.,]+)%$/.exec(n.affects[ref].tag)?.[1]?.replace(',', '.')) || 0)

const tokens = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3).map((w) => w.slice(0, 6))
const pct = (v: number) => Math.round(v * 1000) / 10

// ---- charts: deterministic, from the engine's numbers where it answered, else the computed facts ----

const CLASS: Record<string, string> = { Shares: 'Aktien', Bonds: 'Obligationen', Liquidity: 'Liquidität', 'Real estate': 'Immobilien', 'Specialties andCommodities': 'Alternative', 'Specialties and Commodities': 'Alternative' }
const CURRENCY: Record<string, string> = { 'Swiss francs': 'CHF', 'US-Dollar': 'USD', Euro: 'EUR', Andere: 'Andere' }

function engineCharts(findings: EngineFinding[]): Chart[] {
  const alloc = findings.find((f) => f.check === 'portfolio.allocation' && f.numbers && Object.keys(f.numbers).some((k) => k.startsWith('AssetClass.')))?.numbers
  if (!alloc) return []
  const bars = (prefix: string, names: Record<string, string>) => Object.entries(alloc).filter(([k, v]) => k.startsWith(prefix) && v > 0.004)
    .map(([k, v]) => ({ label: names[k.slice(prefix.length)] ?? k.slice(prefix.length), value: pct(v) })).sort((a, b) => b.value - a.value)
  const out: Chart[] = []
  const classes = bars('AssetClass.', CLASS)
  if (classes.length) out.push({ id: 'anlageklassen', title: 'Anlageklassen', note: 'Mit Durchsicht in Fonds.', spec: { type: 'balken', title: 'Anlageklassen', unit: '%', note: 'Mit Durchsicht in Fonds.', bars: classes } })
  const currencies = bars('CurrencyGroup.', CURRENCY)
  if (currencies.length) out.push({ id: 'waehrungen', title: 'Währungen', note: 'Mit Durchsicht in Fonds.', spec: { type: 'balken', title: 'Währungen', unit: '%', note: 'Mit Durchsicht in Fonds.', bars: currencies } })
  return out
}

export function chartsFor(client: Client, topicCharts: { id: string; spec: ModuleSpec }[]): Chart[] {
  const engine = engineCharts(client.findings ?? [])
  const local = topicCharts.filter((t) => !engine.some((e) => e.id === t.id || (t.id === 'waehrungen' && e.id === 'waehrungen')))
    .map((t) => ({ id: t.id, title: t.spec.title, note: t.spec.note, spec: t.spec }))
  return [...engine, ...local]
}

// ---- tiles: the brief items, today's news and the proposal ----

export function tilesFor(client: Client, charts: Chart[], news: NewsItem[] = []): Tile[] {
  const tiles: Tile[] = briefFor(client).map((item) => ({ id: item.id, group: item.group, topics: item.topics ?? [], words: `${item.figure ?? ''} ${item.text}`, seconds: readSeconds(item), severity: item.severity, item }))
  // Live news on this client's biggest holdings: one tile, right after the reason for the call.
  // Only news naming a position itself (reach 'Titel'); currency, sector and fund-theme news is market
  // noise here. Biggest position first, one story per position, at most three; severity breaks ties.
  const holding = (n: NewsItem) => n.affects[client.ref].tag.replace(/\s*[\d.,]+%$/, '')
  const sorted = news.filter((n) => n.affects[client.ref] && n.reach === 'Titel')
    .sort((a, b) => weightOf(b, client.ref) - weightOf(a, client.ref) || rankOf(a, client.ref) - rankOf(b, client.ref))
  const relevant = sorted.filter((n, i) => sorted.findIndex((m) => holding(m) === holding(n)) === i).slice(0, 3)
  if (relevant.length) {
    const at = tiles.findIndex((t) => t.group !== 'Anlass')
    tiles.splice(at < 0 ? tiles.length : at, 0, { id: 'news', group: 'Markt heute', topics: ['news', 'markt'], words: relevant.map((n) => `${n.title} ${n.affects[client.ref].meaning} ${n.affects[client.ref].tag}`).join(' '), seconds: relevant.length * 3, severity: relevant[0].affects[client.ref].severity, news: relevant })
  }
  const proposal = client.briefing.find((c) => c.type === 'proposal')
  if (proposal?.type === 'proposal') tiles.push({ id: 'proposal', group: 'Anlagevorschlag', topics: [], words: `${proposal.summary} ${proposal.trades.map((t) => t.name).join(' ')}`, seconds: 6, card: proposal })
  for (const t of tiles) {
    const byTopic = charts.find((c) => t.topics.includes(c.id)) ?? (t.topics.includes('waehrungen') || t.topics.includes('konzentration') ? charts.find((c) => c.id === 'waehrungen') : undefined)
    t.chart = byTopic?.id
  }
  return usefulTiles(tiles)
}

// A tile says something only with a figure, a sentence, news or a proposal behind it.
const hasSubstance = (t: Tile) => !!(t.news?.length || t.card || t.item?.figure || (t.item?.text && t.item.text.trim().length > 12))

/** Two tiles say the same thing when most of the shorter one's content words appear in the other. */
export function sameTile(a: Tile, b: Tile): boolean {
  const x = new Set(tokens(a.words)), y = new Set(tokens(b.words))
  if (!x.size || !y.size) return false
  let both = 0
  for (const w of x) if (y.has(w)) both++
  return both / Math.min(x.size, y.size) >= 0.8
}

/** Drops empty tiles and near-duplicates (the first, higher-ranked one stays). */
export function usefulTiles(tiles: Tile[]): Tile[] {
  const out: Tile[] = []
  for (const t of tiles) if (hasSubstance(t) && !out.some((o) => o.id === t.id || sameTile(o, t))) out.push(t)
  return out
}

// What the agent sees of the elements: ids, labels and the text with its figures.
export const describeTiles = (tiles: Tile[]) => tiles.map((t) => ({ id: t.id, gruppe: t.group, kennzahl: t.item?.figure, text: t.item?.text ?? (t.news ? t.news.map((n) => `${n.title} (${Object.values(n.affects)[0]?.tag ?? ''}: ${Object.values(n.affects)[0]?.meaning ?? ''})`).join(' / ') : t.card?.type === 'proposal' ? t.card.summary : t.group), quelle: t.item?.source ?? (t.news ? t.news.map((n) => n.source).join(', ') : undefined) }))
export const describeCharts = (charts: Chart[]) => charts.map((c) => ({ id: c.id, titel: c.title, zeigt: c.spec.type === 'balken' ? c.spec.bars.map((b) => `${b.label} ${b.value}${c.spec.type === 'balken' ? c.spec.unit : ''}`).join(', ') : c.note }))

// ---- matching and the local plan (no model, or the model failed) ----

export function score(tile: Tile, text: string, topic?: string): number {
  if (topic && tile.topics.includes(topic)) return 10
  const have = new Set(tokens(tile.words + ' ' + tile.group))
  return tokens(text).filter((w) => have.has(w)).length
}

export const bestTile = (tiles: Tile[], text: string, topic?: string) => {
  const top = tiles.map((t) => ({ t, s: score(t, text, topic) })).sort((a, b) => b.s - a.s)[0]
  return top && top.s >= 2 ? top.t : undefined
}

const firstNumber = (text: string) => /[−+-]?\d[\d'.,]*\s?%/.exec(text)?.[0]

export function localPlan(tiles: Tile[], said: string[], focusText?: string, focusTopic?: string, answer: Plan['answer'] = null): Plan {
  const focus = focusText ? bestTile(tiles, focusText, focusTopic) : tiles[0]
  const talk = tiles.filter((t) => t.item && !said.some((s) => s.startsWith(`${t.id}:`)))
  const start = focus ? Math.max(0, talk.indexOf(focus)) : 0
  const suggestions = [...talk.slice(start), ...talk.slice(0, start)].slice(0, 3)
    .map((t) => ({ id: `${t.id}:lokal`, label: t.group, tile: t.id, text: `${t.item!.figure ? `${t.item!.figure} ` : ''}${t.item!.text}`.replace(/\.$/, '') }))
  return {
    order: tiles.map((t) => t.id), texts: {}, focus: focus?.id ?? null,
    widgets: focus ? [focus.chart ? `chart:${focus.chart}` : `tile:${focus.id}`] : [],
    suggestions, answer, by: 'lokal',
  }
}

// The agent's plan, checked: unknown ids are dropped, missing tiles are appended, texts with a number
// that is not in the data are dropped (`grounded` decides), and the three talking points are topped up.
export function checkPlan(raw: unknown, tiles: Tile[], charts: Chart[], grounded: (t: string) => boolean, fallback: Plan): Plan {
  const r = (typeof raw === 'object' && raw ? raw : {}) as Record<string, unknown>
  const ids = new Set(tiles.map((t) => t.id))
  const picked = (Array.isArray(r.tiles) ? r.tiles : []).map((x) => (typeof x === 'string' ? { id: x } : x as { id?: string; text?: string })).filter((x) => x?.id && ids.has(x.id))
  const order = [...new Set([...picked.map((x) => x.id!), ...fallback.order])]
  const texts: Record<string, string> = {}
  for (const x of picked) if (x.text && x.text.length < 140 && grounded(x.text)) texts[x.id!] = x.text
  const focus = typeof r.focus === 'string' && ids.has(r.focus) ? r.focus : fallback.focus
  const widgets = (Array.isArray(r.widgets) ? r.widgets : []).map((w) => (typeof w === 'string' ? w : typeof w === 'object' && w ? ('chart' in w ? `chart:${(w as { chart: string }).chart}` : `tile:${(w as { tile: string }).tile}`) : ''))
    .filter((w) => (w.startsWith('chart:') && charts.some((c) => `chart:${c.id}` === w)) || (w.startsWith('tile:') && ids.has(w.slice(5)))).slice(0, 3)
  const suggestions = (Array.isArray(r.suggestions) ? r.suggestions : []).map((s) => s as { label?: string; text?: string; tile?: string })
    .filter((s) => s.text && grounded(s.text)).slice(0, 3)
    .map((s, n) => ({ id: `${s.tile ?? 'x'}:${n}:${s.text!.slice(0, 24)}`, label: s.label || 'Vorschlag', text: s.text!.replace(/\.$/, ''), tile: s.tile && ids.has(s.tile) ? s.tile : undefined }))
  const answer = r.answer && typeof r.answer === 'object' && (r.answer as { text?: string }).text && grounded((r.answer as { text: string }).text) ? r.answer as Plan['answer'] : fallback.answer
  return {
    order, texts, focus, widgets: widgets.length ? widgets : fallback.widgets,
    suggestions: [...suggestions, ...fallback.suggestions.filter((f) => !suggestions.some((s) => s.tile && s.tile === f.tile))].slice(0, 3),
    answer, by: 'agent',
  }
}

export const hintOf = (s: Suggestion): Pick<Hint, 'topicId' | 'label' | 'text'> => ({ topicId: s.tile ?? s.id, label: s.label, text: s.text })
export const widgetMain = (t: Tile, clientRef: string) => t.item?.figure ?? (t.item ? firstNumber(t.item.text) : t.news ? t.news[0].affects[clientRef].tag : t.card?.type === 'proposal' && t.card.effects[0] ? `${t.card.effects[0].before} → ${t.card.effects[0].after}` : undefined)

// A plan made on an older set of tiles (the engine's later tiers arrived meanwhile), moved onto the
// current one: ids that still exist keep their place, new tiles are appended, the rest is dropped.
export function rebasePlan(plan: Plan, tiles: Tile[], charts: Chart[]): Plan {
  const ids = new Set(tiles.map((t) => t.id))
  const order = [...plan.order.filter((id) => ids.has(id)), ...tiles.map((t) => t.id).filter((id) => !plan.order.includes(id))]
  const widgets = plan.widgets.filter((w) => (w.startsWith('tile:') ? ids.has(w.slice(5)) : charts.some((c) => `chart:${c.id}` === w)))
  return { ...plan, order, focus: plan.focus && ids.has(plan.focus) ? plan.focus : order[0] ?? null, widgets, suggestions: plan.suggestions.map((s) => (s.tile && !ids.has(s.tile) ? { ...s, tile: undefined } : s)) }
}

// Who is calling: a client's name heard in the transcript. Whole words only; for names of two or more
// words the full name or the last word counts ("Balboa"), company names without the legal form ("Company 001").
export function nameIn(text: string, clients: { ref: string; name: string }[]): string | undefined {
  const norm = (s: string) => ` ${s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `
  const heard = norm(text)
  const hit = clients.map((c) => {
    const full = norm(c.name).trim()
    const bare = full.replace(/\s(ag|gmbh|sa|ltd|inc)$/, '')
    const words = full.split(' ')
    const keys = [full, bare, ...(words.length > 1 && !/\d/.test(full) ? [words[words.length - 1]] : [])].filter((k) => k.length >= 3)
    const best = Math.max(0, ...keys.filter((k) => heard.includes(` ${k} `)).map((k) => k.length))
    return { ref: c.ref, best }
  }).filter((x) => x.best > 0).sort((a, b) => b.best - a.best)[0]
  return hit?.ref
}
