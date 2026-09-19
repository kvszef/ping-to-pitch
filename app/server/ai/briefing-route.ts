// HTTP side of the briefing writer, mounted by server/api.ts.
//   GET  /api/briefing60/:ref?phrase=openai|apertus   a client from core-case clients.json
//   POST /api/briefing60?phrase=…                     body { client }: one raw client from an uploaded file
// Findings come from the engine; checks the engine does not deliver yet fall back to the stopgap.
// The model only ever sees findings (titles and details): no names, no account data.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { indexReference, run, type ReferenceIndex } from '../../engine/run.ts'
import { composeBriefing, writeBriefing, type Briefing60 } from './briefing.ts'
import { factCards, talkTrackCard } from './cards.ts'
import { rankCards } from './insights.ts'
import type { Finding } from './findings.ts'
import { provisionalFindings } from './provisional-findings.ts'
import { peerStats, type PeerStats } from '../../engine/peers.ts'
import { readClient } from '../../engine/data.ts'
import { classifyNote } from '../../engine/wishes.ts'
import { classifyNotes, type WishAnswers } from './wishes.ts'
import { notesFor } from '../memory/store.ts'

type Provider = 'openai' | 'apertus'
type Message = { role: 'system' | 'user'; content: string }
export type Llm = { complete: (provider: Provider, messages: Message[]) => Promise<unknown>; ready: (provider: Provider) => boolean }

const DATA = resolve(process.cwd(), '../core-case/portfolio-data')
let loaded: Promise<{ clients: Record<string, unknown>[]; reference: unknown; index: ReferenceIndex }> | null = null
function data() {
  loaded ??= (async () => {
    const [clients, reference] = await Promise.all(['clients.json', 'reference.json'].map(async (f) => JSON.parse(await readFile(resolve(DATA, f), 'utf8'))))
    return { clients: Array.isArray(clients) ? clients : [], reference, index: indexReference(reference) }
  })()
  loaded.catch(() => { loaded = null })
  return loaded
}

// Notes the engine's rules do not know go to the model as bare texts (never names or account data); the
// answer reaches the engine as ctx.wishes. No model, no key or an error: nothing is passed and the engine
// reports those notes as "not checked".
async function wishesFor(raw: Record<string, unknown>, index: ReferenceIndex, llm: Llm): Promise<WishAnswers | undefined> {
  const provider = providerFor(llm)
  const unknown = readClient(raw, index).notes.map((n) => n.text).filter((t) => !classifyNote(t))
  if (!provider || !unknown.length) return undefined
  try { return await classifyNotes(unknown, (m) => llm.complete(provider, m)) } catch { return undefined }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// What the page shows in its header. Stays in the browser, never goes to the model.
function header(raw: Record<string, unknown>) {
  const portfolios = Array.isArray(raw.Portfolios) ? (raw.Portfolios as Record<string, unknown>[]) : []
  const main = [...portfolios].sort((a, b) => num(b.AssetsUnderManagementInDefaultCurrency) - num(a.AssetsUnderManagementInDefaultCurrency))[0] ?? {}
  return {
    ref: str(raw.ClientRef), name: str(raw.Company) || [str(raw.FirstName), str(raw.LastName)].filter(Boolean).join(' ') || str(raw.ClientRef),
    profile: str(raw.RiskProfileName) || 'ohne Risikoprofil', esg: str(raw.EsgProfileName), currency: str(raw.ReportingCurrency) || 'CHF',
    aum: num(raw.AssetsUnderManagementInDefaultCurrency) || portfolios.reduce((n, p) => n + num(p.AssetsUnderManagementInDefaultCurrency), 0),
    strategy: str(main.StrategyName), service: str(main.InvestmentServiceName), portfolios: portfolios.length,
  }
}

/** Engine findings win per check; the stopgap fills every check the engine has not delivered yet. */
export function mergeFindings(engine: Finding[], provisional: Finding[]): { findings: Finding[]; engineChecks: string[]; stopgapChecks: string[] } {
  const engineChecks = [...new Set(engine.map((f) => f.check))]
  const covered = new Set(engineChecks)
  const rest = provisional.filter((f) => !covered.has(f.check))
  return { findings: [...engine, ...rest], engineChecks, stopgapChecks: [...new Set(rest.map((f) => f.check))] }
}

export async function briefing60(method: string, url: string, body: Buffer | null, llm: Llm) {
  const u = new URL(url, 'http://local')
  const { clients, reference, index } = await data()
  let raw: Record<string, unknown> | undefined
  if (method === 'POST') {
    const parsed: unknown = JSON.parse(body?.toString('utf8') || '{}')
    const c = typeof parsed === 'object' && parsed !== null && 'client' in parsed ? (parsed as { client: unknown }).client : parsed
    raw = typeof c === 'object' && c !== null && !Array.isArray(c) ? (c as Record<string, unknown>) : undefined
  } else {
    const ref = decodeURIComponent(u.pathname.split('/')[3] ?? '')
    raw = uploaded.get(ref) ?? clients.find((c) => c.ClientRef === ref)
  }
  if (!raw) return { status: 404, data: { error: 'Kunde nicht gefunden' } }

  const now = new Date()
  const wishes = await wishesFor(raw, index, llm)
  let engine: Finding[] = []
  let engineError: string | undefined
  try {
    engine = run(raw, { ref: index, now, memory: notesFor(str(raw.ClientRef)), wishes, peers: peersOf(clients, index) })
  } catch (e) {
    engineError = e instanceof Error ? e.message : String(e)
  }
  const merged = mergeFindings(engine, provisionalFindings(raw, reference, now))
  let briefing: Briefing60 = composeBriefing(str(raw.ClientRef), merged.findings)

  const phrase = u.searchParams.get('phrase')
  let llmError: string | undefined
  if (phrase === 'openai' || phrase === 'apertus') {
    if (!llm.ready(phrase)) llmError = `${phrase === 'openai' ? 'OpenAI' : 'Apertus'} ist nicht konfiguriert, es bleibt bei der Vorlage.`
    else {
      try {
        briefing = await writeBriefing(briefing, merged.findings, (messages) => llm.complete(phrase, messages), phrase)
      } catch (e) {
        llmError = `KI nicht erreichbar, es bleibt bei der Vorlage (${e instanceof Error ? e.message.slice(0, 120) : 'Fehler'})`
      }
    }
  }

  return {
    status: 200,
    data: {
      client: header(raw), briefing, findings: merged.findings,
      origin: { engine: merged.engineChecks, stopgap: merged.stopgapChecks, engineError, failed: (engine as { failed?: unknown }).failed },
      llmError, now: now.toISOString().slice(0, 10),
    },
  }
}

// ---- main app: GET /api/briefing/:ref?tier=instant|fast|slow, POST /api/clients/upload ----------

// Client files uploaded in this server session (the live demo hands over three unseen ones).
const uploaded = new Map<string, Record<string, unknown>>()

// Peer statistics for context.peers over the case clients plus uploads: computed once, rebuilt after an upload.
let peerCache: PeerStats | null = null
function peersOf(clients: Record<string, unknown>[], index: ReferenceIndex): PeerStats {
  peerCache ??= peerStats([...clients, ...uploaded.values()], index)
  return peerCache
}

export function uploadClients(body: Buffer) {
  const data: unknown = JSON.parse(body.toString('utf8') || 'null')
  const items = Array.isArray(data) ? data : typeof data === 'object' && data !== null && Array.isArray((data as { clients?: unknown }).clients) ? (data as { clients: unknown[] }).clients : [data]
  const ok = items.filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && typeof (c as { ClientRef?: unknown }).ClientRef === 'string')
  for (const c of ok) uploaded.set(str(c.ClientRef), c)
  if (ok.length) peerCache = null
  return { status: ok.length ? 200 : 400, data: ok.length ? { ok: true, count: ok.length, refs: ok.map((c) => str(c.ClientRef)) } : { error: 'Keine Kunden mit ClientRef in der Datei' } }
}

const providerFor = (llm: Llm): Provider | null => (llm.ready('openai') ? 'openai' : llm.ready('apertus') ? 'apertus' : null)

/** The talk track (mention/ask points) and findings for one client, for server/calls.ts to draft a CallNote against once a call ends. */
export async function templateFor(ref: string, llm: Llm): Promise<{ template: Briefing60; findings: Finding[] } | null> {
  const { clients, reference, index } = await data()
  const raw = uploaded.get(ref) ?? clients.find((c) => c.ClientRef === ref)
  if (!raw) return null
  const now = new Date()
  const wishes = await wishesFor(raw, index, llm)
  let engine: Finding[] = []
  try { engine = run(raw, { ref: index, now, memory: notesFor(ref), wishes, peers: peersOf(clients, index) }) } catch { /* the stopgap still answers */ }
  const { findings } = mergeFindings(engine, provisionalFindings(raw, reference, now))
  return { template: composeBriefing(ref, findings), findings }
}

/** Cards for the main app. Everything is instant; with a model configured, the model-written talk track follows as `fast`. */
export async function appBriefing(url: string, llm: Llm) {
  const u = new URL(url, 'http://local')
  const ref = decodeURIComponent(u.pathname.split('/')[3] ?? '')
  const tier = u.searchParams.get('tier') ?? 'instant'
  const { clients, reference, index } = await data()
  const raw = uploaded.get(ref) ?? clients.find((c) => c.ClientRef === ref)
  if (!raw) return { status: 404, data: { error: 'Kunde nicht gefunden' } }
  if (tier === 'slow') return { status: 200, data: { cards: [], findings: [] } } // news and peers are not built yet

  const now = new Date()
  const wishes = await wishesFor(raw, index, llm)
  let engine: Finding[] = []
  try { engine = run(raw, { ref: index, now, memory: notesFor(ref), wishes, peers: peersOf(clients, index) }) } catch { /* the stopgap still answers */ }
  const { findings } = mergeFindings(engine, provisionalFindings(raw, reference, now))
  const template = composeBriefing(ref, findings)
  const provider = providerFor(llm)

  if (tier === 'instant') {
    const cards = factCards(raw, reference, findings, template, now)
    return { status: 200, data: { cards: provider ? cards : [talkTrackCard(template, findings), ...cards], findings } }
  }
  if (!provider) return { status: 200, data: { cards: [], findings: [] } }
  let written = template
  try { written = await writeBriefing(template, findings, (m) => llm.complete(provider, m), provider) } catch { /* keep the template */ }
  // Which of the optional insight cards (already built, deterministic) actually matter for this
  // client, and in what order: decided by the model, never invented from scratch.
  let ranking: { order: string[]; hidden: string[] } = { order: [], hidden: [] }
  try { ranking = await rankCards(factCards(raw, reference, findings, template, now), (m) => llm.complete(provider, m), provider) } catch { /* keep every card, default order */ }
  return { status: 200, data: { cards: [talkTrackCard(written, findings)], findings: [], order: ranking.order, hidden: ranking.hidden } }
}

/** Refs and names for the client picker. */
export async function briefingClients() {
  const { clients } = await data()
  return clients.map((c) => ({ ref: str(c.ClientRef), name: header(c).name, profile: str(c.RiskProfileName) }))
}

/** Every client (case file plus uploads) with its engine findings, for the news agent and the outbound ranking. No model, no names to anyone. */
export async function clientsWithFindings(now: Date): Promise<{ raw: Record<string, unknown>; ref: string; name: string; index: ReferenceIndex; findings: Finding[] }[]> {
  const { clients, index } = await data()
  const all = [...clients.filter((c) => !uploaded.has(str(c.ClientRef))), ...uploaded.values()]
  const peers = peersOf(clients, index)
  return all.map((raw) => {
    let findings: Finding[] = []
    try { findings = run(raw, { ref: index, now, memory: notesFor(str(raw.ClientRef)), peers }) } catch { /* ranked on news only */ }
    return { raw, ref: str(raw.ClientRef), name: header(raw).name, index, findings }
  })
}
