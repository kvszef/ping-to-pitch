import type { ClientFacts } from './data/facts.ts'
export type Kind = 'fact' | 'interpretation' | 'action'
export type Severity = 'risk' | 'warn' | 'ok' | 'info'

// Ein Briefing ist eine geordnete Liste von Karten. Neue Karte: Variante hier ergänzen,
// Komponente in cards/ anlegen, eine Zeile in cards/registry.tsx – sonst ändert sich nichts.
export type Card =
  | { type: 'headline'; text: string; sub?: string }
  | { type: 'metrics'; items: { label: string; value: string; delta?: string; tone?: Severity }[] }
  | { type: 'split'; title: string; left: { title: string; points: Point[] }; right: { title: string; points: Point[] } }
  | { type: 'allocation'; title: string; rows: { label: string; min: number; target: number; max: number; actual: number }[] }
  | { type: 'flags'; title: string; items: { severity: Severity; text: string; source: string }[] }
  | { type: 'actions'; title: string; items: { text: string; why: string }[] }
  | { type: 'questions'; title: string; items: { q: string; a: string }[] }
  | { type: 'drivers'; title: string; period: string; total: string; note: string; items: { name: string; weight: number; ret: number; contribution: number }[] }
  | { type: 'context'; title: string; facts: { label: string; value: string }[]; notes: { text: string; date: string }[]; changes: string[] }
  | { type: 'proposal'; title: string; status: string; summary: string; trades: { side: 'Kauf' | 'Verkauf' | 'Absicherung'; name: string; amount: string; share: string }[]; effects: { label: string; before: string; after: string; ok: boolean }[]; open?: string }
  | { type: 'contradiction'; title: string; wish: Evidence; verdict: string; exposure: { label: string; total: number; direct: number; viaFunds: number }; holdings: { name: string; weight: number; exposure: number; via: 'Fonds' | 'direkt' }[]; source: string; fix: { summary: string; trades: Trade[]; effects: Effect[]; source: string } }
  | { type: 'lookthrough'; title: string; dimension: 'Sektor' | 'Region' | 'Währung'; rows: { label: string; direct: number; viaFunds: number; flag?: string }[]; note?: string; source: string }
  | { type: 'stalenote'; title: string; note: Evidence; age: string; expired: string; reason: string; question: string; followUps?: string[] }
  | { type: 'profile'; title: string; persona: string; said: { text: string; date: string }[]; done: { label: string; value: string; source: string }[]; source: string }
  | { type: 'peers'; title: string; profile: string; n: number; metrics: { label: string; unit: string; signed?: boolean; min: number; median: number; max: number; value: number }[]; note?: string; source: string }
  | { type: 'todos'; title: string; items: { text: string; owner: 'Berater' | 'Kunde'; due?: string; done: boolean; overdue?: boolean; source: string }[] }
  | { type: 'callnote'; title: string; source: string; note: CallNote }
  | { type: 'talktrack'; title: string; open: TalkLine; mention: TalkLine[]; ask: TalkLine[]; avoid: TalkLine[]; reasons?: TalkLine[] }

// A quoted client note with its date and where it comes from.
export type Evidence = { quote: string; date: string; source: string }
export type Trade = { side: 'Kauf' | 'Verkauf' | 'Absicherung'; name: string; amount: string; share: string }
export type Effect = { label: string; before: string; after: string; ok: boolean }

// Same shape as `CallNote` in PLAN.md section 3, so the real one from the memory track drops in.
export type CallNote = {
  id: string; clientRef: string; date: string; confirmed: boolean
  proposed: { findingId?: string; text: string; reaction: 'accepted' | 'rejected' | 'open'; why?: string }[]
  promises: { text: string; due?: string; done: boolean }[]
  factUpdates: { note: string; status: 'confirmed' | 'outdated' | 'changed'; newValue?: string }[]
}

export type Point = { text: string; kind: Kind; source?: string }

// One spoken line of the 60-second talk track, always with the source it can be traced to.
export type TalkLine = { text: string; source: string; date?: string; detail?: string; severity?: Severity }

// A finding of the engine (contract v0 in PLAN.md), as far as the UI reads it.
export type EngineFinding = { id: string; check: string; kind: Kind; severity: Severity; title: string; detail?: string; numbers?: Record<string, number>; evidence: { source: string; ref?: string; quote?: string; date?: string }[]; topic?: string }

export type CardOf<T extends Card['type']> = Extract<Card, { type: T }>

export type Client = {
  ref: string
  name: string
  clientType: string
  profile: string
  portfolioNr: string
  service: string
  strategy: string
  aum: string
  context: string
  birthday: string
  lastProfiling: string
  lastConsultation: string
  errors: number
  warnings: number
  facts?: ClientFacts // key figures computed from a real client file; sample clients have none
  findings?: EngineFinding[] // the engine's findings from /api/briefing, when the server answered
  briefing: Card[]
}

export type Reach = 'Global' | 'Sektor' | 'Titel' | 'Hausmeinung'

export type Signal = {
  id: string
  title: string
  detail: string
  source: string
  time: string
  reach: Reach
  affected: { ref: string; severity: Severity; exposure: string; opener: string }[]
}

// Eine Meldung des Tages. `affects` hält je Kunde fest, welche Position betroffen ist und was das für ihn bedeutet.
export type NewsItem = {
  id: string
  time: string
  title: string
  source: string
  reach: Reach
  affects: Record<string, { tag: string; position: string; meaning: string; severity: Severity }>
}

export type IncomingCall = { ref: string; number: string; reason: string }

export type ChatMessage = { role: 'advisor' | 'assistant'; text: string }
