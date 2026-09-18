// Zugriff auf MCP Toolbox über deren REST-Schnittstelle. Ohne Abhängigkeit: das eingebaute
// fetch reicht, und der Dienst startet auch dann, wenn Toolbox gerade nicht läuft.
//
// Die Antwortformen sind gegen laufende Toolbox-Fassungen geprüft (1.1.0 und 1.12.0), nicht
// aus der Doku abgeschrieben – die Doku zur /api-Schnittstelle gibt es nicht mehr:
//
//   GET  /api/toolset             alle Werkzeuge
//   GET  /api/toolset/{toolset}   die Werkzeuge eines Toolsets
//   GET  /api/tool/{name}         ein einzelnes Werkzeug
//     -> 200 { "serverVersion": "1.12.0+…",
//              "tools": { "<name>": { "description": "…",
//                                     "parameters": [ { "name": "phone_e164", "type": "string",
//                                                       "required": true, "description": "…",
//                                                       "authServices": [],
//                                                       "items": {…}, "default": … } ],
//                                     "authRequired": [] } } }
//        `tools` ist ein Objekt mit dem Werkzeugnamen als Schlüssel, `parameters` eine Liste,
//        und jeder Parameter trägt sein eigenes `required`. Kein Schema-Objekt, kein `required`-Array.
//
//   POST /api/tool/{name}/invoke  Rumpf ist ein flaches JSON-Objekt mit den Parametern
//     -> 200 { "result": "<JSON als Zeichenkette>" }   also zweimal parsen
//        Kein Treffer ergibt die Zeichenkette "null", nicht "[]".
//
// Drei Fallen, die diese Datei abfängt:
//   1. Werkzeugfehler (fehlender Parameter, Typfehler, SQL-Fehler) kommen mit HTTP 200 und
//      stecken als {"error":"…"} IN der Zeichenkette. Wer nur den Statuscode prüft, hält
//      eine Fehlermeldung für eine Datenzeile.
//   2. Seit Toolbox 1.0 sind die /api-Routen abgeschaltet, solange der Server nicht mit
//      --enable-api läuft. Dann antwortet jede Route mit HTTP 410 «Gone».
//   3. Ein Parameter mit `default` meldet immer `required: false`, auch wenn tools.yaml
//      `required: true` sagt. Genau so gehört er auch ins JSON-Schema.
//   Routen- und Namensfehler kommen normal: HTTP 400/404/410 mit { "status", "error" }; bei
//   405 und 415 bleibt der Rumpf leer. `GET /healthz` und `GET /` antworten immer, auch ohne
//   --enable-api – health() prüft trotzdem /api/toolset, denn ohne /api nützt uns der Dienst nichts.

import { TOOL_NAMES } from './types.ts'
import type { ToolboxClient, ToolDescription, ToolName, ToolRow } from './types.ts'

const DEFAULT_URL = 'http://127.0.0.1:5000'
const DEFAULT_TOOLSET = 'call_copilot'
/** Ein hängender Aufruf darf das Gespräch nicht blockieren. */
const DEFAULT_TIMEOUT_MS = 4000
/** Die Statusanzeige soll schnell antworten, auch wenn niemand lauscht. */
const HEALTH_TIMEOUT_MS = 1500

export type ToolboxOptions = {
  /** Vorrang vor TOOLBOX_URL. */
  baseUrl?: string
  /** Vorrang vor TOOLBOX_TOOLSET. */
  toolset?: string
  timeoutMs?: number
}

/** Trägt den HTTP-Status mit, damit der Aufrufer «nicht erreichbar» von «Werkzeug meckert» trennen kann. */
export class ToolboxError extends Error {
  readonly status?: number
  readonly tool?: string
  constructor(message: string, info: { status?: number; tool?: string } = {}) {
    super(message)
    this.name = 'ToolboxError'
    this.status = info.status
    this.tool = info.tool
  }
}

// --------------------------------------------------------------------------- Manifest

type ParameterManifest = {
  name: string
  type: string
  description?: string
  required?: boolean
  default?: unknown
  items?: ParameterManifest
  additionalProperties?: unknown
}

type ToolManifest = { description?: string; parameters?: ParameterManifest[] }
type ToolsetManifest = { serverVersion?: string; tools?: Record<string, ToolManifest> }

/**
 * Toolbox-Typen auf JSON-Schema-Typen. Toolbox 1.1 schreibt für `map` bereits `object` und
 * legt `additionalProperties` bei; `map` bleibt trotzdem stehen, falls eine ältere Fassung läuft.
 */
const JSON_TYPE: Record<string, string> = {
  string: 'string',
  integer: 'integer',
  float: 'number',
  number: 'number',
  boolean: 'boolean',
  array: 'array',
  map: 'object',
  object: 'object',
}

function schemaFor(param: ParameterManifest): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: JSON_TYPE[param.type] ?? 'string' }
  if (param.description) schema.description = param.description
  // Ein Array ohne `items` lehnt Claude ab, deshalb notfalls `string` als Element.
  if (schema.type === 'array') schema.items = param.items ? schemaFor(param.items) : { type: 'string' }
  // Bei `map` legt Toolbox den Werttyp selbst als `additionalProperties` bei – einfach durchreichen.
  if (schema.type === 'object' && param.additionalProperties !== undefined) {
    schema.additionalProperties = param.additionalProperties
  }
  if (param.default !== undefined) schema.default = param.default
  return schema
}

function toDescription(name: string, tool: ToolManifest): ToolDescription {
  const params = tool.parameters ?? []
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const p of params) {
    if (!p?.name) continue
    properties[p.name] = schemaFor(p)
    // Toolbox setzt `required` je Parameter; fehlt es, gilt der Parameter als Pflicht.
    if (p.required !== false) required.push(p.name)
  }
  return {
    name: name as ToolName,
    description: tool.description ?? '',
    inputSchema: required.length
      ? { type: 'object', properties, required }
      : { type: 'object', properties },
  }
}

/** Erst die Werkzeuge aus dem Vertrag in ihrer Reihenfolge, dann alles Übrige. */
function sortByContract(tools: ToolDescription[]): ToolDescription[] {
  const rank = (n: string) => {
    const i = (TOOL_NAMES as readonly string[]).indexOf(n)
    return i === -1 ? TOOL_NAMES.length : i
  }
  return [...tools].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
}

// --------------------------------------------------------------------------- Ergebnis

/** Ein Werkzeugfehler in HTTP-200-Kleidung: {"error":"…"} und sonst nichts. */
function errorEnvelope(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const o = value as Record<string, unknown>
  if (typeof o.error !== 'string') return null
  return Object.keys(o).every((k) => k === 'error' || k === 'status' || k === 'message') ? o.error : null
}

/** Die zweite Parse-Stufe: aus `result` werden Zeilen. */
function toRows(result: unknown, tool: string): ToolRow[] {
  let value = result
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return []
    try {
      value = JSON.parse(text)
    } catch {
      throw new ToolboxError(`Werkzeug ${tool}: Antwort ist kein JSON (${text.slice(0, 120)})`, { tool })
    }
  }
  if (value === null || value === undefined) return []
  const failed = errorEnvelope(value)
  if (failed) throw new ToolboxError(`Werkzeug ${tool}: ${failed}`, { tool })
  if (Array.isArray(value)) return value.filter((r) => r && typeof r === 'object') as ToolRow[]
  if (typeof value === 'object') return [value as ToolRow]
  return []
}

// --------------------------------------------------------------------------- Client

export function createToolboxClient(options: ToolboxOptions = {}): ToolboxClient {
  // Erst beim Aufruf lesen, damit die Reihenfolge der Modul-Importe egal ist.
  const base = () => (options.baseUrl || process.env.TOOLBOX_URL || DEFAULT_URL).replace(/\/+$/, '')
  const toolset = () => options.toolset || process.env.TOOLBOX_TOOLSET || DEFAULT_TOOLSET
  const timeout = () => options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs = timeout(),
    tool?: string,
  ): Promise<Record<string, unknown>> {
    const url = `${base()}${path}`
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      const name = (e as { name?: string })?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ToolboxError(`Toolbox antwortet nicht innerhalb von ${timeoutMs} ms (${method} ${path})`, { tool })
      }
      const reason = e instanceof Error ? e.message : String(e)
      throw new ToolboxError(`Toolbox nicht erreichbar unter ${base()} (${reason})`, { tool })
    }

    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* unten als Klartext melden */
    }

    if (!res.ok) {
      // { status, error }; bei 405 und 415 schickt Toolbox gar keinen Rumpf.
      const detail = (data as { error?: string })?.error || text.slice(0, 200) || res.statusText || 'ohne Begründung'
      const hint = res.status === 410 ? ' – Toolbox läuft ohne --enable-api' : ''
      throw new ToolboxError(`Toolbox ${res.status}: ${detail}${hint}`, { status: res.status, tool })
    }
    if (!data || typeof data !== 'object') {
      throw new ToolboxError(`Toolbox ${method} ${path}: unerwartete Antwort (${text.slice(0, 120)})`, { tool })
    }
    return data as Record<string, unknown>
  }

  let cached: Promise<ToolDescription[]> | null = null

  async function load(): Promise<ToolDescription[]> {
    const data = (await request('GET', `/api/toolset/${encodeURIComponent(toolset())}`)) as ToolsetManifest
    const tools = data.tools ?? {}
    return sortByContract(Object.entries(tools).map(([name, tool]) => toDescription(name, tool)))
  }

  return {
    async invoke(name: ToolName, args: Record<string, unknown>): Promise<ToolRow[]> {
      const data = await request('POST', `/api/tool/${encodeURIComponent(name)}/invoke`, args ?? {}, timeout(), name)
      return toRows(data.result, name)
    },

    /** Wirft nie: die Statusanzeige will ein Ja oder Nein, keinen Fehler. */
    async health(): Promise<boolean> {
      try {
        await request('GET', `/api/toolset/${encodeURIComponent(toolset())}`, undefined, HEALTH_TIMEOUT_MS)
        return true
      } catch {
        return false
      }
    },

    /** Einmal holen, dann aus dem Speicher – vor jedem Modellaufruf zu fragen wäre Verschwendung. */
    describe(): Promise<ToolDescription[]> {
      if (!cached) {
        cached = load().catch((e) => {
          cached = null // ein Fehlschlag darf sich nicht festsetzen
          throw e
        })
      }
      return cached
    },
  }
}

/** Gemeinsame Instanz für alle Bausteine. Liest die Umgebung erst beim Aufruf. */
export const toolbox: ToolboxClient = createToolboxClient()

// --------------------------------------------------------------------------- Quellen

const shorten = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s)

/**
 * Kurzer Quellenschlüssel für das Feld `sources`, z. B. `get_saa_gap(CASE-004)`.
 * Alle Bausteine benutzen ihn, damit Quellenangaben gleich aussehen.
 */
export function sourceKey(name: string, args: Record<string, unknown> = {}): string {
  const values = Object.values(args ?? {})
    .filter((v) => v !== undefined && v !== null && v !== '')
    .map((v) => shorten(typeof v === 'object' ? JSON.stringify(v) : String(v)))
  return `${name}(${values.join(', ')})`
}
