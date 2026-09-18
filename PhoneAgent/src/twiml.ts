import { config } from './config.ts'

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export type RelayOptions = {
  /** wss://… URL, auf die ConversationRelay den Audiostrom als Text schickt */
  wsUrl: string
  /** URL, die Twilio nach Ende der Relay-Session aufruft */
  actionUrl: string
  greeting: string
  /** Landet 1:1 in `setup.customParameters` der WebSocket-Session */
  parameters?: Record<string, string>
}

/**
 * Baut das TwiML, das Twilio beim eingehenden Anruf abholt. Sprache, Stimme und
 * Erkennungs-Provider kommen aus der .env; leere Werte lassen Twilio den Standard wählen.
 */
export function conversationRelayTwiml(opts: RelayOptions): string {
  const attrs: Record<string, string> = {
    url: opts.wsUrl,
    welcomeGreeting: opts.greeting,
    language: config.language,
    ttsLanguage: config.ttsLanguage,
    transcriptionLanguage: config.transcriptionLanguage,
    ttsProvider: config.ttsProvider,
    voice: config.voice,
    transcriptionProvider: config.transcriptionProvider,
    speechModel: config.speechModel,
    interruptible: 'any',
    dtmfDetection: 'true',
  }
  const attrString = Object.entries(attrs)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}="${escapeXml(v)}"`)
    .join(' ')
  const params = Object.entries(opts.parameters ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `      <Parameter name="${escapeXml(k)}" value="${escapeXml(v)}" />`)
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Connect action="${escapeXml(opts.actionUrl)}">`,
    params ? `    <ConversationRelay ${attrString}>\n${params}\n    </ConversationRelay>` : `    <ConversationRelay ${attrString} />`,
    '  </Connect>',
    '</Response>',
    '',
  ].join('\n')
}

export const hangupTwiml = (): string =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Hangup />\n</Response>\n'
