// REST-Zugriff auf MCP Toolbox, den Dienst vor der Kundendatenbank (phone/data/unrisk.db).
// Ohne Abhängigkeit: das eingebaute fetch reicht.
//
//   POST /api/tool/{name}/invoke   Rumpf ist ein flaches JSON-Objekt mit den Parametern
//     -> 200 { "result": "<JSON als Zeichenkette>" }   also zweimal parsen
//
// Drei Fallen, die diese Datei abfängt, alle gegen Toolbox 1.12 geprüft:
//   1. Werkzeugfehler (fehlender Parameter, SQL-Fehler) kommen mit HTTP 200 und stecken als
//      {"error":"…"} IN der Zeichenkette. Wer nur den Statuscode prüft, hält eine
//      Fehlermeldung für eine Datenzeile.
//   2. Ohne --enable-api antwortet jede /api-Route mit 410 «Gone». `npm run toolbox` setzt
//      den Schalter; von Hand gestartet fehlt er leicht.
//   3. Kein Treffer ergibt die Zeichenkette "null", nicht "[]".
//
// Dieselbe Schnittstelle nutzt der Telefon-Copilot in phone/src/copilot/toolbox.ts. Die
// Datei hier ist bewusst eine eigene, kleinere Fassung: app/ ruft neun parameterlose
// Werkzeuge auf und braucht weder Manifest noch Werkzeugbeschreibungen für ein Sprachmodell.

const DEFAULT_URL = 'http://127.0.0.1:5000'
/** Ganze Lieferungen, nicht eine Zeile: app_reference allein sind mehrere Megabyte. */
const DEFAULT_TIMEOUT_MS = 30_000
/** Die Statusanzeige soll schnell antworten, auch wenn niemand lauscht. */
const HEALTH_TIMEOUT_MS = 1500

export type ToolRow = Record<string, unknown>

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

/** Erst beim Aufruf lesen, damit die Reihenfolge der Modul-Importe egal ist. */
export const toolboxUrl = (): string => (process.env.TOOLBOX_URL || DEFAULT_URL).replace(/\/+$/, '')

/** Ein Werkzeugfehler in HTTP-200-Kleidung: {"error":"…"} und sonst nichts. */
function errorEnvelope(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const o = value as Record<string, unknown>
  if (typeof o.error !== 'string') return null
  return Object.keys(o).every((k) => k === 'error' || k === 'status' || k === 'message') ? o.error : null
}

/** Die zweite Parse-Stufe: aus `result` werden Zeilen. */
export function toRows(result: unknown, tool: string): ToolRow[] {
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

async function request(path: string, body: unknown, timeoutMs: number, tool?: string): Promise<Record<string, unknown>> {
  const url = `${toolboxUrl()}${path}`
  let res: Response
  try {
    res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    const name = (e as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ToolboxError(`Toolbox antwortet nicht innerhalb von ${timeoutMs} ms (${path})`, { tool })
    }
    throw new ToolboxError(`Toolbox nicht erreichbar unter ${toolboxUrl()} (${e instanceof Error ? e.message : String(e)})`, { tool })
  }
  const text = await res.text()
  if (!res.ok) {
    const hint = res.status === 410 ? ' — Toolbox läuft ohne --enable-api, siehe phone/scripts/run-toolbox.ts' : ''
    throw new ToolboxError(`Toolbox ${res.status} auf ${path}${hint}: ${text.slice(0, 200)}`, { status: res.status, tool })
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new ToolboxError(`Toolbox ${path}: Antwort ist kein JSON (${text.slice(0, 120)})`, { status: res.status, tool })
  }
}

/** Ruft ein Werkzeug auf und gibt seine Zeilen zurück. Wirft bei jedem Fehler einen ToolboxError. */
export async function invoke(tool: string, args: Record<string, unknown> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ToolRow[]> {
  const body = await request(`/api/tool/${encodeURIComponent(tool)}/invoke`, args, timeoutMs, tool)
  return toRows(body.result, tool)
}

/** Antwortet die Toolbox? Wirft nie, für die Statusanzeige gedacht. */
export async function toolboxReady(): Promise<boolean> {
  try {
    await request('/api/toolset/app_data', undefined, HEALTH_TIMEOUT_MS)
    return true
  } catch {
    return false
  }
}
