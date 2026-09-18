import { topics } from '../data/workspace'
import { signals } from '../data/mock'
import type { Client } from '../types'
import type { ChatEntry, Hint, Origin, Settings, Topic } from './types'

// Einzige Anschlussstelle für das LLM. Beide Module – Gesprächsassistent und Berater-Chat –
// fragen dieselbe Instanz mit demselben Kontext. Im Beispiel ersetzt eine Stichwortsuche das Modell.

let counter = 0
const nextId = () => `e${++counter}`

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

export function detectTopics(ref: string, text: string): Topic[] {
  const w = words(text)
  return (topics[ref] ?? []).filter((t) => t.keywords.some((k) => w.some((x) => x.startsWith(k))))
}

export function hintFor(topic: Topic, origin: Origin, trigger: string): Hint {
  return { id: nextId(), topicId: topic.id, text: topic.say, why: topic.why, severity: topic.severity, origin, trigger }
}

// Ausgangslage ohne Gespräch: die dringendsten Themen aus den Kundendaten und ein Gesprächseinstieg aus den Marktsignalen.
export function openingHints(client: Client): Hint[] {
  const opener = signals.flatMap((s) => s.affected.filter((a) => a.ref === client.ref).map((a) => ({ a, s })))[0]
  const fromData = (topics[client.ref] ?? [])
    .filter((t) => t.severity === 'risk' || t.severity === 'warn')
    .slice(0, 2)
    .map((t) => hintFor(t, 'kundendaten', 'Aus den Kundendaten'))
  if (!opener) return fromData
  return [{ id: nextId(), topicId: 'einstieg', text: opener.a.opener, why: opener.s.title, severity: opener.a.severity, origin: 'kundendaten', trigger: 'Gesprächseinstieg aus Marktsignal' }, ...fromData]
}

export function question(text: string): ChatEntry {
  return { id: nextId(), role: 'berater', text }
}

export async function answer(client: Client, text: string, settings: Settings, origin: Origin = 'chat'): Promise<{ entry: ChatEntry; topics: Topic[] }> {
  await new Promise((r) => setTimeout(r, 500))
  const found = detectTopics(client.ref, text)
  if (!found.length) {
    return { topics: [], entry: { id: nextId(), role: 'ki', origin, sources: [], text: 'Dazu liegen für diesen Kunden keine Daten vor. Ich stelle keine Vermutung an.' } }
  }
  const topic = found[0]
  const auto = topic.module && settings.autoModules && topic.module.confidence >= settings.confidence
  return {
    topics: found,
    entry: {
      id: nextId(), role: 'ki', origin, sources: topic.sources,
      text: topic.insight[settings.detail],
      module: auto ? topic.module!.spec : undefined,
      offered: topic.module && !auto ? topic.module : undefined,
    },
  }
}
