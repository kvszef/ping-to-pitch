// Wer ruft an? Die Anrufernummer kommt roh aus Vapi, die Zuordnung liegt in der Tabelle
// phone_map und wird über das Werkzeug find_client_by_phone gelesen.
//
// Zwei Regeln, die hier über allem stehen:
//   1. Die Erkennung darf das Gespräch nie zum Scheitern bringen. Fällt Toolbox aus, kommt
//      `clientRef: null` mit `confidence: 'unknown'` zurück, nie eine Ausnahme.
//   2. Keine vollständige Telefonnummer ins Log und nicht in `via`. Die letzten vier Stellen
//      genügen, um im Demo-Betrieb zu erkennen, welcher Anruf gemeint ist.

import { toE164 } from './events.ts'
import type { Identity, ToolboxClient, ToolName, ToolRow } from './types.ts'

const DEFAULT_COUNTRY = () => process.env.DEFAULT_COUNTRY || '+41'

/** Nur die letzten vier Stellen, der Rest wird zu Punkten. Leerstring bleibt sprechend. */
export function maskPhone(phone: string): string {
  if (!phone) return 'unterdrückt'
  return phone.length <= 4 ? `…${phone}` : `…${phone.slice(-4)}`
}

// Die Spaltennamen kommen aus toolbox/schema.sql (client_ref, name). Toleranz gegenüber
// anderer Schreibweise kostet nichts und erspart einen Fehlersuchabend.
const pick = (row: ToolRow, keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = row?.[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

const clientRefOf = (row: ToolRow) => pick(row, ['client_ref', 'clientRef', 'ClientRef'])
const nameOf = (row: ToolRow) => pick(row, ['name', 'client_name', 'Name', 'ClientName'])

/**
 * Der Parametername eines Werkzeugs steht in toolbox/tools.yaml, nicht hier. Statt ihn zu
 * raten, wird er aus `describe()` gelesen – das ist zwischengespeichert und kostet nichts.
 */
async function paramName(client: ToolboxClient, tool: ToolName, fallback: string): Promise<string> {
  try {
    const tools = await client.describe()
    const found = tools.find((t) => t.name === tool)
    if (!found) return fallback
    return found.inputSchema.required?.[0] ?? Object.keys(found.inputSchema.properties)[0] ?? fallback
  } catch {
    return fallback
  }
}

const unknown = (via: string): Identity => ({ clientRef: null, confidence: 'unknown', via })

/** Vorauswahl aus der Umgebung, falls die Nummer nichts hergibt. */
function fallbackIdentity(reason: string): Identity {
  const preset = (process.env.DEFAULT_CLIENT_REF || '').trim()
  if (!preset) return unknown(reason)
  return {
    clientRef: preset,
    confidence: 'manual',
    via: `${reason}; ${preset} aus DEFAULT_CLIENT_REF vorausgewählt, nicht erkannt`,
  }
}

/**
 * Ordnet die rohe Anrufernummer einem Kunden zu. Wirft nicht.
 * Treffer in phone_map ergibt `confidence: 'phone'`, sonst greift DEFAULT_CLIENT_REF
 * (`'manual'`) und zuletzt `'unknown'`.
 */
export async function identifyByPhone(client: ToolboxClient, rawNumber: string): Promise<Identity> {
  const phone = toE164(rawNumber ?? '', DEFAULT_COUNTRY())
  const masked = maskPhone(phone)
  if (!phone) return fallbackIdentity('Anrufernummer unterdrückt')

  let rows: ToolRow[]
  try {
    const key = await paramName(client, 'find_client_by_phone', 'phone')
    rows = await client.invoke('find_client_by_phone', { [key]: phone })
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    console.warn(`Kundenerkennung ${masked} fehlgeschlagen: ${reason}`)
    // Bewusst kein DEFAULT_CLIENT_REF: bei defekter Datenquelle wäre das geraten, nicht vorausgewählt.
    return unknown(`Kundenerkennung ohne Datenquelle – ${reason}`)
  }

  const hit = rows.find((r) => clientRefOf(r))
  if (!hit) {
    console.log(`Kundenerkennung ${masked}: keine Zuordnung in phone_map`)
    return fallbackIdentity(`Nummer ${masked} nicht in phone_map`)
  }

  const clientRef = clientRefOf(hit)!
  const name = nameOf(hit)
  console.log(`Kundenerkennung ${masked}: ${clientRef}${name ? ` (${name})` : ''}`)
  return { clientRef, name, confidence: 'phone', via: `find_client_by_phone(${masked})` }
}

/**
 * Nachträgliche Erkennung über einen im Gespräch genannten Namen. Nur bei genau einem
 * eindeutigen Treffer wird etwas zurückgegeben – bei mehreren lieber nichts als geraten,
 * denn ein falscher Kunde ist schlimmer als gar keiner.
 */
export async function identifyByName(client: ToolboxClient, spokenName: string): Promise<Identity | null> {
  const query = (spokenName ?? '').trim()
  if (query.length < 3) return null

  let rows: ToolRow[]
  try {
    const key = await paramName(client, 'search_clients_by_name', 'name')
    rows = await client.invoke('search_clients_by_name', { [key]: query })
  } catch (e) {
    console.warn(`Namenssuche «${query}» fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }

  // Mehrere Zeilen desselben Kunden (z. B. je Portfolio) sind ein Treffer, kein Zweifel.
  const refs = new Map<string, ToolRow>()
  for (const row of rows) {
    const ref = clientRefOf(row)
    if (ref && !refs.has(ref)) refs.set(ref, row)
  }
  if (refs.size !== 1) {
    console.log(`Namenssuche «${query}»: ${refs.size} Treffer, keine Zuordnung`)
    return null
  }

  const [clientRef, row] = [...refs.entries()][0]
  return { clientRef, name: nameOf(row), confidence: 'name', via: `search_clients_by_name(${query})` }
}
