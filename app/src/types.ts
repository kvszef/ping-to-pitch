export type Kind = 'fact' | 'interpretation' | 'action'
export type Severity = 'risk' | 'warn' | 'ok' | 'info'

// A briefing is an ordered list of cards. Add a variant here, a component in
// cards/, and one line in cards/registry.tsx — nothing else needs to change.
export type Card =
  | { type: 'headline'; text: string; sub?: string }
  | { type: 'metrics'; items: { label: string; value: string; delta?: string; tone?: Severity }[] }
  | { type: 'split'; title: string; left: { title: string; points: Point[] }; right: { title: string; points: Point[] } }
  | { type: 'flags'; title: string; items: { severity: Severity; text: string; source: string }[] }
  | { type: 'actions'; title: string; items: { text: string; why: string }[] }
  | { type: 'questions'; title: string; items: { q: string; a: string }[] }

export type Point = { text: string; kind: Kind; source?: string }

export type CardOf<T extends Card['type']> = Extract<Card, { type: T }>

export type Client = {
  ref: string
  name: string
  mandate: string
  aum: string
  context: string
  alerts: number
  briefing: Card[]
}

export type ChatMessage = { role: 'advisor' | 'assistant'; text: string }
