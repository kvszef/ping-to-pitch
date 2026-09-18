import twilio from 'twilio'
import { config } from '../src/config.ts'

// Skripte sollen bei fehlenden Zugangsdaten oder Twilio-Fehlern eine klare Meldung zeigen, keinen Stacktrace.
const fail = (err: unknown): void => {
  console.error(err instanceof Error ? err.message : String(err))
  if (process.env.DEBUG) console.error(err)
  process.exit(1)
}
process.on('unhandledRejection', fail)
process.on('uncaughtException', fail)

export const twilioClient = () => {
  const { accountSid, authToken } = config.twilio
  if (!accountSid || !authToken) throw new Error('TWILIO_ACCOUNT_SID und TWILIO_AUTH_TOKEN fehlen in .env')
  return twilio(accountSid, authToken)
}

/** Hinterlegt `<publicUrl>/twiml` als Voice-Webhook der Nummer aus TWILIO_PHONE_NUMBER. */
export async function setVoiceWebhook(publicUrl: string): Promise<string> {
  const number = config.twilio.phoneNumber
  if (!number) throw new Error('TWILIO_PHONE_NUMBER fehlt in .env')
  const client = twilioClient()
  const [existing] = await client.incomingPhoneNumbers.list({ phoneNumber: number, limit: 1 })
  if (!existing) throw new Error(`Nummer ${number} gehört nicht zu diesem Twilio-Konto`)
  const voiceUrl = `${publicUrl.replace(/\/+$/, '')}/twiml`
  await client.incomingPhoneNumbers(existing.sid).update({ voiceUrl, voiceMethod: 'POST' })
  return voiceUrl
}
