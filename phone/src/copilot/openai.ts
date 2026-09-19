import { quelle } from './prompts.ts'
import { TOOL_NAMES, type ToolboxClient, type ToolName } from './types.ts'

// Zweiter Weg zum Modell: eine OpenAI-kompatible Chat-Schnittstelle statt Claude.
// Dieselbe Werkzeugschleife, dasselbe Ergebnis, nur ein anderes Protokoll -- brain.ts
// entscheidet über BRAIN_PROVIDER, welcher Weg genommen wird.
//
// Warum eigenständig statt ins Hirn hineingeflochten: die beiden Protokolle unterscheiden
// sich genau dort, wo es weh tut (Werkzeugform, Ergebnisrückgabe, strukturierte Ausgabe).
// Zwei getrennte Schleifen sind ehrlicher als eine mit Verzweigungen in jeder Zeile.

const env = (k: string, v = ''): string => (process.env[k] ?? '').trim() || v

const CONF = {
  base: () => env('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/+$/, ''),
  key: () => env('OPENAI_API_KEY'),
  model: () => env('OPENAI_MODEL', 'gpt-5.6-luna'),
  /** Muss 'none' bleiben, solange Werkzeuge über /v1/chat/completions laufen (siehe unten). */
  effort: () => env('OPENAI_REASONING_EFFORT', 'none'),
  /** Obergrenze je Werkzeugergebnis, damit ein grosses Ergebnis das Zeitbudget nicht sprengt. */
  ergebnisZeichen: 6000,
}

export const openaiBereit = (): boolean => Boolean(CONF.key())

export type OpenAiAuftrag = {
  zweck: string
  system: string
  /** Stabiler Teil der Nutzernachricht (Briefing); steht vorne, damit der Cache greift. */
  stabil: string
  /** Flüchtiger Teil (Transkript, Auslöser). */
  fluechtig: string
  schema: unknown
  maxTokens: number
  hops: number
  clientRef: string | null
  signal?: AbortSignal
}

type ToolCall = { id: string; type: string; function: { name: string; arguments: string } }
type Nachricht = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

let werkzeugCache: Promise<unknown[]> | null = null

/** Die Toolbox-Werkzeuge in der Form, die eine OpenAI-kompatible Schnittstelle erwartet. */
async function werkzeuge(toolbox: ToolboxClient): Promise<unknown[]> {
  if (!werkzeugCache) {
    werkzeugCache = toolbox.describe().then((liste) =>
      [...liste]
        .sort((a, b) => TOOL_NAMES.indexOf(a.name) - TOOL_NAMES.indexOf(b.name))
        .map((w) => ({
          type: 'function',
          function: { name: w.name, description: w.description, parameters: w.inputSchema },
        })),
    )
  }
  return werkzeugCache
}

async function fuehreAus(
  ruf: ToolCall,
  toolbox: ToolboxClient,
  quellen: Set<string>,
  fallbackRef: string | null,
): Promise<Nachricht> {
  let args: Record<string, unknown> = {}
  try { args = JSON.parse(ruf.function.arguments || '{}') } catch { /* leere Parameter sind erlaubt */ }
  const ref = typeof args.client_ref === 'string' ? args.client_ref : fallbackRef
  try {
    const rows = await toolbox.invoke(ruf.function.name as ToolName, args)
    quellen.add(quelle(ruf.function.name, ref))
    const text = JSON.stringify(rows)
    return {
      role: 'tool',
      tool_call_id: ruf.id,
      content: text.length > CONF.ergebnisZeichen
        ? `${text.slice(0, CONF.ergebnisZeichen)}\n[gekürzt: ${rows.length} Zeilen, nur der Anfang]`
        : text || '[]',
    }
  } catch (e) {
    return {
      role: 'tool',
      tool_call_id: ruf.id,
      content: `Werkzeug ${ruf.function.name} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}. Antworte ohne diese Angabe und sage, dass sie fehlt.`,
    }
  }
}

/**
 * Eine vollständige Anfrage samt Werkzeugschleife.
 *
 * Abbrechbar: kommt während eines laufenden Aufrufs eine neue Kundenaussage, wirft das Signal
 * und der Lauf wird verworfen -- ein veralteter Vorschlag ist schlimmer als gar keiner.
 */
export async function laufeOpenAI(
  a: OpenAiAuftrag,
  toolbox: ToolboxClient,
  log: (zeile: string) => void,
): Promise<{ daten: unknown; quellen: string[] }> {
  const t0 = Date.now()
  const quellen = new Set<string>()
  const tools = await werkzeuge(toolbox)

  const messages: Nachricht[] = [
    { role: 'system', content: a.system },
    { role: 'user', content: `${a.stabil}\n\n${a.fluechtig}` },
  ]

  let text = ''
  let runden = 0
  let gelesen = 0

  for (runden = 1; runden <= a.hops; runden++) {
    if (a.signal?.aborted) throw new Error('Aufruf verworfen')

    const antwort = await fetch(`${CONF.base()}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CONF.key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CONF.model(),
        messages,
        tools,
        max_completion_tokens: a.maxTokens,
        // gpt-5.6-luna lehnt Werkzeuge in /v1/chat/completions ab, solange Reasoning an ist:
        // «Function tools with reasoning_effort are not supported … set reasoning_effort to
        // 'none'.» Für die Live-Schleife ist das ohnehin die richtige Wahl, dort zählt Tempo.
        // Wer mehr Nachdenken will, nimmt /v1/responses -- dafür wäre ein zweiter Weg nötig.
        reasoning_effort: CONF.effort(),
        // Freies JSON statt festem Schema: der Systemprompt schreibt die Form ohnehin vor,
        // und json_object wird breiter unterstützt als json_schema.
        response_format: { type: 'json_object' },
      }),
      signal: a.signal,
    })

    if (!antwort.ok) {
      const grund = (await antwort.text()).slice(0, 400)
      throw new Error(`${CONF.model()} antwortet ${antwort.status}: ${grund}`)
    }

    const daten = await antwort.json() as {
      choices?: { message?: Nachricht; finish_reason?: string }[]
      usage?: { prompt_tokens_details?: { cached_tokens?: number } }
    }
    gelesen += daten.usage?.prompt_tokens_details?.cached_tokens ?? 0

    const nachricht = daten.choices?.[0]?.message
    if (!nachricht) throw new Error('Antwort ohne Nachricht')

    const rufe = nachricht.tool_calls ?? []
    if (rufe.length) {
      messages.push({ role: 'assistant', content: nachricht.content ?? null, tool_calls: rufe })
      // Alle Werkzeuge einer Runde parallel; jedes Ergebnis wird als eigene Nachricht
      // zurückgegeben, so verlangt es das Protokoll.
      const ergebnisse = await Promise.all(rufe.map((r) => fuehreAus(r, toolbox, quellen, a.clientRef)))
      messages.push(...ergebnisse)
      continue
    }

    text = nachricht.content ?? ''
    break
  }

  const gesamt = Date.now() - t0
  log(`${a.zweck}${a.clientRef ? ` ${a.clientRef}` : ''}: ${gesamt} ms, ${runden} Runde(n), ${quellen.size} Werkzeug(e), Cache gelesen ${gelesen} (${CONF.model()})`)
  if (!text.trim()) throw new Error('Leere Antwort des Modells')
  return { daten: parseJsonLocker(text), quellen: [...quellen] }
}

/** Manche Modelle rahmen das JSON mit Text oder Codezaun ein. Beides abstreifen. */
function parseJsonLocker(text: string): unknown {
  const ohneZaun = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  try { return JSON.parse(ohneZaun) } catch { /* zweiter Versuch unten */ }
  const start = ohneZaun.indexOf('{')
  const ende = ohneZaun.lastIndexOf('}')
  if (start < 0 || ende <= start) throw new Error('Antwort enthält kein JSON')
  return JSON.parse(ohneZaun.slice(start, ende + 1))
}
