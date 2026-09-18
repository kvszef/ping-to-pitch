import Anthropic from '@anthropic-ai/sdk'
import { config } from './config.ts'
import { clientName, data, type Client } from './data.ts'

export type Emit = (token: string) => void

const anthropic = config.mockLlm ? null : new Anthropic()

const PERSONA = `Du bist der digitale Telefon-Assistent der Kundenberatung einer Schweizer Privatbank. Du sprichst mit einem Kunden am Telefon. Die Daten stammen aus dem Beratungssystem der Bank.

Gesprächsstil:
- Antworte auf Deutsch, höflich und in der Sie-Form, ruhig und professionell.
- Es ist ein Telefongespräch: kurze Antworten, in der Regel ein bis drei Sätze. Keine Aufzählungen, kein Markdown, keine Emojis, keine Sonderzeichen, keine Abkürzungen wie «k. A.».
- Sprich Zahlen so, wie man sie am Telefon sagt: «rund 726 Tausend Franken», «8,3 Prozent», «minus 4 Prozent». Runde sinnvoll.
- Nenne keine ISINs, Valorennummern oder Kontonummern, ausser der Kunde fragt ausdrücklich danach. IBANs nennst du nie.
- Beantworte die gestellte Frage und biete danach höchstens einen nächsten Punkt an. Stelle nur eine Frage aufs Mal.

Identifikation:
- Ist noch kein Kunde geladen, frage nach dem Namen oder der Kundennummer und rufe dann das Werkzeug select_client mit der passenden Kundennummer aus der Kundenliste auf. Passt kein Eintrag, sage das freundlich und frage noch einmal nach.
- Gib nie Daten eines anderen Kunden preis als des aktuell geladenen. Wechsle den Kunden nur, wenn sich der Anrufer ausdrücklich als jemand anderes vorstellt.

Inhalt:
- Antworte ausschliesslich anhand der Kundendaten im Systemkontext. Fehlt eine Information, sage das offen («Dazu liegt mir keine Angabe vor») und biete an, dass sich der Kundenberater meldet.
- Du gibst keine verbindlichen Anlageempfehlungen und führst keine Transaktionen aus. Du darfst erklären, was die Daten zeigen, zum Beispiel Abweichungen von der Anlagestrategie, Verstösse gegen Anlagerichtlinien oder offene Anlagevorschläge, und einen Rückruf durch den Kundenberater anbieten.
- Erkläre Fachbegriffe kurz und verständlich, wenn der Kunde nachfragt.
- Möchte der Kunde einen Menschen sprechen oder das Gespräch beenden, verabschiede dich kurz und sage, dass sich der Kundenberater meldet.`

let stableSystemCache = ''
const stableSystem = (): string => {
  if (!stableSystemCache) stableSystemCache = `${PERSONA}\n\nKundenliste (Kundennummer: Name):\n${data.roster()}`
  return stableSystemCache
}

const tools: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: 'select_client',
    description:
      'Lädt die Daten eines Kunden in den Systemkontext. Aufrufen, sobald der Anrufer seinen Namen oder seine Kundennummer genannt hat. Die Kundennummer muss aus der Kundenliste stammen, zum Beispiel CASE-004.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { client_ref: { type: 'string', description: 'Kundennummer aus der Kundenliste, z. B. CASE-004' } },
      required: ['client_ref'],
      additionalProperties: false,
    },
  },
]

const REFUSAL_TEXT = 'Entschuldigen Sie, dazu kann ich am Telefon leider keine Auskunft geben. Ihr Kundenberater meldet sich gerne bei Ihnen.'

/** Ein Gespräch: Verlauf, aktuell geladener Kunde, Anbindung an Claude. Eine Instanz pro Anruf. */
export class CallAgent {
  readonly messages: Anthropic.Beta.BetaMessageParam[] = []
  client: Client | undefined

  constructor(readonly callSid: string, initialClientRef?: string) {
    if (initialClientRef) this.client = data.find(initialClientRef)
  }

  private system(): Anthropic.Beta.BetaTextBlockParam[] {
    const context = this.client
      ? `Aktuell identifizierter Kunde (nur diese Daten verwenden):\n${data.summary(this.client)}`
      : 'Es ist noch kein Kunde identifiziert. Frage freundlich nach dem Namen oder der Kundennummer und lade den Kunden mit select_client.'
    return [
      { type: 'text', text: stableSystem(), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `Heutiges Datum: ${new Date().toISOString().slice(0, 10)}\n\n${context}` },
    ]
  }

  /**
   * Verarbeitet eine Äusserung des Anrufers und streamt die Antwort tokenweise über `emit`.
   * Wird `signal` abgebrochen (Anrufer unterbricht), bleibt der bis dahin gesprochene Text im Verlauf.
   * Liefert den vollständigen gesprochenen Text der Antwort.
   */
  async respond(userText: string, emit: Emit, signal: AbortSignal): Promise<string> {
    this.messages.push({ role: 'user', content: userText })
    if (!anthropic) return this.mockRespond(userText, emit)

    let spoken = ''
    // Manuelle Schleife statt Tool-Runner: der Stream muss bei einer Unterbrechung sofort abbrechbar sein.
    for (let hop = 0; hop < 4; hop++) {
      let hopText = ''
      const stream = anthropic.beta.messages.stream(
        {
          model: config.model,
          max_tokens: config.maxTokens,
          system: this.system(),
          tools,
          messages: this.messages,
          output_config: { effort: config.effort },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal },
      )
      stream.on('text', (delta) => { hopText += delta; spoken += delta; emit(delta) })

      let message: Anthropic.Beta.BetaMessage
      try {
        message = await stream.finalMessage()
      } catch (err) {
        if (signal.aborted) { this.pushAssistantText(hopText); return spoken }
        throw err
      }

      if (message.stop_reason === 'tool_use') {
        this.messages.push({ role: 'assistant', content: message.content })
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
        for (const block of message.content) if (block.type === 'tool_use') results.push(this.runTool(block))
        this.messages.push({ role: 'user', content: results })
        continue
      }
      if (message.stop_reason === 'refusal' && !spoken) { hopText = REFUSAL_TEXT; spoken = REFUSAL_TEXT; emit(REFUSAL_TEXT) }
      this.pushAssistantText(hopText)
      return spoken
    }
    this.pushAssistantText(spoken)
    return spoken
  }

  /** Der Anrufer hat unterbrochen: Verlauf auf das kürzen, was er tatsächlich gehört hat. */
  truncateAfterInterrupt(heard: string): boolean {
    const needle = heard.trim()
    if (!needle) return false
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]
      if (m.role !== 'assistant' || typeof m.content !== 'string') continue
      const idx = m.content.indexOf(needle)
      if (idx === -1) continue
      m.content = m.content.slice(0, idx + needle.length)
      this.messages.splice(i + 1)
      return true
    }
    return false
  }

  private pushAssistantText(text: string): void {
    const t = text.trim()
    if (t) this.messages.push({ role: 'assistant', content: t })
  }

  private runTool(block: Anthropic.Beta.BetaToolUseBlock): Anthropic.Beta.BetaToolResultBlockParam {
    if (block.name === 'select_client') {
      const input = block.input as { client_ref?: string }
      const found = data.find(String(input.client_ref ?? ''))
      if (!found) {
        return { type: 'tool_result', tool_use_id: block.id, is_error: true, content: `Kein Kunde mit «${input.client_ref}» gefunden. Bitte den Anrufer nochmals nach Name oder Kundennummer fragen.` }
      }
      this.client = found
      return { type: 'tool_result', tool_use_id: block.id, content: `Kunde geladen: ${clientName(found)} (${found.ClientRef}). Die vollständigen Kundendaten stehen jetzt im Systemkontext.` }
    }
    return { type: 'tool_result', tool_use_id: block.id, is_error: true, content: `Unbekanntes Werkzeug ${block.name}` }
  }

  /** Ohne API-Key: deterministische Antworten, damit sich Twilio-Anbindung und WebSocket testen lassen. */
  private mockRespond(userText: string, emit: Emit): string {
    let reply: string
    if (!this.client) {
      const found = data.find(userText)
      if (found) {
        this.client = found
        reply = `Vielen Dank, ${clientName(found)}. Ich habe Ihre Daten geladen. Ihr Gesamtvermögen beträgt ${this.mockAum(found)}. Was möchten Sie wissen?`
      } else {
        reply = 'Gerne. Wie ist Ihr Name oder Ihre Kundennummer?'
      }
    } else {
      reply = `Testmodus ohne Sprachmodell. Sie sagten: ${userText}. Ihr Gesamtvermögen beträgt ${this.mockAum(this.client)}.`
    }
    emit(reply)
    this.pushAssistantText(reply)
    return reply
  }

  private mockAum(c: Client): string {
    const n = c.AssetsUnderManagementInDefaultCurrency
    return n == null ? 'unbekannt' : `rund ${Math.round(n / 1000)} Tausend ${c.ReportingCurrency ?? 'CHF'}`
  }
}
