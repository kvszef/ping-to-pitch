import type { Severity } from '../types'

export type Detail = 'kurz' | 'standard' | 'detailliert'

export type Provider = 'openai' | 'apertus'

export type Settings = {
  provider: Provider
  record: boolean
  detail: Detail
  autoModules: boolean
  confidence: number // Schwelle 0–100, ab der ein Grafikmodul automatisch erscheint
  chatOpen: boolean // chat pane expanded or folded into a slim strip
  clientsOpen: boolean // client list expanded or folded into a slim strip
  graphsOpen: boolean // graph column shown, or folded so the text side gets the full width
}

export type Bar = { label: string; value: number; min?: number; max?: number }

export type ModuleSpec =
  | { type: 'balken'; title: string; unit: string; note: string; bars: Bar[] }
  | { type: 'verlauf'; title: string; unit: string; note: string; points: { label: string; value: number }[] }

export type ModuleOf<T extends ModuleSpec['type']> = Extract<ModuleSpec, { type: T }>

// Ein Thema bündelt, was die KI zu einem Gesprächsgegenstand weiss: was der Berater
// dem Kunden sagen kann (Gesprächsassistent) und was er selbst wissen muss (Berater-Chat).
export type Topic = {
  id: string
  label: string
  keywords: string[]
  say: string
  why: string
  next: string // vorausschauender nächster Schritt, sobald der Berater das Thema angesprochen hat
  severity: Severity
  insight: Record<Detail, string>
  sources: string[]
  module?: { spec: ModuleSpec; confidence: number }
}

export type TranscriptLine = { speaker: 'Kunde' | 'Berater'; text: string }

export type Origin = 'gespraech' | 'chat' | 'kundendaten'

export type Hint = { id: string; topicId: string; label: string; text: string; why: string; severity: Severity; origin: Origin; trigger: string }

export type ChatEntry =
  | { id: string; role: 'berater'; text: string }
  | { id: string; role: 'ki'; text: string; sources: string[]; module?: ModuleSpec; offered?: { spec: ModuleSpec; confidence: number }; origin?: Origin }

export type Slot = { heard: string; text: string; topic: string }
