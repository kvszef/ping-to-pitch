import { topics } from '../data/workspace'
import { signals } from '../data/mock'
import type { Card, CardOf, Client, NewsItem } from '../types'
import type { NewsAgentItem, NewsAgentResult } from '../../server/ai/news-agent-types'
import { deriveTopics } from './derive'
import { grounded } from './grounding'
import { CATALOGUE, chartsFor, checkPlan, describeCharts, describeTiles, localPlan, tilesFor, type Chart, type Plan, type Tile } from './screen'
import { englishTopic, keywordHit, KEYWORDS_EN, OPENERS_EN } from './topics-en'
import type { ChatEntry, Hint, Language, ModuleSpec, Origin, Settings, Slot, Topic, TranscriptLine } from './types'

// Einzige Anschlussstelle für die KI. Gesprächsassistent und Berater-Chat fragen dieselbe Instanz mit
// demselben Kontext. Ist kein Anbieter konfiguriert oder schlägt ein Aufruf fehl, übernimmt der
// Beispielmodus (Stichwortsuche in den Beispieldaten), damit die Oberfläche immer bedienbar bleibt.

export type Status = { openai: boolean; apertus: boolean; elevenlabs: boolean; transcribe?: boolean } // transcribe: the server can turn audio into text (ElevenLabs or OpenAI)
export type Segment = { speaker: string; text: string }
export type Thought = { lines: TranscriptLine[]; customer?: Slot; advisor?: Slot; hints: Hint[]; insight?: ChatEntry }
export type Reply = { entry: ChatEntry; hints: Hint[]; next?: Slot }

// Hand-written topics for the sample clients, derived ones for every real client file. The German ones are
// the source (ids, keywords, figures); English is the same topics reworded by hand (topics-en.ts).
// Every request and every example-mode answer follows the advisor's display language (settings.language);
// where a caller names none it is English, the app's default.
const derived = new WeakMap<Client, Topic[]>()
const english = new WeakMap<Client, Topic[]>()
export function topicsFor(client: Client, lang: Language = 'en'): Topic[] {
  if (!topics[client.ref] && !derived.has(client)) derived.set(client, deriveTopics(client))
  const german = topics[client.ref] ?? derived.get(client)!
  if (lang === 'de') return german
  if (!english.has(client)) english.set(client, german.map((t) => englishTopic(client, t)))
  return english.get(client)!
}

// The brain's own fixed sentences, written by hand in both languages.
const TEXT = {
  de: {
    noData: 'Dazu liegen für diesen Kunden keine Daten vor. Ich stelle keine Vermutung an.',
    discarded: 'Die Antwort des Modells enthielt eine Zahl, die nicht in den Kundendaten steht. Sie wurde verworfen.',
    asked: (q: string) => `Frage des Beraters: «${q}»`, heard: (t: string) => `Kunde: «${t}»`,
    fromData: 'Aus den Kundendaten', opener: 'Gesprächseinstieg', openerFrom: 'Gesprächseinstieg aus Marktsignal',
    down: (provider: string, why: unknown) => `[${provider} nicht erreichbar, Beispielmodus: ${why}]`, error: (status: number) => `Fehler ${status}`,
  },
  en: {
    noData: 'There is no data on this for this client. I do not guess.',
    discarded: "The model's answer held a number that is not in the client data. It was discarded.",
    asked: (q: string) => `Advisor's question: «${q}»`, heard: (t: string) => `Client: «${t}»`,
    fromData: 'From the client data', opener: 'Conversation opener', openerFrom: 'Conversation opener from a market signal',
    down: (provider: string, why: unknown) => `[${provider} not reachable, example mode: ${why}]`, error: (status: number) => `Error ${status}`,
  },
}

let counter = 0
const nextId = () => `e${++counter}`
const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

export async function fetchStatus(): Promise<Status> {
  try {
    const r = await fetch('/api/status')
    if (r.ok) return await r.json()
  } catch { /* kein Server erreichbar */ }
  return { openai: false, apertus: false, elevenlabs: false }
}

export const activeProvider = (settings: Settings, status: Status) => (status[settings.provider] ? settings.provider : null)

// Every request names the advisor's language, so the server phrases in it directly (absent would mean English).
async function post<T>(path: string, payload: { language: Language; [key: string]: unknown }): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error ?? TEXT[payload.language].error(r.status))
  return data
}

// Aktuelle Nachrichten zu den grössten Positionen des Kunden (server-seitig 5 Minuten gecacht).
// Eigener, kurzlebiger Cache hier zusätzlich: think() und der Screen-Agent rufen bei jedem
// Transkript-Ausschnitt neu auf, und sollen dafür nicht bei jedem Häppchen erneut abrufen.
// Bricht der Abruf ab, bleibt die Funktion trotzdem funktionsfähig, einfach ohne diese Quelle.
const newsCache = new Map<string, { at: number; items: NewsAgentItem[] }>()
const NEWS_TTL = 60_000

async function fetchNews(ref: string, lang: Language): Promise<NewsAgentItem[]> {
  const key = `${lang}:${ref}`
  const cached = newsCache.get(key)
  if (cached && Date.now() - cached.at < NEWS_TTL) return cached.items
  try {
    const r = await fetch(`/api/news-agent?ref=${encodeURIComponent(ref)}&lang=${lang}`)
    if (!r.ok) return cached?.items ?? []
    const data = await r.json() as NewsAgentResult
    const items = Array.isArray(data.items) ? data.items : []
    newsCache.set(key, { at: Date.now(), items })
    return items
  } catch { return cached?.items ?? [] }
}

// Was das Modell über den Kunden erfährt: nur Fakten aus den Daten, ohne Namen und Kontonummern.
function contextFor(client: Client, news: NewsAgentItem[], lang: Language) {
  return {
    kunde: { kennung: client.ref, kundenprofil: client.profile, strategie: client.strategy, anlagedienstleistung: client.service, vermoegen: client.aum, anlass: client.context, letzteBeratung: client.lastConsultation, geburtsdatum: client.birthday, letzteProfilierung: client.lastProfiling },
    briefing: client.briefing,
    befunde: client.findings?.map((f) => ({ titel: f.title, art: f.kind, schwere: f.severity, quelle: f.evidence.map((e) => [e.source, e.date].filter(Boolean).join(', ')).join('; ') })),
    kennzahlen: client.facts ? { ...client.facts, performance: client.facts.performance && { ...client.facts.performance, series: undefined } } : undefined,
    themen: topicsFor(client, lang).map((t) => ({ thema: t.label, fakten: t.insight.detailliert, begruendung: t.why, quellen: t.sources })),
    marktsignale: signals.filter((s) => s.affected.some((a) => a.ref === client.ref)).map((s) => ({ titel: s.title, detail: s.detail, reichweite: s.reach, quelle: s.source, betroffenheit: s.affected.find((a) => a.ref === client.ref)?.exposure })),
    nachrichten: news.map((n) => ({ titel: n.title, quelle: n.source, zeit: n.time, position: n.security, gewicht: n.weight, ton: n.tone, warum: n.why })),
  }
}

const catalogue = (client: Client, lang: Language) => topicsFor(client, lang).filter((t) => t.module).map((t) => ({ id: t.id, titel: t.module!.spec.title, zeigt: t.module!.spec.note }))

function pickModule(client: Client, settings: Settings, chosen?: { id: string; confidence: number } | null): Pick<Extract<ChatEntry, { role: 'ki' }>, 'module' | 'offered'> {
  const spec: ModuleSpec | undefined = topicsFor(client, settings.language).find((t) => t.id === chosen?.id)?.module?.spec
  if (!spec || !chosen) return {}
  const confidence = Math.round(Math.max(0, Math.min(100, chosen.confidence)))
  return settings.autoModules && confidence >= settings.confidence ? { module: spec } : { offered: { spec, confidence } }
}

// German and English keywords both count, whatever the display language: the call may be held in either.
// `lang` only decides the wording of the topics that come back.
export function detectTopics(who: string | Client, text: string, lang: Language = 'en'): Topic[] {
  const w = words(text)
  return (typeof who === 'string' ? topics[who] ?? [] : topicsFor(who, lang)).filter((t) => [...t.keywords, ...(KEYWORDS_EN[t.id] ?? [])].some((k) => w.some((x) => keywordHit(x, k))))
}

const hint = (topicId: string, label: string, text: string, why: string, severity: Hint['severity'], origin: Origin, trigger: string): Hint => ({ id: nextId(), topicId, label, text, why, severity, origin, trigger })

// Ausgangslage ohne Gespräch: Gesprächseinstieg aus den Marktsignalen und die dringendsten Themen aus den Kundendaten.
export function openingHints(client: Client, lang: Language = 'en'): Hint[] {
  const T = TEXT[lang]
  const opener = signals.flatMap((s) => s.affected.filter((a) => a.ref === client.ref).map((a) => ({ a, s })))[0]
  const spoken = opener && lang === 'en' ? OPENERS_EN[opener.s.id] : undefined
  const all = topicsFor(client, lang)
  const urgent = all.filter((t) => t.severity === 'risk' || t.severity === 'warn')
  const fromData = (urgent.length ? urgent : all).slice(0, opener ? 2 : 3).map((t) => hint(t.id, t.label, t.say, t.why, t.severity, 'kundendaten', T.fromData))
  return opener ? [hint('einstieg', T.opener, spoken?.opener ?? opener.a.opener, spoken?.title ?? opener.s.title, opener.a.severity, 'kundendaten', T.openerFrom), ...fromData] : fromData
}

// Short chip label: the known topic name, otherwise the model's own keyword.
const labelOf = (client: Client, topic: string, lang: Language) => topicsFor(client, lang).find((t) => t.id === topic)?.label ?? topic.charAt(0).toUpperCase() + topic.slice(1)

export const question = (text: string): ChatEntry => ({ id: nextId(), role: 'berater', text })

const notice = (text: string): ChatEntry => ({ id: nextId(), role: 'ki', origin: 'chat', sources: [], text })

function localAnswer(client: Client, text: string, settings: Settings, origin: Origin): Reply {
  const T = TEXT[settings.language]
  const found = detectTopics(client, text, settings.language)
  if (!found.length) return { hints: [], entry: notice(T.noData) }
  const t = found[0]
  return {
    entry: { id: nextId(), role: 'ki', origin, sources: t.sources, text: t.insight[settings.detail], ...pickModule(client, settings, t.module && { id: t.id, confidence: t.module.confidence }) },
    hints: found.map((f) => hint(f.id, f.label, f.say, f.why, f.severity, origin, T.asked(text))),
    next: { heard: text, text: t.next, topic: t.id },
  }
}

type ChatResult = { supported: boolean; text: string; sources?: string[]; module?: { id: string; confidence: number } | null; hint?: { text: string; why: string } | null; next?: string | null; tools?: unknown[] }

// A4 without a model: the server looks the answer up in the client's data (holdings incl. funds, trades,
// value history, accounts) and phrases it deterministically. Undefined when the lookup has nothing to say
// or the server is unreachable; the topic-based example mode then answers.
async function dataAnswer(client: Client, text: string, language: Language): Promise<Reply | undefined> {
  try {
    const r = await post<ChatResult>('/api/chat/data', { language, ref: client.ref, question: text })
    if (!r.supported || !r.text) return undefined
    return { hints: [], entry: { id: nextId(), role: 'ki', origin: 'chat', sources: r.sources ?? [], text: r.text } }
  } catch { return undefined }
}

export async function answer(client: Client, text: string, settings: Settings, status: Status, history: ChatEntry[]): Promise<Reply> {
  const provider = activeProvider(settings, status)
  const language = settings.language, T = TEXT[language]
  if (!provider) { await new Promise((r) => setTimeout(r, 400)); return (await dataAnswer(client, text, language)) ?? localAnswer(client, text, settings, 'chat') }
  try {
    const news = await fetchNews(client.ref, language)
    const context = contextFor(client, news, language)
    const r = await post<ChatResult>('/api/chat', { provider, language, detail: settings.detail, context, modules: catalogue(client, language), question: text, history: history.slice(-6).map((e) => ({ rolle: e.role, text: e.text })) })
    // Grounding guard: a sentence with a number that is not in the data never reaches the screen.
    // Tool results (A4, computed on the server from the client's data) count as data.
    const evidence = JSON.stringify(context) + text + JSON.stringify(r.tools ?? [])
    if (!grounded(r.text, evidence)) {
      const data = await dataAnswer(client, text, language)
      if (data) return data
      const local = localAnswer(client, text, settings, 'chat')
      return local.hints.length ? local : { hints: [], entry: notice(T.discarded) }
    }
    if (r.hint && !grounded(r.hint.text, evidence)) r.hint = null
    if (r.next && !grounded(r.next, evidence)) r.next = null
    const topicId = r.module?.id ?? words(text).slice(0, 2).join('-')
    // For a known topic the sentence to the client is the computed one: the model tends to pin figures on the wrong subject.
    const known = r.supported ? topicsFor(client, language).find((t) => t.id === topicId) : undefined
    if (known) r.hint = { text: known.say, why: known.why }
    return {
      entry: { id: nextId(), role: 'ki', origin: 'chat', sources: r.sources ?? [], text: r.text, ...(r.supported ? pickModule(client, settings, r.module) : {}) },
      hints: r.supported && r.hint ? [hint(topicId, labelOf(client, topicId, language), r.hint.text, r.hint.why, 'info', 'chat', T.asked(text))] : [],
      next: r.supported && r.next ? { heard: text, text: r.next, topic: topicId } : undefined,
    }
  } catch (e) {
    const data = await dataAnswer(client, text, language)
    const fallback = data ?? localAnswer(client, text, settings, 'chat')
    return { ...fallback, entry: { ...fallback.entry, text: `${T.down(provider, e instanceof Error ? e.message : e)}\n\n${(fallback.entry as { text: string }).text}` } }
  }
}

function localThink(client: Client, segments: Segment[], settings: Settings): Thought {
  const lines: TranscriptLine[] = segments.map((s) => ({ speaker: s.speaker === 'Berater' ? 'Berater' : 'Kunde', text: s.text }))
  const thought: Thought = { lines, hints: [] }
  for (const line of lines) {
    const found = detectTopics(client, line.text, settings.language)
    if (!found.length) continue
    const t = found[0]
    if (line.speaker === 'Berater') { thought.advisor = { heard: line.text, text: t.next, topic: t.id }; continue }
    thought.customer = { heard: line.text, text: t.say, topic: t.id }
    thought.hints.push(...found.map((f) => hint(f.id, f.label, f.say, f.why, f.severity, 'gespraech', TEXT[settings.language].heard(line.text))))
    thought.insight = { id: nextId(), role: 'ki', origin: 'gespraech', sources: t.sources, text: t.insight[settings.detail], ...pickModule(client, settings, t.module && { id: t.id, confidence: t.module.confidence }) }
  }
  return thought
}

type AnalyseResult = {
  segments?: { speaker: string; text: string }[]
  customer?: { heard: string; text: string; why?: string; topic: string } | null
  advisor?: { heard: string; text: string; topic: string } | null
  insight?: { text: string; sources?: string[]; module?: { id: string; confidence: number } | null } | null
}

// Wertet neu Gesprochenes aus. Sprecher-Kennungen aus der Transkription ordnet das Modell den Rollen zu.
export async function think(client: Client, transcript: TranscriptLine[], segments: Segment[], settings: Settings, status: Status): Promise<Thought> {
  const provider = activeProvider(settings, status)
  if (!provider) return localThink(client, segments, settings)
  const language = settings.language
  try {
    const news = await fetchNews(client.ref, language)
    const context = contextFor(client, news, language)
    const r = await post<AnalyseResult>('/api/analyse', { provider, language, detail: settings.detail, context, modules: catalogue(client, language), transcript: transcript.slice(-8), segments })
    // Grounding guard, as in `answer`: ungrounded parts fall back to the deterministic topic or are dropped.
    const evidence = JSON.stringify(context) + segments.map((s) => s.text).join(' ')
    const local = localThink(client, segments, settings)
    if (r.customer && !grounded(r.customer.text, evidence)) r.customer = local.customer ? { ...local.customer, why: '' } : null
    if (r.advisor && !grounded(r.advisor.text, evidence)) r.advisor = local.advisor ?? null
    if (r.insight && !grounded(r.insight.text, evidence)) r.insight = null
    // The model only assigns roles to anonymous speaker ids. It must not add lines: it sometimes echoes context back.
    const known = segments.every((x) => x.speaker === 'Kunde' || x.speaker === 'Berater')
    const lines: TranscriptLine[] = (known || !r.segments?.length ? segments : r.segments.slice(-segments.length)).map((s) => ({ speaker: s.speaker === 'Berater' ? 'Berater' : 'Kunde', text: s.text }))
    return {
      lines,
      customer: r.customer ? { heard: r.customer.heard, text: r.customer.text, topic: r.customer.topic } : undefined,
      advisor: r.advisor ? { heard: r.advisor.heard, text: r.advisor.text, topic: r.advisor.topic } : undefined,
      hints: r.customer ? [hint(r.customer.topic, labelOf(client, r.customer.topic, language), r.customer.text, r.customer.why ?? '', 'info', 'gespraech', TEXT[language].heard(r.customer.heard))] : [],
      insight: r.insight ? { id: nextId(), role: 'ki', origin: 'gespraech', sources: r.insight.sources ?? [], text: r.insight.text, ...pickModule(client, settings, r.insight.module) } : undefined,
    }
  } catch {
    return localThink(client, segments, settings)
  }
}

// ---- the screen agent ------------------------------------------------------------------------
// One call decides what the advisor sees: which tiles in which order, the tile in focus, the graphs
// on the right, three talking points and, during a call, the answer to the client's last concern.
// It picks from the element catalogue in screen.ts; checkPlan drops anything it made up. Without a
// model (or when the call fails) the local plan follows the transcript by keyword.

export type Screen = { tiles: Tile[]; charts: Chart[] }
export type AgentEvent = { type: 'start'; call?: string; out?: string } | { type: 'transcript'; segments: Segment[] } | { type: 'said'; text: string }
export type Step = { plan: Plan; lines: TranscriptLine[]; covered?: string[]; cardOrder?: Card['type'][] }

// Card types the live agent may reorder mid-call: the optional insight cards, same set as
// server/ai/insights.ts ranks before the call. Never the talk track, metrics or context cards.
const RANKABLE_CARDS = new Set<Card['type']>(['flags', 'contradiction', 'stalenote', 'profile', 'todos'])
const talkTrackTexts = (briefing: Card[]): Set<string> => {
  const t = briefing.find((c): c is CardOf<'talktrack'> => c.type === 'talktrack')
  return new Set(t ? [t.open, ...t.mention, ...t.ask].map((l) => l.text) : [])
}

export function screenFor(client: Client, news: NewsItem[] = [], lang: Language = 'en'): Screen {
  const charts = chartsFor(client, topicsFor(client, lang).filter((t) => t.module).map((t) => ({ id: t.id, spec: t.module!.spec })))
  return { charts, tiles: tilesFor(client, charts, news) }
}

export async function agentStep(client: Client, screen: Screen, transcript: TranscriptLine[], said: string[], event: AgentEvent, settings: Settings, status: Status): Promise<Step> {
  const segments = event.type === 'transcript' ? event.segments : []
  const known = segments.every((x) => x.speaker === 'Kunde' || x.speaker === 'Berater')
  const asLines = (list: Segment[]): TranscriptLine[] => list.map((s) => ({ speaker: s.speaker === 'Berater' ? 'Berater' : 'Kunde', text: s.text }))
  const local = (): Step => {
    const lines = asLines(segments)
    const heard = [...lines].reverse().find((l) => l.speaker === 'Kunde')
    const last = event.type === 'said' ? event.text : lines[lines.length - 1]?.text
    const reply = heard ? localThink(client, [heard], settings).customer : undefined
    return { lines, plan: localPlan(screen.tiles, said, last, undefined, reply ? { heard: reply.heard, text: reply.text } : null) }
  }
  const provider = activeProvider(settings, status)
  if (!provider) return local()
  try {
    const news = await fetchNews(client.ref, settings.language)
    const context = contextFor(client, news, settings.language)
    const tiles = describeTiles(screen.tiles), charts = describeCharts(screen.charts)
    const r = await post<Record<string, unknown>>('/api/agent', {
      provider, language: settings.language, context, catalogue: CATALOGUE, tiles, charts, transcript: transcript.slice(-8), segments, said, event: event.type === 'said' ? `Berater sagte: ${event.text}` : event.type === 'start' && event.out ? `Ausgehender Anruf: der Berater ruft den Kunden von sich aus an. Anlass des Anrufs: ${event.out}. Richte Kacheln, Fokus und Vorschläge auf diesen Anlass aus.` : event.type === 'start' && event.call ? `Eingehender Anruf, soeben angenommen. Vermutlicher Anlass: ${event.call}. Richte Kacheln, Fokus, Grafiken und Vorschläge auf diesen Anlass aus.` : event.type,
    })
    const evidence = JSON.stringify(context) + JSON.stringify(tiles) + JSON.stringify(charts) + segments.map((s) => s.text).join(' ') + transcript.map((l) => l.text).join(' ')
    const fallback = local()
    const modelLines = Array.isArray(r.segments) ? (r.segments as Segment[]).slice(-segments.length) : []
    const lines = known || modelLines.length !== segments.length ? fallback.lines : asLines(modelLines)
    // Only exact talk-track lines / known card types survive: the model chooses among what already exists, never invents one.
    const knownTexts = talkTrackTexts(context.briefing)
    const covered = Array.isArray(r.covered) ? r.covered.filter((t): t is string => typeof t === 'string' && knownTexts.has(t)) : []
    const availableCards = new Set(context.briefing.map((c) => c.type).filter((t) => RANKABLE_CARDS.has(t)))
    const cardOrder = Array.isArray(r.cardOrder) ? [...new Set(r.cardOrder.filter((t): t is Card['type'] => typeof t === 'string' && availableCards.has(t as Card['type'])))] : []
    return {
      lines, plan: checkPlan(r, screen.tiles, screen.charts, (t) => grounded(t, evidence), { ...fallback.plan, answer: null }),
      ...(covered.length ? { covered } : {}), ...(cardOrder.length ? { cardOrder } : {}),
    }
  } catch {
    return local()
  }
}

// An outbound demo conversation, written by the model from this client's data and today's reasons to
// call. Lines with a number that is not in the data are dropped. Without a model: no script (the
// advisor talks through the microphone instead).
export async function demoScript(client: Client, reasons: string[], settings: Settings, status: Status): Promise<Segment[]> {
  const provider = activeProvider(settings, status)
  if (!provider) return []
  try {
    const context = contextFor(client, [], settings.language)
    const r = await post<{ script?: Segment[] }>('/api/demo-script', { provider, language: settings.language, context, reasons: reasons.map((text, i) => `GRUND ${i + 1}: ${text}`) })
    const evidence = JSON.stringify(context) + reasons.join(' ')
    return (r.script ?? []).filter((l) => (l.speaker === 'Kunde' || l.speaker === 'Berater') && l.text && grounded(l.text, evidence))
  } catch {
    return []
  }
}
