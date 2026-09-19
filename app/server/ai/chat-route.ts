// A4 ask-the-data chat, server side. Mounted by server/api.ts for POST /api/chat and POST /api/chat/data.
//
// OpenAI: function calling. The model picks tools from chat-tools.ts, the server runs them over the raw
// client, the model phrases the results. Providers without function calling (Apertus) or a failed tool
// round: the question is keyword-routed to the same tools first and the results go in as context.
// /api/chat/data needs no model at all: routed tools plus a deterministic sentence (no-key mode).
// Language: body field `language` ('de' | 'en', absent = English). Tool results, the deterministic answer
// and the model's answer come out in it; numbers and names are the same in both.
//
// Tool results carry no names, IBANs, account names or portfolio numbers (chat-tools.ts never reads them).
// They are returned to the browser as `tools`, so the existing number check accepts their figures.

import type { ReferenceIndex } from '../../engine/data.ts'
import { langOf, type Lang } from '../../engine/lang.ts'
import { rawClientFor } from './briefing-route.ts'
import { phrase, routeQuestion, runTool, toolSpecs, unsupportedTopic, type ToolName, type ToolResult } from './chat-tools.ts'

type Message = { role: 'system' | 'user' | 'assistant'; content: string }
type WireMessage = { role: string; content: string | null; tool_calls?: ToolCallWire[]; tool_call_id?: string }
type ToolCallWire = { id: string; type: 'function'; function: { name: string; arguments: string } }
export type Endpoint = { url?: string; key?: string; model?: string }
type Complete = (messages: Message[]) => Promise<unknown>
type ChatAnswer = Record<string, unknown> & { sources?: unknown }

const TOOL_RULES = `
DATENABFRAGEN: Für Fragen zu Beständen (auch über Fonds), Transaktionen, Wertverlauf, Konten oder Liquidität nutze die Werkzeuge bzw. die mitgelieferten DATENABFRAGEN, statt zu schätzen oder selbst zu rechnen. Ihre Ergebnisse gelten wie KUNDENKONTEXT: übernimm Zahlen wörtlich und nenne das Feld "source" jedes verwendeten Ergebnisses in "sources". Meldet ein Ergebnis gehalten=false oder einen "hinweis", sage das ausdrücklich; das ist eine gültige Antwort aus den Daten ("supported": true, Quelle nennen).
Bevor du "supported": false antwortest, prüfe, ob ein Werkzeug die Frage beantworten kann, und rufe es auf. Übernimm Namen von Titeln genau so, wie der Berater sie schreibt («Neste» ist nicht «Nestlé»).
Nicht in den Daten: Gebühren und Kosten, die Wertentwicklung einzelner Positionen, Einzeltitel innerhalb von Fonds, genaue Handelstage (nur das Datum des Anlagevorschlags). Fragt der Berater danach, antworte mit "supported": false und sage, was fehlt.`

// Appended last, so it wins over the German rules before it (same rule as english() in server/api.ts; the chat
// prompt there may already carry it, the tool rules come after it, so it is repeated here with the tool part).
const ENGLISH = `
LANGUAGE (this rule overrides every earlier rule about German): every text YOU write is in English (British spelling): "text", "hint.text", "hint.why" and "next". Keep numbers, amounts, percentages, dates, currency codes, ids and names of securities exactly as they appear in the input (same digits and separators, e.g. CHF 67'000 stays CHF 67'000). "sources" are copied exactly as they are named in the input, never translated. Quotes from client notes stay verbatim in their original language. The keys of tool results are German (gehalten = held, hinweis = note, direkt = direct, viaFonds = through funds); their values are already in English.`

// Sent to the model and to the browser: the result with its source, nothing else.
const wire = (r: ToolResult) => ({ werkzeug: r.name, abfrage: r.args, source: r.source, ...r.result })

function parseJson(text: string) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Antwort des Modells enthält kein JSON')
  return JSON.parse(text.slice(start, end + 1)) as ChatAnswer
}

const onSystem = (messages: Message[], extra: string): Message[] => messages.map((m, i) => (i === 0 && m.role === 'system' ? { ...m, content: m.content + extra } : m))
const withRules = (messages: Message[], lang: Lang): Message[] => onSystem(messages, TOOL_RULES + (lang === 'en' ? ENGLISH : ''))
const inLanguage = (messages: Message[], lang: Lang): Message[] => (lang === 'en' && !messages[0]?.content.includes('LANGUAGE (this rule overrides') ? onSystem(messages, ENGLISH) : messages)

function finish(answer: ChatAnswer, results: ToolResult[]) {
  const own = Array.isArray(answer.sources) ? answer.sources.filter((s): s is string => typeof s === 'string') : []
  const used = answer.supported === false ? [] : results.map((r) => r.source)
  return { ...answer, sources: [...new Set([...own, ...used])], tools: results.map(wire) }
}

// Puts the keyword-routed results in front of the question, so the obvious lookup is there even when
// the model does not call a tool itself (it tends to answer "not in the context" instead).
function withLookups(messages: Message[], results: ToolResult[]): Message[] {
  if (!results.length) return messages
  const last = messages.length - 1
  return messages.map((m, i) => (i === last ? { ...m, content: `DATENABFRAGEN:\n${JSON.stringify(results.map(wire))}\n\n${m.content}` } : m))
}

async function toolLoop(endpoint: Endpoint, messages: Message[], raw: unknown, index: ReferenceIndex, pre: ToolResult[], lang: Lang) {
  const msgs: WireMessage[] = withLookups(withRules(messages, lang), pre)
  const results: ToolResult[] = [...pre]
  for (let round = 0; round < 4; round++) {
    const r = await fetch(`${endpoint.url!.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.key}` },
      body: JSON.stringify({ model: endpoint.model, messages: msgs, temperature: 0.2, tools: toolSpecs(lang), tool_choice: round < 3 ? 'auto' : 'none', response_format: { type: 'json_object' } }),
    })
    if (!r.ok) throw new Error(`openai ${r.status}: ${(await r.text()).slice(0, 300)}`)
    const msg = ((await r.json()) as { choices: { message: WireMessage }[] }).choices[0].message
    if (!msg.tool_calls?.length) return finish(parseJson(msg.content ?? ''), results)
    msgs.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls })
    for (const call of msg.tool_calls) {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(call.function.arguments || '{}') } catch { /* runs with no arguments and says so */ }
      const res = runTool(raw, index, { name: call.function.name as ToolName, args }, lang)
      results.push(res)
      msgs.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(wire(res)) })
    }
  }
  throw new Error('Zu viele Werkzeugaufrufe')
}

async function routed(messages: Message[], results: ToolResult[], complete: Complete, lang: Lang) {
  if (!results.length) return finish((await complete(inLanguage(messages, lang))) as ChatAnswer, [])
  return finish((await complete(withLookups(withRules(messages, lang), results))) as ChatAnswer, results)
}

const refOf = (p: unknown) => {
  const k = (p as { context?: { kunde?: { kennung?: unknown } } })?.context?.kunde?.kennung
  return typeof k === 'string' ? k : ''
}

/** /api/chat: the model answers, with tools over the client's data when the client is in the data. */
export async function chatWithData(p: { question?: unknown; language?: unknown }, provider: 'openai' | 'apertus', endpoint: Endpoint, messages: Message[], complete: Complete) {
  const question = typeof p.question === 'string' ? p.question : ''
  const lang = langOf(p.language)
  const { raw, index } = await rawClientFor(refOf(p))
  if (!raw) return complete(inLanguage(messages, lang)) // sample clients (mock data): context-only, as before
  const missing = unsupportedTopic(question, lang)
  if (missing) return { supported: false, text: missing, sources: [], module: null, hint: null, next: null, tools: [] }
  const pre = routeQuestion(question, raw, index).map((c) => runTool(raw, index, c, lang))
  if (provider === 'openai' && endpoint.url && endpoint.key && endpoint.model) {
    try { return await toolLoop(endpoint, messages, raw, index, pre, lang) } catch (e) {
      console.warn(`[chat] function calling failed, keyword routing instead: ${e instanceof Error ? e.message.slice(0, 120) : e}`)
    }
  }
  return routed(messages, pre, complete, lang)
}

/** /api/chat/data: no model. Routed tools and a deterministic answer in the body's `language`, or supported=false. */
export async function askData(body: unknown) {
  const b = (typeof body === 'object' && body !== null ? body : {}) as { ref?: unknown; question?: unknown; language?: unknown }
  const question = typeof b.question === 'string' ? b.question : ''
  const lang = langOf(b.language)
  const { raw, index } = await rawClientFor(typeof b.ref === 'string' ? b.ref : '')
  if (!raw) return { supported: false, text: '', sources: [], tools: [] }
  const missing = unsupportedTopic(question, lang)
  if (missing) return { supported: true, text: missing, sources: [], tools: [] }
  const results = routeQuestion(question, raw, index).map((c) => runTool(raw, index, c, lang))
  if (!results.length) return { supported: false, text: '', sources: [], tools: [] }
  return { supported: true, text: phrase(results, lang), sources: [...new Set(results.map((r) => r.source))], tools: results.map(wire) }
}
