// Engine contracts (PLAN.md, "Contracts v0"). Change them here, in one place, and say so in the commit.
import type { ReferenceIndex } from './data.ts'
import type { PeerStats } from './peers.ts'
import type { Wish } from './wishes.ts'

export type Kind = 'fact' | 'interpretation' | 'action' // same vocabulary as src/types.ts
export type Severity = 'risk' | 'warn' | 'ok' | 'info'

export type Evidence = { source: string; ref?: string; quote?: string; date?: string }

// Same shape as clients.json → Proposals[], only the parts a fix needs.
export type DraftProposal = {
  PortfolioId?: number
  Reason: string
  SecurityPositions: { SecurityId?: number; Isin?: string; SecurityName: string; ProposalValuePercentage: number; TotalAmountInProposalCurrency?: number }[]
}

export type Finding = {
  id: string // stable: `${check}:${clientRef}:${subject}`. Memory uses it to know "already rejected".
  check: string // 'portfolio.allocation'
  kind: Kind
  severity: Severity
  title: string // German (Swiss spelling), one line, written for the advisor
  detail?: string
  numbers?: Record<string, number> // raw, fractions 0–1, never pre-formatted
  evidence: Evidence[]
  fix?: DraftProposal
  topic?: string // links a finding to a conversation topic / chart module
}

export type CallNote = {
  id: string; clientRef: string; date: string; confirmed: boolean
  proposed: { findingId?: string; text: string; reaction: 'accepted' | 'rejected' | 'open'; why?: string }[]
  promises: { text: string; due?: string; done: boolean }[]
  factUpdates: { note: string; status: 'confirmed' | 'outdated' | 'changed'; newValue?: string }[]
}

// A client exactly as it comes from clients.json or an uploaded file. Never trusted: read it through data.ts.
export type RawClient = Record<string, unknown>

// wishes: notes the built-in rules do not know, classified by the server's AI step (note text → menu item).
// Absent without a model; the engine then reports such notes as "not checked" instead of guessing.
// peers: aggregate returns of clients with the same risk profile (engine/peers.ts). Absent: no peer comparison.
export type CheckContext = { ref: ReferenceIndex; now: Date; memory?: CallNote[]; wishes?: Record<string, Wish | 'unknown'>; peers?: PeerStats }
export type Check = (client: RawClient, ctx: CheckContext) => Finding[]
