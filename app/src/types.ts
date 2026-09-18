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

export type Point = { text: string; kind: Kind; source?: string }

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
  affects: Record<string, { position: string; meaning: string; severity: Severity }>
}

export type IncomingCall = { ref: string; number: string; reason: string }

export type ChatMessage = { role: 'advisor' | 'assistant'; text: string }
