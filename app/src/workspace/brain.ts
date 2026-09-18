import { topics } from '../data/workspace'
import { signals } from '../data/mock'
import type { Client } from '../types'
import type { ChatEntry, Hint, ModuleSpec, Origin, Settings, Slot, Topic, TranscriptLine } from './types'

// Einzige Anschlussstelle für die KI. Gesprächsassistent und Berater-Chat fragen dieselbe Instanz mit
// demselben Kontext. Ist kein Anbieter konfiguriert oder schlägt ein Aufruf fehl, übernimmt der
// Beispielmodus (Stichwortsuche in den Beispieldaten), damit die Oberfläche immer bedienbar bleibt.

export type Status = { openai: boolean; apertus: boolean; elevenlabs: boolean }
export type Segment = { speaker: string; text: string }
export type Thought = { lines: TranscriptLine[]; customer?: Slot; advisor?: Slot; hints: Hint[]; insight?: ChatEntry }
export type Reply = { entry: ChatEntry; hints: Hint[]; next?: Slot }

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
    themen: (topics[client.ref] ?? []).map((t) => ({ thema: t.label, fakten: t.insight.detailliert, begruendung: t.why, quellen: t.sources })),
    marktsignale: signals.filter((s) => s.affected.some((a) => a.ref === client.ref)).map((s) => ({ titel: s.title, detail: s.detail, reichweite: s.reach, quelle: s.source, betroffenheit: s.affected.find((a) => a.ref === client.ref)?.exposure })),
  }
}

const catalogue = (client: Client) => (topics[client.ref] ?? []).filter((t) => t.module).map((t) => ({ id: t.id, titel: t.module!.spec.title, zeigt: t.module!.spec.note }))

function pickModule(client: Client, settings: Settings, chosen?: { id: string; confidence: number } | null): Pick<Extract<ChatEntry, { role: 'ki' }>, 'module' | 'offered'> {
  const spec: ModuleSpec | undefined = (topics[client.ref] ?? []).find((t) => t.id === chosen?.id)?.module?.spec
  if (!spec || !chosen) return {}
  const confidence = Math.round(Math.max(0, Math.min(100, chosen.confidence)))
  return settings.autoModules && confidence >= settings.confidence ? { module: spec } : { offered: { spec, confidence } }
}

export function detectTopics(ref: string, text: string): Topic[] {
  const w = words(text)
  return (topics[ref] ?? []).filter((t) => t.keywords.some((k) => w.some((x) => x.startsWith(k))))
}

const hint = (topicId: string, label: string, text: string, why: string, severity: Hint['severity'], origin: Origin, trigger: string): Hint => ({ id: nextId(), topicId, label, text, why, severity, origin, trigger })

// Ausgangslage ohne Gespräch: Gesprächseinstieg aus den Marktsignalen und die dringendsten Themen aus den Kundendaten.
export function openingHints(client: Client): Hint[] {
  const opener = signals.flatMap((s) => s.affected.filter((a) => a.ref === client.ref).map((a) => ({ a, s })))[0]
  const fromData = (topics[client.ref] ?? []).filter((t) => t.severity === 'risk' || t.severity === 'warn').slice(0, 2).map((t) => hint(t.id, t.label, t.say, t.why, t.severity, 'kundendaten', 'Aus den Kundendaten'))
  return opener ? [hint('einstieg', 'Gesprächseinstieg', opener.a.opener, opener.s.title, opener.a.severity, 'kundendaten', 'Gesprächseinstieg aus Marktsignal'), ...fromData] : fromData
}

// Short chip label: the known topic name, otherwise the model's own keyword.
const labelOf = (client: Client, topic: string) => (topics[client.ref] ?? []).find((t) => t.id === topic)?.label ?? topic.charAt(0).toUpperCase() + topic.slice(1)

export const question = (text: string): ChatEntry => ({ id: nextId(), role: 'berater', text })

const notice = (text: string): ChatEntry => ({ id: nextId(), role: 'ki', origin: 'chat', sources: [], text })

function localAnswer(client: Client, text: string, settings: Settings, origin: Origin): Reply {
  const found = detectTopics(client.ref, text)
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
    const r = await post<ChatResult>('/api/chat', { provider, detail: settings.detail, context: contextFor(client), modules: catalogue(client), question: text, history: history.slice(-6).map((e) => ({ rolle: e.role, text: e.text })) })
    const topicId = r.module?.id ?? words(text).slice(0, 2).join('-')
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
    const found = detectTopics(client.ref, line.text)
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

// Wertet neu Gesprochenes aus. Sprecher-Kennungen aus der Transkription ordnet das Modell den Rollen zu.
export async function think(client: Client, transcript: TranscriptLine[], segments: Segment[], settings: Settings, status: Status): Promise<Thought> {
  const provider = activeProvider(settings, status)
  if (!provider) return localThink(client, segments, settings)
  try {
    const r = await post<AnalyseResult>('/api/analyse', { provider, detail: settings.detail, context: contextFor(client), modules: catalogue(client), transcript: transcript.slice(-8), segments })
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
