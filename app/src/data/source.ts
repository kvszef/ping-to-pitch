import type { Card, Client } from '../types'
import { fromRaw, parseClientFile } from './fromRaw'
import { clients as sampleClients } from './mock'

// Single data source of the UI. It asks the engine API first and falls back to local data when the
// endpoint is missing or fails (same idea as the example mode in workspace/brain.ts), so the UI works
// today and switches to the engine by itself once /api/clients and /api/briefing exist.
//
// Local data = the three sample clients from mock.ts + every client file uploaded in this session.

export type Tier = 'instant' | 'fast' | 'slow'
export const TIERS: Tier[] = ['instant', 'fast', 'slow']

// Contract v0 from PLAN.md. The UI only passes findings through for now.
export type Finding = {
  id: string
  check: string
  kind: 'fact' | 'interpretation' | 'action'
  severity: 'risk' | 'warn' | 'ok' | 'info'
  title: string
  detail?: string
  numbers?: Record<string, number>
  evidence: { source: string; ref?: string; quote?: string; date?: string }[]
  topic?: string
}

export type Briefing = { cards: Card[]; findings: Finding[]; origin: 'engine' | 'local'; order?: Card['type'][]; hidden?: Card['type'][] }
export type UploadResult = { ok: true; count: number; message: string; refs: string[] } | { ok: false; message: string }

// Which tier a card belongs to when the briefing comes from local data.
const tierOf: Record<Card['type'], Tier> = {
  talktrack: 'instant', metrics: 'instant', flags: 'instant', allocation: 'instant', context: 'instant', drivers: 'instant',
  headline: 'fast', actions: 'fast', questions: 'fast', proposal: 'fast',
  contradiction: 'fast', lookthrough: 'fast', stalenote: 'fast', todos: 'fast', callnote: 'fast',
  split: 'slow', // compares the portfolio with market news and the CIO view
  profile: 'slow', peers: 'slow', // need the whole history or the whole client base
}
const localDelay: Record<Tier, number> = { instant: 0, fast: 600, slow: 1500 }
const timeout: Record<Tier, number> = { instant: 4000, fast: 20000, slow: 60000 }

// Default reading order on the page, independent of the order in which tiers arrive. The model can
// move its ranked insight cards (see server/ai/insights.ts) ahead of this for one client; cards it
// did not rank keep their place here, appended after the ones it did.
const cardOrder: Card['type'][] = ['talktrack', 'headline', 'metrics', 'split', 'allocation', 'drivers', 'contradiction', 'proposal', 'lookthrough', 'stalenote', 'context', 'profile', 'peers', 'flags', 'actions', 'todos', 'questions', 'callnote']
export function sortCards(cards: Card[], modelOrder?: Card['type'][], hidden?: Card['type'][]): Card[] {
  const order = modelOrder?.length ? [...modelOrder, ...cardOrder.filter((t) => !modelOrder.includes(t))] : cardOrder
  const rank = (c: Card) => { const i = order.indexOf(c.type); return i < 0 ? order.length : i }
  const shown = hidden?.length ? cards.filter((c) => !hidden.includes(c.type)) : cards
  return shown.map((card, i) => ({ card, i })).sort((a, b) => rank(a.card) - rank(b.card) || a.i - b.i).map((x) => x.card)
}

// ---- session store for uploaded clients -------------------------------------------------------

const STORE_KEY = 'u1.uploadedClients'
let uploaded: Client[] = []

function readStore(): Client[] {
  try {
    const data: unknown = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '[]')
    return Array.isArray(data) ? data.map(normalise).filter((c): c is Client => c !== null) : []
  } catch { return [] }
}

function writeStore() {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(uploaded)) } catch { /* storage unavailable or full: the list lives in memory only */ }
}

export const samples = (): Client[] => sampleClients
export const isSample = (ref: string) => sampleClients.some((c) => c.ref === ref)

/** Sample clients plus the uploads of this session. Synchronous, used as the first paint. */
export function localClients(): Client[] {
  return mergeByRef(sampleClients, uploaded)
}

function mergeByRef(...lists: Client[][]): Client[] {
  const seen = new Map<string, Client>()
  for (const c of lists.flat()) if (!seen.has(c.ref)) seen.set(c.ref, c)
  return [...seen.values()]
}

// ---- engine API with fallback -----------------------------------------------------------------

// The Vite dev server answers unknown paths with index.html and status 200, so "ok" is not enough:
// only a JSON content type counts as an answer from the engine.
async function getJson(path: string, init?: RequestInit, ms = 4000): Promise<unknown | null> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), ms)
  try {
    const r = await fetch(path, { ...init, signal: abort.signal })
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null
    return await r.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, fallback = '–') => (typeof v === 'string' && v ? v : fallback)
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// Accepts a client in the UI shape (possibly without a briefing) or in the raw clients.json shape.
function normalise(item: unknown): Client | null {
  if (!isObj(item)) return null
  if (typeof item.ref !== 'string' || !item.ref) return typeof item.ClientRef === 'string' ? fromRaw(item, new Date()) : null
  return {
    ref: item.ref, name: text(item.name, item.ref), clientType: text(item.clientType), profile: text(item.profile), portfolioNr: text(item.portfolioNr),
    service: text(item.service), strategy: text(item.strategy), aum: text(item.aum), context: text(item.context), birthday: text(item.birthday),
    lastProfiling: text(item.lastProfiling), lastConsultation: text(item.lastConsultation), errors: count(item.errors), warnings: count(item.warnings),
    facts: isObj(item.facts) ? (item.facts as Client['facts']) : undefined,
    briefing: Array.isArray(item.briefing) ? (item.briefing as Card[]) : [],
  }
}

// Restored last, once every helper above is initialised.
uploaded = readStore()

// Clients from the last /api/clients answer, so their local briefing is found without refetching.
let listed: Client[] = []

export async function listClients(): Promise<Client[]> {
  const data = await getJson('/api/clients')
  const items = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.clients) ? data.clients : null
  const fromEngine = (items ?? []).map(normalise).filter((c): c is Client => c !== null)
  listed = fromEngine
  // Real data only. The sample clients are the offline fallback when the server has no list.
  return fromEngine.length ? mergeByRef(fromEngine, uploaded) : mergeByRef(sampleClients, uploaded)
}

export async function loadBriefing(ref: string, tier: Tier): Promise<Briefing> {
  if (!isSample(ref)) {
    const data = await getJson(`/api/briefing/${encodeURIComponent(ref)}?tier=${tier}`, undefined, timeout[tier])
    if (isObj(data) && Array.isArray(data.cards)) {
      return {
        cards: data.cards as Card[], findings: Array.isArray(data.findings) ? (data.findings as Finding[]) : [], origin: 'engine',
        order: Array.isArray(data.order) && data.order.length ? (data.order as Card['type'][]) : undefined,
        hidden: Array.isArray(data.hidden) && data.hidden.length ? (data.hidden as Card['type'][]) : undefined,
      }
    }
  }
  const client = localClients().find((c) => c.ref === ref) ?? listed.find((c) => c.ref === ref)
  await new Promise((resolve) => setTimeout(resolve, localDelay[tier]))
  return { cards: (client?.briefing ?? []).filter((c) => (tierOf[c.type] ?? 'instant') === tier), findings: [], origin: 'local' }
}

// Upload format: POST /api/clients/upload with the file content as the raw request body,
// `Content-Type: application/json` (no multipart). The engine may answer with any JSON; the UI then
// re-reads /api/clients. Whether or not the endpoint exists, the file is also mapped locally with
// fromRaw, so the uploaded clients open even if the engine has no briefing for them.
export async function uploadClients(file: File): Promise<UploadResult> {
  let content: string
  try { content = await file.text() } catch { return { ok: false, message: 'Die Datei konnte nicht gelesen werden.' } }
  const parsed = parseClientFile(content)
  if (!parsed.ok) return { ok: false, message: parsed.error }

  await getJson('/api/clients/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: content }, 15000)

  const now = new Date()
  const mapped = mergeByRef(parsed.raw.map((raw) => fromRaw(raw, now)))
  const fresh = mapped.filter((c) => !isSample(c.ref))
  uploaded = mergeByRef(fresh, uploaded)
  writeStore()
  const n = fresh.length
  if (!n) return { ok: false, message: 'Die Datei enthält nur Kunden, die bereits als Beispiel vorhanden sind.' }
  return { ok: true, count: n, refs: fresh.map((c) => c.ref), message: n === 1 ? '1 Kunde geladen' : `${n} Kunden geladen` }
}
