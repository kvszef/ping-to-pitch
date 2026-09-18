import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
/** Absoluter Pfad des Ordners PhoneAgent. */
export const ROOT = path.resolve(here, '..')

const env = (key: string, fallback = ''): string => (process.env[key] ?? '').trim() || fallback
const flag = (key: string, fallback = false): boolean => {
  const v = env(key).toLowerCase()
  if (!v) return fallback
  return v === '1' || v === 'true' || v === 'yes'
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const config = {
  port: Number(env('PORT', '3000')),
  publicUrl: env('PUBLIC_URL').replace(/\/+$/, ''),

  model: env('MODEL', 'claude-opus-5'),
  effort: env('EFFORT', 'low') as Effort,
  maxTokens: Number(env('MAX_TOKENS', '1024')),
  mockLlm: flag('MOCK_LLM'),

  language: env('CALL_LANGUAGE', 'de-DE'),
  ttsLanguage: env('TTS_LANGUAGE'),
  transcriptionLanguage: env('TRANSCRIPTION_LANGUAGE'),
  ttsProvider: env('TTS_PROVIDER'),
  voice: env('TTS_VOICE'),
  transcriptionProvider: env('TRANSCRIPTION_PROVIDER'),
  speechModel: env('SPEECH_MODEL'),
  welcomeGreeting: env(
    'WELCOME_GREETING',
    'Grüezi und willkommen bei Ihrer Kundenberatung. Ich bin der digitale Assistent. Mit wem spreche ich?',
  ),
  welcomeGreetingKnown: env(
    'WELCOME_GREETING_KNOWN',
    'Grüezi {name}, willkommen bei Ihrer Kundenberatung. Ich bin der digitale Assistent. Wie kann ich Ihnen helfen?',
  ),

  defaultClientRef: env('DEFAULT_CLIENT_REF'),
  clientsJson: env('CLIENTS_JSON', '../core-case/portfolio-data/clients.json')
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => path.resolve(ROOT, p)),
  referenceJson: path.resolve(ROOT, env('REFERENCE_JSON', '../core-case/portfolio-data/reference.json')),
  callersJson: path.resolve(ROOT, env('CALLERS_JSON', 'callers.json')),

  twilio: {
    accountSid: env('TWILIO_ACCOUNT_SID'),
    authToken: env('TWILIO_AUTH_TOKEN'),
    phoneNumber: env('TWILIO_PHONE_NUMBER'),
    bundleSid: env('TWILIO_BUNDLE_SID'),
    addressSid: env('TWILIO_ADDRESS_SID'),
    validate: flag('TWILIO_VALIDATE', true),
  },
}

export const hasAnthropicCredentials = (): boolean =>
  Boolean(env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN'))
