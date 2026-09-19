import type { Briefing60 } from '../../server/ai/briefing'
import type { Finding } from '../../engine/types'
import type { Lang } from '../../engine/lang.ts'
import { uiLang, withLang } from '../data/uiLang'

export type { Block, Briefing60, Line } from '../../server/ai/briefing'
export type { Finding }

export type ClientHeader = { ref: string; name: string; profile: string; esg: string; currency: string; aum: number; strategy: string; service: string; portfolios: number }
export type BriefingResponse = {
  client: ClientHeader
  briefing: Briefing60
  findings: Finding[]
  origin: { engine: string[]; stopgap: string[]; engineError?: string }
  llmError?: string
  now: string
}
export type Phrase = 'vorlage' | 'openai' | 'apertus'
export type ClientOption = { ref: string; name: string; profile: string; raw?: unknown }

async function json<T>(r: Response): Promise<T> {
  const data = await r.json().catch(() => ({ error: `Antwort ${r.status} ohne JSON` }))
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Fehler ${r.status}`)
  return data as T
}

export const loadClients = () => fetch('/api/briefing60/clients').then((r) => json<ClientOption[]>(r))

// The briefing is written in the advisor's language: `lang` in the query, and `language` in the body of the POST.
export function loadBriefing(option: ClientOption, phrase: Phrase, lang: Lang = uiLang()): Promise<BriefingResponse> {
  const q = phrase === 'vorlage' ? '' : `?phrase=${phrase}`
  return option.raw
    ? fetch(withLang(`/api/briefing60${q}`, lang), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: option.raw, language: lang }) }).then((r) => json<BriefingResponse>(r))
    : fetch(withLang(`/api/briefing60/${encodeURIComponent(option.ref)}${q}`, lang)).then((r) => json<BriefingResponse>(r))
}

export const loadStatus = () => fetch('/api/status').then((r) => json<{ openai: boolean; apertus: boolean }>(r)).catch(() => ({ openai: false, apertus: false }))

/** Reads a file shaped like clients.json into picker options. Names stay in the browser. */
export function clientsFromFile(text: string): ClientOption[] {
  const data: unknown = JSON.parse(text)
  const items = Array.isArray(data) ? data : typeof data === 'object' && data !== null && Array.isArray((data as { clients?: unknown }).clients) ? (data as { clients: unknown[] }).clients : [data]
  return items.filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && typeof (c as { ClientRef?: unknown }).ClientRef === 'string').map((c) => ({
    ref: c.ClientRef as string,
    name: (typeof c.Company === 'string' && c.Company) || [c.FirstName, c.LastName].filter((x) => typeof x === 'string').join(' ') || (c.ClientRef as string),
    profile: typeof c.RiskProfileName === 'string' ? c.RiskProfileName : '',
    raw: c,
  }))
}
