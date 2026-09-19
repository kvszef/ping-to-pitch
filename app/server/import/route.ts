// HTTP side of the ex-custody import (N3), mounted by server/api.ts.
//
//   POST /api/import/pdf[?ref=CASE-001]   body: the PDF bytes. → { importId, portfolio, report, attached? }
//                                         With ref, the portfolio is attached to that client right away.
//   POST /api/import/attach               body { ref, importId }: attach a parsed statement to a client
//   POST /api/import/detach               body { ref, importId }: remove it again
//   GET  /api/import/:ref                 the client's ex-custody portfolios (summaries)
//
// Storage reuses the client upload (uploadClients): the client is stored as a copy with the extra
// portfolio, so /api/briefing, the chat and the outbound ranking all see it without a special case.
// Logs carry counts only, never names, numbers or lines from the statement.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { rawClientFor, uploadClients, type Llm } from '../ai/briefing-route.ts'
import { assistUnparsed } from './llm-assist.ts'
import { isPdf, pdfPages } from './pdf-text.ts'
import { attachExCustody, buildExCustody, detachExCustody, exCustodyOf, indexIsins, type ExCustodyImport, type IsinIndex } from './portfolio.ts'
import { parseStatement } from './statement.ts'

type Out = { status: number; data: unknown }
type Raw = Record<string, unknown>

let isinIndex: Promise<IsinIndex> | null = null
function isins() {
  isinIndex ??= readFile(resolve(process.cwd(), '../core-case/portfolio-data/reference.json'), 'utf8').then((t) => indexIsins(JSON.parse(t)))
  isinIndex.catch(() => { isinIndex = null })
  return isinIndex
}

// Parsed statements of this server session, so the advisor can look at the report before attaching.
const parsed = new Map<string, ExCustodyImport>()

const providerOf = (llm: Llm) => (llm.ready('openai') ? 'openai' : llm.ready('apertus') ? 'apertus' : null)

export async function parsePdf(bytes: Uint8Array, llm: Llm | null): Promise<ExCustodyImport & { llm?: { used: boolean; added: number; unverified: number; error?: string } }> {
  const statement = parseStatement(await pdfPages(bytes))
  let llmInfo: { used: boolean; added: number; unverified: number; error?: string } | undefined
  const provider = llm ? providerOf(llm) : null
  if (statement.unparsed.length && llm && provider) {
    try {
      const a = await assistUnparsed(statement.unparsed, (m) => llm.complete(provider, m))
      statement.positions.push(...a.positions)
      llmInfo = { used: true, added: a.positions.length, unverified: a.unverified.length }
    } catch (e) {
      llmInfo = { used: false, added: 0, unverified: 0, error: e instanceof Error ? e.message.slice(0, 120) : 'Fehler' }
    }
  }
  const result = buildExCustody(statement, await isins())
  if (llmInfo?.added) result.report.issues.push(`${llmInfo.added} Position(en) von der KI gelesen; jede Zahl steht wörtlich im Auszug.`)
  if (llmInfo?.unverified) result.report.issues.push(`${llmInfo.unverified} von der KI gelesene Position(en) nicht belegt und daher nicht übernommen.`)
  return { ...result, llm: llmInfo }
}

function summary(p: Raw) {
  const ex = (typeof p.ExCustody === 'object' && p.ExCustody !== null ? p.ExCustody : {}) as Raw
  return {
    importId: ex.importId, nr: p.PortfolioNr, name: p.Name, bank: ex.bank, asOf: ex.asOf, mandate: ex.mandate, reconciles: ex.reconciles,
    currency: p.PortfolioCurrency, value: p.AssetsUnderManagementInDefaultCurrency,
    positions: (Array.isArray(p.SecurityPositions) ? p.SecurityPositions.length : 0) + (Array.isArray(p.AccountPositions) ? p.AccountPositions.length : 0),
  }
}

async function attach(ref: string, item: ExCustodyImport): Promise<Out> {
  const { raw } = await rawClientFor(ref)
  if (!raw) return { status: 404, data: { error: 'Kunde nicht gefunden' } }
  const next = attachExCustody(raw, item.portfolio)
  const stored = uploadClients(Buffer.from(JSON.stringify(next)))
  if (stored.status !== 200) return stored
  const clientCurrency = typeof raw.ReportingCurrency === 'string' ? raw.ReportingCurrency : 'CHF'
  const warning = clientCurrency !== item.report.currency ? `Der Auszug ist in ${item.report.currency}, der Kunde rechnet in ${clientCurrency}. Werte sind nicht umgerechnet.` : undefined
  console.info(`[import] attached ${item.report.positions} positions to a client (${item.report.matched} matched)`)
  return { status: 200, data: { ok: true, ref, importId: item.importId, portfolios: exCustodyOf(next).map(summary), warning } }
}

const jsonOf = (body: Buffer): Raw => {
  try { const v: unknown = JSON.parse(body.toString('utf8') || '{}'); return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : {} } catch { return {} }
}

/** Answers /api/import/*; null for any other path. */
export async function importRoute(url: string, method: string, body: Buffer, llm: Llm): Promise<Out | null> {
  const u = new URL(url, 'http://local')
  const path = u.pathname
  if (!path.startsWith('/api/import/')) return null

  if (path === '/api/import/pdf' && method === 'POST') {
    if (!isPdf(body)) return { status: 400, data: { error: 'Keine PDF-Datei' } }
    let result
    try { result = await parsePdf(body, llm) } catch { return { status: 422, data: { error: 'Die PDF-Datei konnte nicht gelesen werden.' } } }
    parsed.set(result.importId, result)
    console.info(`[import] parsed ${result.report.positions} positions, ${result.report.matched} matched, reconciles=${result.report.reconciles}`)
    const ref = u.searchParams.get('ref')
    const attached = ref && result.report.positions ? await attach(ref, result) : undefined
    return { status: 200, data: { importId: result.importId, portfolio: result.portfolio, report: result.report, llm: result.llm, attached: attached?.data } }
  }

  if ((path === '/api/import/attach' || path === '/api/import/detach') && method === 'POST') {
    const p = jsonOf(body)
    const ref = typeof p.ref === 'string' ? p.ref : '', importId = typeof p.importId === 'string' ? p.importId : ''
    if (!ref || !importId) return { status: 400, data: { error: 'ref und importId fehlen' } }
    if (path === '/api/import/attach') {
      const item = parsed.get(importId)
      return item ? attach(ref, item) : { status: 404, data: { error: 'Auszug nicht gefunden, bitte erneut hochladen' } }
    }
    const { raw } = await rawClientFor(ref)
    if (!raw) return { status: 404, data: { error: 'Kunde nicht gefunden' } }
    const next = detachExCustody(raw, importId)
    uploadClients(Buffer.from(JSON.stringify(next)))
    return { status: 200, data: { ok: true, ref, portfolios: exCustodyOf(next).map(summary) } }
  }

  if (method === 'GET') {
    const ref = decodeURIComponent(path.slice('/api/import/'.length))
    const { raw } = await rawClientFor(ref)
    if (!raw) return { status: 404, data: { error: 'Kunde nicht gefunden' } }
    return { status: 200, data: { ref, portfolios: exCustodyOf(raw).map(summary) } }
  }
  return { status: 405, data: { error: 'Methode nicht erlaubt' } }
}
