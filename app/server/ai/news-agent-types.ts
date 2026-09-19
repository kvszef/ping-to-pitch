// Shapes of GET /api/news-agent. No Node imports here: the UI imports this file type-only.

export type Tone = 'negativ' | 'positiv' | 'neutral'
type Severity = 'risk' | 'warn' | 'ok' | 'info'
type Reach = 'Global' | 'Sektor' | 'Titel' | 'Hausmeinung'

/** Structurally the UI's NewsItem (src/types.ts) plus the agent's own fields. */
export type NewsAgentItem = {
  id: string
  time: string // HH:MM, Europe/Zurich
  title: string
  source: string
  reach: Reach
  affects: Record<string, { tag: string; position: string; meaning: string; severity: Severity }>
  url: string
  published: string // ISO
  security: string // which holding it matched
  weight: number // that holding's share of the client's assets, 0–100
  tone?: Tone
  why?: string // one German line: why it matters for this portfolio
}

export type NewsAgentResult = { items: NewsAgentItem[]; fetchedAt: string; errors?: string[] }
