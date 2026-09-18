// HTTP side of the briefing writer, mounted by server/api.ts.
//   GET  /api/briefing60/:ref?phrase=openai|apertus   a client from core-case clients.json
//   POST /api/briefing60?phrase=…                     body { client }: one raw client from an uploaded file
// Findings come from the engine; checks the engine does not deliver yet fall back to the stopgap.
// The model only ever sees the briefing lines: no names, no account data.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { indexReference, run, type ReferenceIndex } from '../../engine/run.ts'
import { composeBriefing, phraseBriefing, type Briefing60 } from './briefing.ts'
import { factCards, talkTrackCard } from './cards.ts'
import type { Finding } from './findings.ts'
import { provisionalFindings } from './provisional-findings.ts'

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
  let engine: Finding[] = []
  let engineError: string | undefined
  try {
    engine = run(raw, { ref: index, now, memory: [] })
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
        briefing = await phraseBriefing(briefing, (messages) => llm.complete(phrase, messages), phrase)
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

export function uploadClients(body: Buffer) {
  const data: unknown = JSON.parse(body.toString('utf8') || 'null')
  const items = Array.isArray(data) ? data : typeof data === 'object' && data !== null && Array.isArray((data as { clients?: unknown }).clients) ? (data as { clients: unknown[] }).clients : [data]
  const ok = items.filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && typeof (c as { ClientRef?: unknown }).ClientRef === 'string')
  for (const c of ok) uploaded.set(str(c.ClientRef), c)
  return { status: ok.length ? 200 : 400, data: ok.length ? { ok: true, count: ok.length, refs: ok.map((c) => str(c.ClientRef)) } : { error: 'Keine Kunden mit ClientRef in der Datei' } }
}

const providerFor = (llm: Llm): Provider | null => (llm.ready('openai') ? 'openai' : llm.ready('apertus') ? 'apertus' : null)

/** Cards for the main app. Everything is instant; with a model configured, the phrased talk track follows as `fast`. */
export async function appBriefing(url: string, llm: Llm) {
  const u = new URL(url, 'http://local')
  const ref = decodeURIComponent(u.pathname.split('/')[3] ?? '')
  const tier = u.searchParams.get('tier') ?? 'instant'
  const { clients, reference, index } = await data()
  const raw = uploaded.get(ref) ?? clients.find((c) => c.ClientRef === ref)
  if (!raw) return { status: 404, data: { error: 'Kunde nicht gefunden' } }
  if (tier === 'slow') return { status: 200, data: { cards: [], findings: [] } } // news and peers are not built yet

  const now = new Date()
  let engine: Finding[] = []
  try { engine = run(raw, { ref: index, now, memory: [] }) } catch { /* the stopgap still answers */ }
  const { findings } = mergeFindings(engine, provisionalFindings(raw, reference, now))
  const template = composeBriefing(ref, findings)
  const provider = providerFor(llm)

  if (tier === 'instant') {
    const cards = factCards(raw, reference, findings, template, now)
    return { status: 200, data: { cards: provider ? cards : [talkTrackCard(template, findings), ...cards], findings } }
  }
  if (!provider) return { status: 200, data: { cards: [], findings: [] } }
  let phrased = template
  try { phrased = await phraseBriefing(template, (m) => llm.complete(provider, m), provider) } catch { /* keep the template */ }
  return { status: 200, data: { cards: [talkTrackCard(phrased, findings)], findings: [] } }
}

/** Refs and names for the client picker. */
export async function briefingClients() {
  const { clients } = await data()
  return clients.map((c) => ({ ref: str(c.ClientRef), name: header(c).name, profile: str(c.RiskProfileName) }))
}
