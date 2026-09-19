import { topics } from '../data/workspace'
import { signals } from '../data/mock'
import type { Client } from '../types'
import { briefFor } from './brief'
import { deriveTopics } from './derive'
import { grounded } from './grounding'
import type { ChatEntry, Hint, ModuleSpec, Origin, Settings, Slot, Topic, TranscriptLine } from './types'

// Einzige Anschlussstelle für die KI. Gesprächsassistent und Berater-Chat fragen dieselbe Instanz mit
// demselben Kontext. Ist kein Anbieter konfiguriert oder schlägt ein Aufruf fehl, übernimmt der
// Beispielmodus (Stichwortsuche in den Beispieldaten), damit die Oberfläche immer bedienbar bleibt.

export type Status = { openai: boolean; apertus: boolean; elevenlabs: boolean }
export type Segment = { speaker: string; text: string }
export type Thought = { lines: TranscriptLine[]; customer?: Slot; advisor?: Slot; hints: Hint[]; insight?: ChatEntry }
export type Reply = { entry: ChatEntry; hints: Hint[]; next?: Slot }

// Hand-written topics for the sample clients, derived ones for every real client file.
const derived = new WeakMap<Client, Topic[]>()
export function topicsFor(client: Client): Topic[] {
  if (topics[client.ref]) return topics[client.ref]
  if (!derived.has(client)) derived.set(client, deriveTopics(client))
  return derived.get(client)!
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

async function post<T>(path: string, payload: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error ?? `Fehler ${r.status}`)
  return data
}

// Was das Modell über den Kunden erfährt: nur Fakten aus den Daten, ohne Namen und Kontonummern.
function contextFor(client: Client) {
  return {
    kunde: { kennung: client.ref, kundenprofil: client.profile, strategie: client.strategy, anlagedienstleistung: client.service, vermoegen: client.aum, anlass: client.context, letzteBeratung: client.lastConsultation },
    briefing: client.briefing,
    kennzahlen: client.facts ? { ...client.facts, performance: client.facts.performance && { ...client.facts.performance, series: undefined } } : undefined,
    themen: topicsFor(client).map((t) => ({ thema: t.label, fakten: t.insight.detailliert, begruendung: t.why, quellen: t.sources })),
    marktsignale: signals.filter((s) => s.affected.some((a) => a.ref === client.ref)).map((s) => ({ titel: s.title, detail: s.detail, reichweite: s.reach, quelle: s.source, betroffenheit: s.affected.find((a) => a.ref === client.ref)?.exposure })),
  }
}

const catalogue = (client: Client) => topicsFor(client).filter((t) => t.module).map((t) => ({ id: t.id, titel: t.module!.spec.title, zeigt: t.module!.spec.note }))

function pickModule(client: Client, settings: Settings, chosen?: { id: string; confidence: number } | null): Pick<Extract<ChatEntry, { role: 'ki' }>, 'module' | 'offered'> {
  const spec: ModuleSpec | undefined = topicsFor(client).find((t) => t.id === chosen?.id)?.module?.spec
  if (!spec || !chosen) return {}
  const confidence = Math.round(Math.max(0, Math.min(100, chosen.confidence)))
  return settings.autoModules && confidence >= settings.confidence ? { module: spec } : { offered: { spec, confidence } }
}

export function detectTopics(who: string | Client, text: string): Topic[] {
  const w = words(text)
  return (typeof who === 'string' ? topics[who] ?? [] : topicsFor(who)).filter((t) => t.keywords.some((k) => w.some((x) => x.startsWith(k))))
}

const hint = (topicId: string, label: string, text: string, why: string, severity: Hint['severity'], origin: Origin, trigger: string): Hint => ({ id: nextId(), topicId, label, text, why, severity, origin, trigger })

// Ausgangslage ohne Gespräch: Gesprächseinstieg aus den Marktsignalen und die dringendsten Themen aus den Kundendaten.
export function openingHints(client: Client): Hint[] {
  const opener = signals.flatMap((s) => s.affected.filter((a) => a.ref === client.ref).map((a) => ({ a, s })))[0]
  const all = topicsFor(client)
  const urgent = all.filter((t) => t.severity === 'risk' || t.severity === 'warn')
  const fromData = (urgent.length ? urgent : all).slice(0, opener ? 2 : 3).map((t) => hint(t.id, t.label, t.say, t.why, t.severity, 'kundendaten', 'Aus den Kundendaten'))
  return opener ? [hint('einstieg', 'Gesprächseinstieg', opener.a.opener, opener.s.title, opener.a.severity, 'kundendaten', 'Gesprächseinstieg aus Marktsignal'), ...fromData] : fromData
}

// Short chip label: the known topic name, otherwise the model's own keyword.
const labelOf = (client: Client, topic: string) => topicsFor(client).find((t) => t.id === topic)?.label ?? topic.charAt(0).toUpperCase() + topic.slice(1)

export const question = (text: string): ChatEntry => ({ id: nextId(), role: 'berater', text })

const notice = (text: string): ChatEntry => ({ id: nextId(), role: 'ki', origin: 'chat', sources: [], text })

function localAnswer(client: Client, text: string, settings: Settings, origin: Origin): Reply {
  const found = detectTopics(client, text)
  if (!found.length) return { hints: [], entry: notice('Dazu liegen für diesen Kunden keine Daten vor. Ich stelle keine Vermutung an.') }
  const t = found[0]
  return {
    entry: { id: nextId(), role: 'ki', origin, sources: t.sources, text: t.insight[settings.detail], ...pickModule(client, settings, t.module && { id: t.id, confidence: t.module.confidence }) },
    hints: found.map((f) => hint(f.id, f.label, f.say, f.why, f.severity, origin, `Frage des Beraters: «${text}»`)),
    next: { heard: text, text: t.next, topic: t.id },
  }
}

type ChatResult = { supported: boolean; text: string; sources?: string[]; module?: { id: string; confidence: number } | null; hint?: { text: string; why: string } | null; next?: string | null }

export async function answer(client: Client, text: string, settings: Settings, status: Status, history: ChatEntry[]): Promise<Reply> {
  const provider = activeProvider(settings, status)
  if (!provider) { await new Promise((r) => setTimeout(r, 400)); return localAnswer(client, text, settings, 'chat') }
  try {
    const context = contextFor(client)
    const r = await post<ChatResult>('/api/chat', { provider, detail: settings.detail, context, modules: catalogue(client), question: text, history: history.slice(-6).map((e) => ({ rolle: e.role, text: e.text })) })
    // Grounding guard: a sentence with a number that is not in the data never reaches the screen.
    const evidence = JSON.stringify(context) + text
    if (!grounded(r.text, evidence)) {
      const local = localAnswer(client, text, settings, 'chat')
      return local.hints.length ? local : { hints: [], entry: notice('Die Antwort des Modells enthielt eine Zahl, die nicht in den Kundendaten steht. Sie wurde verworfen.') }
    }
    if (r.hint && !grounded(r.hint.text, evidence)) r.hint = null
    if (r.next && !grounded(r.next, evidence)) r.next = null
    const topicId = r.module?.id ?? words(text).slice(0, 2).join('-')
    // For a known topic the sentence to the client is the computed one: the model tends to pin figures on the wrong subject.
    const known = r.supported ? topicsFor(client).find((t) => t.id === topicId) : undefined
    if (known) r.hint = { text: known.say, why: known.why }
    return {
      entry: { id: nextId(), role: 'ki', origin: 'chat', sources: r.sources ?? [], text: r.text, ...(r.supported ? pickModule(client, settings, r.module) : {}) },
      hints: r.supported && r.hint ? [hint(topicId, labelOf(client, topicId), r.hint.text, r.hint.why, 'info', 'chat', `Frage des Beraters: «${text}»`)] : [],
      next: r.supported && r.next ? { heard: text, text: r.next, topic: topicId } : undefined,
    }
  } catch (e) {
    const fallback = localAnswer(client, text, settings, 'chat')
    return { ...fallback, entry: { ...fallback.entry, text: `[${provider} nicht erreichbar, Beispielmodus: ${e instanceof Error ? e.message : e}]\n\n${(fallback.entry as { text: string }).text}` } }
  }
}

function localThink(client: Client, segments: Segment[], settings: Settings): Thought {
  const lines: TranscriptLine[] = segments.map((s) => ({ speaker: s.speaker === 'Berater' ? 'Berater' : 'Kunde', text: s.text }))
  const thought: Thought = { lines, hints: [] }
  for (const line of lines) {
    const found = detectTopics(client, line.text)
    if (!found.length) continue
    const t = found[0]
    if (line.speaker === 'Berater') { thought.advisor = { heard: line.text, text: t.next, topic: t.id }; continue }
    thought.customer = { heard: line.text, text: t.say, topic: t.id }
    thought.hints.push(...found.map((f) => hint(f.id, f.label, f.say, f.why, f.severity, 'gespraech', `Kunde: «${line.text}»`)))
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

// The three best sentences to say next, phrased by the model from this client's data. Before the call
// they open it; during the call they follow the transcript. Ungrounded ones are dropped, the rest is
// filled from the computed topics, so there are always up to three.
type OpenersResult = { openers?: { label: string; text: string; why?: string; topic?: string }[] }
export async function suggest(client: Client, transcript: TranscriptLine[], settings: Settings, status: Status): Promise<Hint[]> {
  // Offline: the computed brief items are already short talking points with their figure.
  const spokenAlready = new Set(transcript.map((l) => l.text))
  const fallback = briefFor(client).filter((b) => !spokenAlready.has(b.text)).slice(transcript.length ? 3 : 0).concat(briefFor(client)).slice(0, 3)
    .map((b) => hint(b.topics?.[0] ?? b.id, b.group, `${b.figure ? `${b.figure} ` : ''}${b.text}`.replace(/\.$/, ''), b.source, b.severity ?? 'info', transcript.length ? 'gespraech' : 'kundendaten', 'Aus den Kundendaten'))
  const provider = activeProvider(settings, status)
  if (!provider) return fallback
  try {
    const context = contextFor(client)
    const r = await post<OpenersResult>('/api/openers', { provider, context, transcript: transcript.slice(-8) })
    const evidence = JSON.stringify(context) + transcript.map((l) => l.text).join(' ')
    const origin: Origin = transcript.length ? 'gespraech' : 'kundendaten'
    const trigger = transcript.length ? 'Nächster Schritt aus dem Gespräch' : 'Gesprächseinstieg'
    const fromModel = (r.openers ?? []).filter((o) => o.text && grounded(o.text, evidence)).slice(0, 3)
      .map((o) => hint(o.topic || words(o.label).join('-'), o.label, o.text, o.why ?? '', topicsFor(client).find((t) => t.id === o.topic)?.severity ?? 'info', origin, trigger))
    return [...fromModel, ...fallback.filter((f) => !fromModel.some((m) => m.topicId === f.topicId))].slice(0, 3)
  } catch {
    return fallback
  }
}

// Wertet neu Gesprochenes aus. Sprecher-Kennungen aus der Transkription ordnet das Modell den Rollen zu.
export async function think(client: Client, transcript: TranscriptLine[], segments: Segment[], settings: Settings, status: Status): Promise<Thought> {
  const provider = activeProvider(settings, status)
  if (!provider) return localThink(client, segments, settings)
  try {
    const context = contextFor(client)
    const r = await post<AnalyseResult>('/api/analyse', { provider, detail: settings.detail, context, modules: catalogue(client), transcript: transcript.slice(-8), segments })
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
      hints: r.customer ? [hint(r.customer.topic, labelOf(client, r.customer.topic), r.customer.text, r.customer.why ?? '', 'info', 'gespraech', `Kunde: «${r.customer.heard}»`)] : [],
      insight: r.insight ? { id: nextId(), role: 'ki', origin: 'gespraech', sources: r.insight.sources ?? [], text: r.insight.text, ...pickModule(client, settings, r.insight.module) } : undefined,
    }
  } catch {
    return localThink(client, segments, settings)
  }
}
