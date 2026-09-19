import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { appBriefing, briefing60, briefingClients, uploadClients } from './ai/briefing-route.ts'
import { briefingNews, clientNews, newsFeed, newsStatus, outbound, pushNews, snapshotNews, startNewsWatcher } from './market/route.ts'
import { callRoute } from './call.ts'
import { newsAgentRoute } from './ai/news-agent.ts'
import { houseView } from './houseview.ts'
import { callsRoute } from './calls.ts'
import { callPlanRoute } from './ai/callplan-route.ts'
import { importRoute } from './import/route.ts'
import { askData, chatWithData } from './ai/chat-route.ts'
import { dataStatus, loadData } from './database.ts'

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

async function complete(env: Env, provider: Provider, fast: boolean, messages: Message[], model?: string) {
  const c = { ...providerConfig(env, provider, fast), ...(model && provider === 'openai' ? { model } : {}) }
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

const LANGUAGE: Record<string, string> = {
  de: 'Antworte auf Deutsch in Schweizer Schreibweise (ss statt ß).',
  en: 'Antworte auf Englisch (British spelling).',
}

// Condenses the engine's profile tile (persona sentence, call reasons, raw notes) into a couple of
// fluent sentences for the advisor. Summarising only: no fact may appear that isn't in the input.
function summaryPrompt(p: { persona?: string; reasons: string[]; notes: { text: string; date: string }[]; language: string }): Message[] {
  return [
    { role: 'system', content: `Du fasst die Profil-Kachel eines Kundenberaters kurz zusammen, damit er auf einen Blick weiss, wer der Kunde ist und warum er sich meldet.
${LANGUAGE[p.language] ?? LANGUAGE.de}
Verwende NUR die gegebenen Fakten aus EINSCHÄTZUNG, ANLASS und NOTIZEN. Erfinde keine Zahlen, Ereignisse oder Eigenschaften; füge nichts hinzu, das dort nicht steht. Straffe nur die Sprache.
Höchstens zwei kurze Sätze, keine Aufzählung, keine Floskeln wie «es ist wichtig» oder «wir sollten».
Antworte als ein einziges JSON-Objekt ohne weiteren Text: {"text": string}` },
    { role: 'user', content: `EINSCHÄTZUNG:\n${p.persona ?? '–'}\n\nANLASS:\n${p.reasons.join(' · ') || '–'}\n\nNOTIZEN:\n${p.notes.map((n) => `${n.date}: ${n.text}`).join('\n') || '–'}` },
  ]
}

// Translates already-generated, already-grounded German UI text for display. Translation only: the
// engine and the model keep computing and phrasing in German (unchanged, still tested); this is a
// display-time pass, so no number, name or date may move or change, only the language.
function translatePrompt(p: { texts: string[]; language: string }): Message[] {
  return [
    { role: 'system', content: `Du übersetzt kurze Textstücke aus der Oberfläche eines Kundenberater-Werkzeugs ins ${p.language === 'en' ? 'Englische (British spelling)' : 'Deutsche'}.
Übersetze NUR. Ändere keine Zahl, keinen Namen, kein Datum, keine Prozentangabe und keine Grössenordnung; übernimm sie unverändert. Erfinde nichts hinzu, lass nichts weg.
Der Ton bleibt sachlich und knapp, wie im Original.
"texts" ist ein Array; gib ein Array exakt derselben Länge und Reihenfolge zurück, ein übersetzter Eintrag pro Eingabe (leerer String bleibt leer).
Antworte als ein einziges JSON-Objekt ohne weiteren Text: {"texts": string[]}` },
    { role: 'user', content: JSON.stringify({ texts: p.texts }) },
  ]
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

// A demo conversation for an outbound call, written on the spot from the client's data and today's
// reasons to call (the ranking changes with the news, so no fixed script can fit). Figures only from
// the context; the client's side is realistic but invented and marked as a demo in the UI.
function demoScriptPrompt(p: { context: unknown; reasons: unknown }): Message[] {
  return [
    { role: 'system', content: `${RULES}
Schreibe ein realistisches, kurzes Telefongespräch (8 bis 10 Beiträge, abwechselnd) zwischen einem Kundenberater einer Schweizer Bank und seinem Kunden. Der Berater ruft an. Sein ERSTER Beitrag begrüsst in einem Satz und nennt dann ausdrücklich GRUND 1 aus GRÜNDE (die Nachricht oder den Befund mit der Position und ihrem Anteil) als Anlass des Anrufs. Übernimm keine vorformulierten Einstiegssätze aus dem Kontext. Der Kunde reagiert natürlich, stellt Rückfragen, zum Schluss wird ein konkreter nächster Schritt vereinbart.
- Hochdeutsch in Schweizer Schreibweise, Sie-Form, kurze gesprochene Sätze (höchstens 30 Wörter pro Beitrag).
- Jede Zahl muss wörtlich in KUNDENKONTEXT oder GRÜNDE stehen. Keine Namen von Personen.
Schema: {"script": [{"speaker": "Berater" | "Kunde", "text": string}]}` },
    { role: 'user', content: `KUNDENKONTEXT:
${JSON.stringify(p.context)}

GRÜNDE:
${JSON.stringify(p.reasons)}` },
  ]
}

// The live agent writes in the display language directly: a display-time translation (/api/translate)
// would add seconds to an answer the advisor needs mid-sentence. Appended as the last rule, so it wins
// over the German-only rule in RULES. Ids, numbers and quoted data stay untouched (the grounding check
// in src/workspace/brain.ts compares numbers literally).
const AGENT_ENGLISH = `- LANGUAGE (this rule overrides every earlier rule about German): every text YOU write is in English (British spelling): "answer.text", every "label" and "text" in "suggestions", and every tile "text". Keep ids, numbers, amounts, percentages, dates, currency codes and names of positions exactly as they appear in the input (same digits and separators, e.g. CHF 67'000 stays CHF 67'000). Quoted input stays verbatim in its original language: "answer.heard", "segments" and "covered" are copied, never translated.`

// The screen agent: picks from the catalogue of UI elements what the advisor sees right now.
// Called when a client opens and on every new piece of transcript. Elements carry their own
// numbers; the agent only chooses, orders and shortens, and writes three talking points.
function agentPrompt(p: { context: unknown; catalogue: unknown; tiles: unknown; charts: unknown; transcript: unknown[]; segments?: unknown[]; said: unknown[]; event: string; language?: string }): Message[] {
  const live = Array.isArray(p.segments) && p.segments.length > 0
  // An internet call knows who speaks, so the model need not return the segments with roles (less output, faster).
  const roles = live && !(p.segments as { speaker?: string }[]).every((x) => x?.speaker === 'Kunde' || x?.speaker === 'Berater')
  return [
    { role: 'system', content: `${RULES}
Du steuerst den Bildschirm eines Kundenberaters${live ? ' während eines laufenden Telefongesprächs' : ' vor dem Gespräch'}. Du wählst aus dem KATALOG, was er jetzt sieht, damit er in 60 Sekunden das Wichtigste weiss und im Gespräch immer das Passende vor Augen hat.
KATALOG: ${JSON.stringify(p.catalogue)}
Schema: {"tiles": [{"id": string, "text"?: string}], "focus": string | null, "widgets": [string], "suggestions": [{"label": string, "text": string, "tile": string}], "answer": {"heard": string, "text": string} | null${roles ? ', "segments": [{"speaker": "Kunde" | "Berater", "text": string}]' : ''}${live ? ', "covered": [string]' : ''}}
- Verwende nur ids aus KACHELN und GRAFIKEN. "focus" ist eine id, kein Text.
- ${live ? 'Richte "focus", "widgets" und "suggestions" nach dem, was zuletzt gesagt wurde. Greife das Anliegen des Kunden auf; wiederhole nichts aus GESAGT.' : 'Vor dem Gespräch: "focus" ist die wichtigste Kachel, "suggestions" sind die drei besten Einstiege.'}
${live ? `- Das Gespräch kann auf Englisch oder Deutsch geführt werden; verstehe es sinngemäss, deine Texte bleiben Deutsch.
- Äussert der KUNDE in den NEUEN ABSCHNITTEN eine Frage, einen Wunsch oder einen Auftrag (auch allgemein wie «Wie läuft mein Portfolio?» oder «Reduzieren Sie meine Positionen»), dann gilt zwingend: "focus" = die am besten passende Kachel, "widgets" = genau EIN Eintrag, der am besten zur Aussage passt ("chart:<id>" aus GRAFIKEN, wenn eine Grafik passt, sonst "tile:<id>" aus KACHELN; nie leer, nie mehrere), "answer" = {"heard": die Aussage des Kunden, "text": Stichpunkt für die Antwort des Beraters mit den passenden Zahlen aus dem Kontext, höchstens 20 Wörter}. Allgemeine Fragen zum Stand des Portfolios beantwortet die Wertentwicklung. Nur bei Begrüssung und Belanglosem bleiben "focus" und "widgets" unverändert und "answer" null.
${roles ? `- "segments": die NEUEN ABSCHNITTE in Reihenfolge mit Rolle. Der Berater erklärt und schlägt vor; der Kunde fragt und schildert. Nichts hinzufügen.
` : ''}- "covered": Texte AUS KUNDENKONTEXT.briefing, Karte vom Typ "talktrack" (Felder open/mention/ask), wörtlich übernommen, die im bisherigen und neuen Gespräch bereits angesprochen wurden. Sonst leer.
` : ''}- Jede Zahl, die du schreibst, muss wörtlich in KUNDENKONTEXT, KACHELN oder GRAFIKEN stehen.${p.language === 'en' ? `
${AGENT_ENGLISH}` : ''}` },
    { role: 'user', content: `KUNDENKONTEXT:\n${JSON.stringify(p.context)}\n\nKACHELN:\n${JSON.stringify(p.tiles)}\n\nGRAFIKEN:\n${JSON.stringify(p.charts)}\n\nBISHERIGES GESPRÄCH:\n${JSON.stringify(p.transcript ?? [])}\n\nNEUE ABSCHNITTE:\n${JSON.stringify(p.segments ?? [])}\n\nGESAGT:\n${JSON.stringify(p.said ?? [])}\n\nEREIGNIS: ${p.event}` },
  ]
}

function analysePrompt(p: { context: unknown; modules: unknown; transcript: unknown; segments: unknown; detail: string }): Message[] {
  return [
    { role: 'system', content: `${RULES}
Du hörst ein Telefongespräch zwischen Berater und Kunde mit. NEUE ABSCHNITTE stammen aus einer automatischen Transkription mit Sprecher-Kennungen, die nur innerhalb dieser Lieferung gelten.
Schema: {"segments": [{"speaker": "Kunde" | "Berater", "text": string}], "customer": {"heard": string, "text": string, "why": string, "topic": string} | null, "advisor": {"heard": string, "text": string, "topic": string} | null, "insight": {"text": string, "sources": string[], "module": {"id": string, "confidence": number} | null} | null}
- "segments": die neuen Abschnitte in Reihenfolge, jeder der Rolle zugeordnet. Der Berater erklärt, ordnet ein und schlägt vor; der Kunde fragt und schildert Anliegen. Transkriptionsfehler behutsam korrigieren, nichts hinzufügen.
- "customer": nur wenn der KUNDE in den neuen Abschnitten ein Anliegen geäussert hat, das der Kontext abdeckt. "heard" = seine Aussage, "text" = STICHPUNKT für die Antwort, kein ganzer Satz (höchstens 12 Wörter, Nominalstil, ohne Artikel am Anfang): Ursache mit Zahl und, falls im Kontext vorhanden, die konkrete Massnahme mit Betrag, "why" = Begründung mit Zahlen, "topic" = Stichwort.
- "advisor": nur wenn der BERATER in den neuen Abschnitten ein Thema angesprochen hat. "heard" = seine Aussage, "text" = der vorausschauend nächste Schritt für ihn, "topic" = Stichwort.
- "insight": Einblick für den Berater zum Anliegen des Kunden, Umfang: ${DETAIL[p.detail] ?? DETAIL.standard}; Grafik wie beschrieben höchstens eine aus VERFÜGBARE GRAFIKEN mit Konfidenz 0–100.
Bei Begrüssungen und Belanglosem sind "customer", "advisor" und "insight" null.` },
    { role: 'user', content: `KUNDENKONTEXT:\n${JSON.stringify(p.context)}\n\nVERFÜGBARE GRAFIKEN:\n${JSON.stringify(p.modules)}\n\nBISHERIGES GESPRÄCH:\n${JSON.stringify(p.transcript)}\n\nNEUE ABSCHNITTE:\n${JSON.stringify(p.segments)}` },
  ]
}

// The clients as the database holds them, minus every account field that can hold an IBAN or an
// account name: this goes to the browser, and the IBANs in the data are real.
async function caseClients(): Promise<unknown[]> {
  const { clients } = await loadData()
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip)
    if (typeof v !== 'object' || v === null) return v
    return Object.fromEntries(Object.entries(v).filter(([k]) => !/^(iban|accountname|accountnumber)$/i.test(k)).map(([k, x]) => [k, strip(x)]))
  }
  return clients.map(strip)
}

type Word = { text: string; type?: string; speaker_id?: string }

// Without an ElevenLabs key the OpenAI key transcribes. It has no speaker separation, so the whole
// chunk comes back as one speaker and the screen agent assigns Kunde/Berater from the content.
// One fixed call language (TRANSCRIBE_LANGUAGE in .env.local: de or en, default de). Without it the model
// follows whatever it hears and a German call gets English lines in between.
const SPOKEN = {
  de: { iso3: 'deu', prompt: 'Telefongespräch auf Deutsch zwischen einem Kundenberater einer Schweizer Bank und seinem Kunden über das Portfolio. Es wird ausschliesslich Deutsch gesprochen und geschrieben.' },
  en: { iso3: 'eng', prompt: 'Phone call in English between a client advisor of a Swiss bank and a client about the portfolio. Only English is spoken and written.' },
}
const spoken = (env: Env) => (env.TRANSCRIBE_LANGUAGE === 'en' ? 'en' : 'de')
async function transcribeOpenAI(env: Env, audio: Buffer, contentType: string) {
  const form = new FormData()
  form.append('model', env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe')
  form.append('language', spoken(env))
  form.append('prompt', SPOKEN[spoken(env)].prompt)
  form.append('file', new Blob([new Uint8Array(audio)], { type: contentType }), `abschnitt.${/mp4|m4a|aac/.test(contentType) ? 'mp4' : /ogg/.test(contentType) ? 'ogg' : 'webm'}`)
  const r = await fetch(`${env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form })
  if (!r.ok) throw new Error(`OpenAI-Transkription ${r.status}: ${(await r.text()).slice(0, 300)}`)
  const text = ((await r.json()) as { text?: string }).text?.trim() ?? ''
  // On silence the model tends to echo its own prompt back; that is not speech.
  const echo = (t: string) => t.length < 2 || SPOKEN[spoken(env)].prompt.toLowerCase().includes(t.toLowerCase().replace(/[.…:]+$/, '')) || /^(context|kontext)/i.test(t)
  return text && !echo(text) ? [{ speaker: 'speaker_0', text }] : []
}

async function transcribe(env: Env, audio: Buffer, contentType: string) {
  if (!env.ELEVENLABS_API_KEY) {
    if (env.OPENAI_API_KEY) return transcribeOpenAI(env, audio, contentType)
    throw new Error('Keine Transkription konfiguriert (ElevenLabs oder OpenAI)')
  }
  const form = new FormData()
  form.append('model_id', env.ELEVENLABS_STT_MODEL || 'scribe_v1')
  form.append('language_code', SPOKEN[spoken(env)].iso3)
  form.append('diarize', 'true')
  form.append('file', new Blob([new Uint8Array(audio)], { type: contentType }), `abschnitt.${/mp4|m4a|aac/.test(contentType) ? 'mp4' : /ogg/.test(contentType) ? 'ogg' : 'webm'}`)
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
      // News agent (server/market): fast model judges headlines; without a key, keyword rules.
      // The watcher starts with the server and keeps news at most 10 minutes old.
      const pick: Provider | null = ready(env, 'openai') ? 'openai' : ready(env, 'apertus') ? 'apertus' : null
      const judgeLlm = pick ? (m: Message[]) => complete(env, pick, true, m) : null
      if (env.NEWS_WATCHER !== 'off') startNewsWatcher(judgeLlm)
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          if (req.url.startsWith('/api/call/') && await callRoute(req, res)) return
          if (req.url === '/api/status') return send(res, 200, { openai: ready(env, 'openai'), apertus: ready(env, 'apertus'), elevenlabs: !!env.ELEVENLABS_API_KEY, transcribe: !!env.ELEVENLABS_API_KEY || !!env.OPENAI_API_KEY, callLanguage: spoken(env), daten: await dataStatus() })
          if (req.url === '/api/house-view' && req.method === 'GET') return send(res, 200, houseView())
          if (req.url === '/api/clients' && req.method === 'GET') return send(res, 200, await caseClients())
          const llm = { complete: (p: Provider, m: Message[]) => complete(env, p, true, m), ready: (p: Provider) => ready(env, p) }
          if (req.url.startsWith('/api/briefing60')) {
            if (req.url.startsWith('/api/briefing60/clients')) return send(res, 200, await briefingClients())
            const out = await briefing60(req.method ?? 'GET', req.url, req.method === 'POST' ? await body(req) : null, llm)
            return send(res, out.status, out.data)
          }
          const path = req.url.split('?')[0]
          if (path.startsWith('/api/import/')) { const out = await importRoute(req.url, req.method ?? 'GET', req.method === 'POST' ? await body(req) : Buffer.alloc(0), llm); if (out) return send(res, out.status, out.data) }
          if (path === '/api/news/status' && req.method === 'GET') return send(res, 200, newsStatus())
          if (path === '/api/outbound' && req.method === 'GET') { const out = await outbound(judgeLlm); return send(res, out.status, out.data) }
          if (path === '/api/news' && req.method === 'GET') { const out = await newsFeed(judgeLlm); return send(res, out.status, out.data) }
          if (path === '/api/news' && req.method === 'POST') { const out = pushNews(await body(req)); return send(res, out.status, out.data) }
          if (path === '/api/news/snapshot' && req.method === 'POST') { const out = await snapshotNews(); return send(res, out.status, out.data) }
          if (path.startsWith('/api/news/') && req.method === 'GET') { const out = await clientNews(decodeURIComponent(path.slice('/api/news/'.length)), judgeLlm); return send(res, out.status, out.data) }
          if (path.startsWith('/api/briefing/') && req.method === 'GET' && new URL(req.url, 'http://local').searchParams.get('tier') === 'slow') {
            return send(res, 200, { cards: [], findings: await briefingNews(decodeURIComponent(path.split('/')[3] ?? ''), judgeLlm) })
          }
          if (req.url.startsWith('/api/news-agent') && req.method === 'GET') { const out = await newsAgentRoute(req.url, llm); return send(res, out.status, out.data) }
          if (req.url.startsWith('/api/briefing/') && req.method === 'GET') { const out = await appBriefing(req.url, llm); return send(res, out.status, out.data) }
          if (req.url === '/api/clients/upload' && req.method === 'POST') { const out = uploadClients(await body(req)); return send(res, out.status, out.data) }
          if (path === '/api/call-plan' && req.method === 'POST') { const out = await callPlanRoute(await body(req), llm); return send(res, out.status, out.data) }
          if (path.startsWith('/api/calls/') && req.method === 'POST') {
            const out = await callsRoute(path, req.method, await body(req), llm)
            if (out) return send(res, out.status, out.data)
          }
          if (req.method !== 'POST') return send(res, 405, { error: 'Nur POST' })
          const raw = await body(req)
          if (req.url === '/api/transcribe') { const segments = await transcribe(env, raw, req.headers['content-type'] || 'audio/webm'); console.info(`[transcribe] ${raw.length} bytes -> ${segments.length} segments`); return send(res, 200, { segments }) }
          const p = JSON.parse(raw.toString('utf8'))
          const provider: Provider = p.provider === 'apertus' ? 'apertus' : 'openai'
          // A4: tools over the client's data (function calling on OpenAI, keyword routing otherwise); /api/chat/data needs no model.
          if (req.url === '/api/chat') return send(res, 200, await chatWithData(p, provider, providerConfig(env, provider, false), chatPrompt(p), (m) => complete(env, provider, false, m)))
          if (req.url === '/api/chat/data') return send(res, 200, await askData(p))
          if (req.url === '/api/summary') return send(res, 200, await complete(env, provider, true, summaryPrompt(p)))
          if (req.url === '/api/translate') {
            if (!Array.isArray(p.texts) || !p.texts.length) return send(res, 200, { texts: [] })
            if (p.language !== 'en') return send(res, 200, { texts: p.texts })
            const out = await complete(env, provider, true, translatePrompt(p)) as { texts?: unknown }
            const texts = Array.isArray(out.texts) && out.texts.length === p.texts.length ? out.texts : p.texts
            return send(res, 200, { texts })
          }
          if (req.url === '/api/demo-script') return send(res, 200, await complete(env, provider, false, demoScriptPrompt(p)))
          // The screen agent decides what the advisor sees mid-call: it may run on a stronger model than the other fast calls.
          if (req.url === '/api/agent') return send(res, 200, await complete(env, provider, true, agentPrompt(p), env.OPENAI_MODEL_AGENT))
          if (req.url === '/api/analyse') return send(res, 200, await complete(env, provider, true, analysePrompt(p)))
          send(res, 404, { error: 'Unbekannter Pfad' })
        } catch (e) {
          send(res, 502, { error: e instanceof Error ? e.message : String(e) })
        }
      })
    },
  }
}
