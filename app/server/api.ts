import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { appBriefing, briefing60, briefingClients, uploadClients } from './ai/briefing-route.ts'

// Kleine API im Vite-Server. Die Schlüssel bleiben hier und erreichen den Browser nie.
// Apertus wird über eine OpenAI-kompatible Schnittstelle angesprochen (Basis-URL in .env.local).

type Env = Record<string, string | undefined>
type Provider = 'openai' | 'apertus'
type Message = { role: 'system' | 'user' | 'assistant'; content: string }

const body = (req: IncomingMessage) => new Promise<Buffer>((resolve, reject) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject)
})

const send = (res: ServerResponse, status: number, data: unknown) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function providerConfig(env: Env, provider: Provider, fast: boolean) {
  if (provider === 'apertus') return { url: env.APERTUS_BASE_URL, key: env.APERTUS_API_KEY, model: env.APERTUS_MODEL, json: false }
  return { url: env.OPENAI_BASE_URL || 'https://api.openai.com/v1', key: env.OPENAI_API_KEY, model: (fast ? env.OPENAI_MODEL_FAST : env.OPENAI_MODEL) || 'gpt-4o-mini', json: true }
}

const ready = (env: Env, p: Provider) => { const c = providerConfig(env, p, true); return !!(c.url && c.key && c.model) }

// Modelle ohne erzwungenes JSON-Format umrahmen die Antwort gelegentlich mit Text.
function parseJson(text: string) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Antwort des Modells enthält kein JSON')
  return JSON.parse(text.slice(start, end + 1))
}

async function complete(env: Env, provider: Provider, fast: boolean, messages: Message[]) {
  const c = providerConfig(env, provider, fast)
  if (!c.url || !c.key || !c.model) throw new Error(`Anbieter «${provider}» ist nicht konfiguriert`)
  const r = await fetch(`${c.url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
    body: JSON.stringify({ model: c.model, messages, temperature: 0.2, ...(c.json ? { response_format: { type: 'json_object' } } : {}) }),
  })
  if (!r.ok) throw new Error(`${provider} ${r.status}: ${(await r.text()).slice(0, 300)}`)
  const data = await r.json() as { choices: { message: { content: string } }[] }
  return parseJson(data.choices[0].message.content)
}

const RULES = `Du unterstützt einen Kundenberater einer Schweizer Bank. Antworte ausschliesslich auf Deutsch in Schweizer Schreibweise (ss statt ß).
Verwende NUR die Fakten aus dem Abschnitt KUNDENKONTEXT. Erfinde keine Zahlen, Titel, Kurse oder Nachrichten. Wenn die Fakten eine Aussage nicht stützen, sage das ausdrücklich.
Trenne Fakten von Einschätzungen. Gib keine Anlageempfehlung ab, die das Mandat verletzt.
Sei KONKRET: Jeder Satz nennt mindestens eine Zahl, eine Position, eine Bandbreite oder ein Datum aus dem Kontext. Nenne Positionen beim Namen und Abweichungen in Prozentpunkten.
Verboten sind Floskeln ohne Inhalt, etwa «es ist wichtig», «wir sollten besprechen», «ich verstehe Ihre Sorge», «gerne schauen wir uns das an», «langfristig denken».
Schlecht: «Ihr Portfolio ist etwas unter Druck, wir sollten die Strategie anschauen.» Gut: «Von den 4.2% Verlust stammen 3.1 Punkte aus drei US-Technologietiteln; mit einem Verkauf von CHF 67'000 liegt der USD-Anteil wieder im Band.» (Die Zahlen im Beispiel NICHT übernehmen.)
Sätze, die der Berater zum Kunden sagt: höchstens 25 Wörter, Sie-Form, eine Kernzahl, und wenn der Kontext einen Vorschlag oder eine Massnahme enthält, genau diese nennen. Enthält der Kontext KEINEN Betrag für eine Massnahme, nenne keinen: jede Zahl in deiner Antwort muss wörtlich im Kontext stehen, du rechnest nicht selbst. Ordne jede Zahl dem richtigen Gegenstand zu.
Nächste Schritte beginnen mit einem Verb und nennen Gegenstand und Grösse («Verkauf von … über CHF … vorschlagen»).
Antworte als ein einziges JSON-Objekt ohne weiteren Text.`

const DETAIL: Record<string, string> = {
  kurz: 'ein bis zwei Sätze, nur Kernzahlen',
  standard: 'drei bis vier Sätze: Kernaussage mit Begründung',
  detailliert: 'sechs bis acht Sätze: vollständige Herleitung mit allen relevanten Zahlen und Bandbreiten',
}

function chatPrompt(p: { context: unknown; modules: unknown; question: string; history: unknown; detail: string }): Message[] {
  return [
    { role: 'system', content: `${RULES}
Schema: {"supported": boolean, "text": string, "sources": string[], "module": {"id": string, "confidence": number} | null, "hint": {"text": string, "why": string} | null, "next": string | null}
- "text": Einblick FÜR DEN BERATER, Umfang: ${DETAIL[p.detail] ?? DETAIL.standard}.
- "sources": die verwendeten Quellen so, wie sie im Kontext heissen (Feld "source"/"quelle" oder Kartentitel), nie das Wort «Kontext».
- "module": höchstens eine Grafik aus VERFÜGBARE GRAFIKEN, mit Konfidenz 0–100, wie gut sie die Frage beantwortet; sonst null.
- "hint": ein Satz, den der Berater wörtlich ZUM KUNDEN sagen kann: nennt die Ursache mit ihrer Zahl UND, falls im Kontext vorhanden, die konkrete Massnahme mit Betrag und Wirkung. Nicht die Schlagzeile wiederholen. "why" = die Zahlen dahinter; sonst null.
- "next": der sinnvollste nächste Schritt für den Berater; sonst null.
- "supported": false, wenn der Kontext die Frage nicht beantwortet. Dann erklärt "text" kurz, was fehlt, und alle übrigen Felder sind null bzw. leer.` },
    { role: 'user', content: `KUNDENKONTEXT:\n${JSON.stringify(p.context)}\n\nVERFÜGBARE GRAFIKEN:\n${JSON.stringify(p.modules)}\n\nBISHERIGER CHAT:\n${JSON.stringify(p.history)}\n\nFRAGE DES BERATERS:\n${p.question}` },
  ]
}

function analysePrompt(p: { context: unknown; modules: unknown; transcript: unknown; segments: unknown; detail: string }): Message[] {
  return [
    { role: 'system', content: `${RULES}
Du hörst ein Telefongespräch zwischen Berater und Kunde mit. NEUE ABSCHNITTE stammen aus einer automatischen Transkription mit Sprecher-Kennungen, die nur innerhalb dieser Lieferung gelten.
Schema: {"segments": [{"speaker": "Kunde" | "Berater", "text": string}], "customer": {"heard": string, "text": string, "why": string, "topic": string} | null, "advisor": {"heard": string, "text": string, "topic": string} | null, "insight": {"text": string, "sources": string[], "module": {"id": string, "confidence": number} | null} | null}
- "segments": die neuen Abschnitte in Reihenfolge, jeder der Rolle zugeordnet. Der Berater erklärt, ordnet ein und schlägt vor; der Kunde fragt und schildert Anliegen. Transkriptionsfehler behutsam korrigieren, nichts hinzufügen.
- "customer": nur wenn der KUNDE in den neuen Abschnitten ein Anliegen geäussert hat, das der Kontext abdeckt. "heard" = seine Aussage, "text" = ein Satz, den der Berater wörtlich antworten kann (Sie-Form): Ursache mit Zahl und, falls im Kontext vorhanden, die konkrete Massnahme mit Betrag, "why" = Begründung mit Zahlen, "topic" = Stichwort.
- "advisor": nur wenn der BERATER in den neuen Abschnitten ein Thema angesprochen hat. "heard" = seine Aussage, "text" = der vorausschauend nächste Schritt für ihn, "topic" = Stichwort.
- "insight": Einblick für den Berater zum Anliegen des Kunden, Umfang: ${DETAIL[p.detail] ?? DETAIL.standard}; Grafik wie beschrieben höchstens eine aus VERFÜGBARE GRAFIKEN mit Konfidenz 0–100.
Bei Begrüssungen und Belanglosem sind "customer", "advisor" und "insight" null.` },
    { role: 'user', content: `KUNDENKONTEXT:\n${JSON.stringify(p.context)}\n\nVERFÜGBARE GRAFIKEN:\n${JSON.stringify(p.modules)}\n\nBISHERIGES GESPRÄCH:\n${JSON.stringify(p.transcript)}\n\nNEUE ABSCHNITTE:\n${JSON.stringify(p.segments)}` },
  ]
}

// Stopgap until the engine serves /api/clients: the case file as it is, minus every account field
// that can hold an IBAN or an account name. Same path and shape, so the engine replaces it silently.
const CLIENT_FILE = resolve(process.cwd(), '../core-case/portfolio-data/clients.json')
async function caseClients(): Promise<unknown[]> {
  const data: unknown = JSON.parse(await readFile(CLIENT_FILE, 'utf8'))
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip)
    if (typeof v !== 'object' || v === null) return v
    return Object.fromEntries(Object.entries(v).filter(([k]) => !/^(iban|accountname|accountnumber)$/i.test(k)).map(([k, x]) => [k, strip(x)]))
  }
  return Array.isArray(data) ? data.map(strip) : []
}

type Word = { text: string; type?: string; speaker_id?: string }

async function transcribe(env: Env, audio: Buffer, contentType: string) {
  if (!env.ELEVENLABS_API_KEY) throw new Error('ElevenLabs ist nicht konfiguriert')
  const form = new FormData()
  form.append('model_id', env.ELEVENLABS_STT_MODEL || 'scribe_v1')
  form.append('language_code', 'deu')
  form.append('diarize', 'true')
  form.append('file', new Blob([new Uint8Array(audio)], { type: contentType }), 'abschnitt.webm')
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY }, body: form })
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 300)}`)
  const data = await r.json() as { text: string; words?: Word[] }
  const segments: { speaker: string; text: string }[] = []
  for (const w of data.words ?? []) {
    const speaker = w.speaker_id ?? 'speaker_0'
    const last = segments[segments.length - 1]
    if (last && last.speaker === speaker) last.text += w.text
    else segments.push({ speaker, text: w.text })
  }
  const cleaned = segments.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text)
  return cleaned.length ? cleaned : data.text.trim() ? [{ speaker: 'speaker_0', text: data.text.trim() }] : []
}

export function api(env: Env): Plugin {
  return {
    name: 'berater-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          if (req.url === '/api/status') return send(res, 200, { openai: ready(env, 'openai'), apertus: ready(env, 'apertus'), elevenlabs: !!env.ELEVENLABS_API_KEY })
          if (req.url === '/api/clients' && req.method === 'GET') return send(res, 200, await caseClients())
          const llm = { complete: (p: Provider, m: Message[]) => complete(env, p, true, m), ready: (p: Provider) => ready(env, p) }
          if (req.url.startsWith('/api/briefing60')) {
            if (req.url.startsWith('/api/briefing60/clients')) return send(res, 200, await briefingClients())
            const out = await briefing60(req.method ?? 'GET', req.url, req.method === 'POST' ? await body(req) : null, llm)
            return send(res, out.status, out.data)
          }
          if (req.url.startsWith('/api/briefing/') && req.method === 'GET') { const out = await appBriefing(req.url, llm); return send(res, out.status, out.data) }
          if (req.url === '/api/clients/upload' && req.method === 'POST') { const out = uploadClients(await body(req)); return send(res, out.status, out.data) }
          if (req.method !== 'POST') return send(res, 405, { error: 'Nur POST' })
          const raw = await body(req)
          if (req.url === '/api/transcribe') return send(res, 200, { segments: await transcribe(env, raw, req.headers['content-type'] || 'audio/webm') })
          const p = JSON.parse(raw.toString('utf8'))
          const provider: Provider = p.provider === 'apertus' ? 'apertus' : 'openai'
          if (req.url === '/api/chat') return send(res, 200, await complete(env, provider, false, chatPrompt(p)))
          if (req.url === '/api/analyse') return send(res, 200, await complete(env, provider, true, analysePrompt(p)))
          send(res, 404, { error: 'Unbekannter Pfad' })
        } catch (e) {
          send(res, 502, { error: e instanceof Error ? e.message : String(e) })
        }
      })
    },
  }
}
