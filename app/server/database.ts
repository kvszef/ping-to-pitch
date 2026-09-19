// Die Kundendatenbank, aus der die App liest: SQLite über MCP Toolbox (phone/data/unrisk.db),
// mit den Case-Dateien als Rückfallebene.
//
// Warum über die Datenbank und nicht mehr aus clients.json:
//  * Der Telefon-Copilot schreibt nach jedem Gespräch eine Zusammenfassung in clients.description.
//    Die steht in keiner Quelldatei. Liest die App aus der Datenbank, kennt das Briefing, was am
//    Telefon besprochen wurde -- sonst müsste es dieselbe Wahrheit ein zweites Mal einsammeln.
//  * Es gibt eine Ladestelle für beide Teile des Projekts. Am Fallbeispiel werden drei weitere
//    Kundendateien nachgereicht; danach genügt ein `npm run load-data`, und App wie Copilot
//    sehen dieselben Kunden.
//
// Die Datenbank ist normalisiert, die Engine erwartet aber den Kundensatz in der Form von
// clients.json. Sie wird deshalb hier wieder zusammengesetzt: `clients.raw_json` lässt die fünf
// Sammlungen mit eigener Tabelle weg, `portfolios.raw_json` die zwei -- und genau diese sieben
// liefern die Werkzeuge app_portfolios ... app_notes einzeln, mit dem Schlüssel, an dem sie
// wieder hingehören. Es geht nichts verloren und es wird nichts gerechnet: was hier herauskommt,
// ist das Quellobjekt der Lieferung.
//
// Fällt die Toolbox aus, werden die Case-Dateien gelesen. Ein Demo darf nicht an einem nicht
// gestarteten Dienst sterben. Welche Quelle gerade trägt, steht in `source` und in /api/status.

import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { invoke, toolboxReady, ToolboxError, type ToolRow } from './toolbox.ts'

export type Raw = Record<string, unknown>
export type Source = 'toolbox' | 'dateien'

export const DATA = resolve(process.cwd(), '../core-case/portfolio-data')

/** Die sieben Sammlungen mit eigener Tabelle, in der Reihenfolge, in der sie angehängt werden. */
export type Tables = {
  clients: ToolRow[]
  portfolios: ToolRow[]
  positions: ToolRow[]
  accounts: ToolRow[]
  proposals: ToolRow[]
  transactions: ToolRow[]
  violations: ToolRow[]
  notes: ToolRow[]
}

// ------------------------------------------------------------------ Hilfen

/**
 * Toolbox parst JSON-Zeichenketten in Ergebniszellen selbst auf, `satz` kommt also als Objekt an.
 * Eine ältere Fassung täte es nicht, und dann stünde dort die Zeichenkette -- beides wird hier
 * angenommen, damit ein Versionssprung der Toolbox die App nicht umbringt.
 */
function doc(value: unknown): Raw | null {
  if (typeof value === 'string') {
    try { return doc(JSON.parse(value)) } catch { return null }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null
}

const key = (row: ToolRow, name: string): string => {
  const v = row[name]
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Zeilen nach einer Spalte bündeln, Reihenfolge der Lieferung bleibt erhalten. */
function groupBy(rows: ToolRow[], column: string): Map<string, Raw[]> {
  const out = new Map<string, Raw[]>()
  for (const row of rows) {
    const d = doc(row.satz)
    if (!d) continue
    const k = key(row, column)
    const list = out.get(k)
    if (list) list.push(d)
    else out.set(k, [d])
  }
  return out
}

// ------------------------------------------------------------------ Zusammensetzen

/**
 * Aus den Tabellenzeilen wieder ganze Kundensätze, einer je Zeile in `clients`.
 *
 * Die sieben Sammlungen werden immer gesetzt, auch wenn sie leer sind. In der Lieferung fehlt ein
 * leeres Feld mal ganz und steht mal als `null` da (20 Kunden führen `SuitabilityViolations: null`);
 * eine leere Liste ist beides nicht, aber alles, was die Engine daraus ohnehin macht.
 */
export function assembleClients(t: Tables): Raw[] {
  const positions = groupBy(t.positions, 'portfolio_id')
  const accounts = groupBy(t.accounts, 'portfolio_id')
  const portfolios = groupBy(t.portfolios, 'client_ref')
  const proposals = groupBy(t.proposals, 'client_ref')
  const transactions = groupBy(t.transactions, 'client_ref')
  const violations = groupBy(t.violations, 'client_ref')
  const notes = groupBy(t.notes, 'client_ref')

  // portfolio_id steht in der Portfoliozeile UND im Rohobjekt. Genommen wird die Spalte: sie ist
  // der Schlüssel, über den positions und accounts gebündelt sind.
  const portfolioKey = new Map<Raw, string>()
  for (const row of t.portfolios) {
    const d = doc(row.satz)
    if (d) portfolioKey.set(d, key(row, 'portfolio_id'))
  }

  const out: Raw[] = []
  for (const row of t.clients) {
    const base = doc(row.satz)
    if (!base) continue
    const ref = key(row, 'client_ref') || str(base.ClientRef)
    if (!ref) continue
    out.push({
      ...base,
      // Der gepflegte Freitext gewinnt: er enthält die Gesprächszusammenfassungen, die der
      // Telefon-Copilot angehängt hat, das Rohobjekt nur den Stand der Lieferung.
      Description: str(row.beschreibung) || base.Description,
      Portfolios: (portfolios.get(ref) ?? []).map((p) => ({
        ...p,
        SecurityPositions: positions.get(portfolioKey.get(p) ?? '') ?? [],
        AccountPositions: accounts.get(portfolioKey.get(p) ?? '') ?? [],
      })),
      Proposals: proposals.get(ref) ?? [],
      Transactions: transactions.get(ref) ?? [],
      SuitabilityViolations: violations.get(ref) ?? [],
      ClientNotes: notes.get(ref) ?? [],
    })
  }
  return out
}

/** Aus je einer Zeile pro Sammlung wieder die ganze reference.json. */
export function assembleReference(rows: ToolRow[]): Raw {
  const out: Raw = {}
  for (const row of rows) {
    const name = str(row.name)
    if (!name) continue
    // Anders als bei den Kunden ist `satz` hier eine Liste, doc() greift also nicht.
    const value = typeof row.satz === 'string' ? JSON.parse(row.satz) as unknown : row.satz
    out[name] = value
  }
  return out
}

// ------------------------------------------------------------------ Quellen

/** Die neun Werkzeuge des Toolsets app_data, alle parameterlos, alle Zeilen. */
async function fromToolbox(): Promise<{ clients: Raw[]; reference: Raw }> {
  const [clients, portfolios, positions, accounts, proposals, transactions, violations, notes, reference] =
    await Promise.all([
      invoke('app_clients'), invoke('app_portfolios'), invoke('app_positions'), invoke('app_accounts'),
      invoke('app_proposals'), invoke('app_transactions'), invoke('app_violations'), invoke('app_notes'),
      invoke('app_reference'),
    ])
  const assembled = assembleClients({ clients, portfolios, positions, accounts, proposals, transactions, violations, notes })
  if (!assembled.length) throw new ToolboxError('Die Datenbank enthält keine Kunden. Gebaut mit:  cd phone && npm run load-data')
  return { clients: assembled, reference: assembleReference(reference) }
}

/**
 * `DATA_SOURCE=dateien` überspringt die Datenbank und liest die Case-Dateien. Dafür gibt es zwei
 * Gründe: Tests und CI laufen ohne eine Toolbox, die sie starten müssten, und am Vorführtag ist es
 * der eine Schalter, mit dem man die Datenkette auf die Dateien zurücksetzt, ohne Code zu ändern.
 * `DATA_SOURCE=toolbox` ist die Vorgabe und braucht niemand zu setzen.
 */
const forcedSource = (): Source | null => {
  const v = (process.env.DATA_SOURCE ?? '').trim().toLowerCase()
  return v === 'dateien' || v === 'files' ? 'dateien' : v === 'toolbox' ? 'toolbox' : null
}

/**
 * Adds handed-over clients to the case clients. Same rules as phone/scripts/load-data.ts, so the
 * database and the file fallback show the same people: same ref and same ClientId is an update and
 * replaces; same ref with another ClientId is another person and is kept as `<ref>-2`.
 */
export function mergeNewClients(base: Raw[], added: Raw[]): Raw[] {
  const out = [...base]
  for (const entry of added) {
    const ref = str(entry?.ClientRef)
    if (!ref) continue
    const at = out.findIndex((c) => c.ClientRef === ref)
    if (at < 0) out.push(entry)
    else if (out[at].ClientId === entry.ClientId) out[at] = entry
    else {
      let n = 2
      while (out.some((c) => c.ClientRef === `${ref}-${n}`)) n++
      out.push({ ...entry, ClientRef: `${ref}-${n}` })
    }
  }
  return out
}

/** Every client in new-clients/, in file name order. A file holds one client or an array. Never throws. */
async function newClients(): Promise<Raw[]> {
  const dir = resolve(DATA, 'new-clients')
  const names = await readdir(dir).catch(() => [] as string[])
  const out: Raw[] = []
  for (const name of names.filter((n) => n.toLowerCase().endsWith('.json')).sort()) {
    try {
      const parsed = JSON.parse(await readFile(resolve(dir, name), 'utf8')) as unknown
      out.push(...(Array.isArray(parsed) ? parsed as Raw[] : parsed && typeof parsed === 'object' ? [parsed as Raw] : []))
    } catch (e) {
      console.warn(`[daten] new-clients/${name} übersprungen: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}

/** Rückfallebene: die Case-Dateien, wie sie übergeben wurden, plus new-clients/. */
async function fromFiles(): Promise<{ clients: Raw[]; reference: Raw }> {
  const [clients, reference] = await Promise.all(
    ['clients.json', 'reference.json'].map(async (f) => JSON.parse(await readFile(resolve(DATA, f), 'utf8')) as unknown),
  )
  return { clients: mergeNewClients(Array.isArray(clients) ? clients as Raw[] : [], await newClients()), reference: (reference ?? {}) as Raw }
}

// ------------------------------------------------------------------ Laden

export type Loaded = { clients: Raw[]; reference: Raw; source: Source; warning?: string }

let loaded: Promise<Loaded> | null = null
/** Was zuletzt getragen hat. Für die Statusanzeige, die deswegen nicht warten muss. */
let lastSource: Source | null = null

/**
 * Kunden und Nachschlagedaten, einmal geladen und dann gehalten. Erst die Datenbank; antwortet sie
 * nicht, die Dateien. Ein Fehlschlag verwirft den Zwischenstand, der nächste Aufruf versucht es neu
 * -- wer die Toolbox nachträglich startet, muss die App nicht neu starten.
 */
export function loadData(): Promise<Loaded> {
  loaded ??= (async (): Promise<Loaded> => {
    if (forcedSource() === 'dateien') {
      const data = await fromFiles()
      lastSource = 'dateien'
      return { ...data, source: 'dateien' }
    }
    try {
      const data = await fromToolbox()
      console.log(`[daten] ${data.clients.length} Kunden aus der Datenbank über MCP Toolbox`)
      lastSource = 'toolbox'
      return { ...data, source: 'toolbox' }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      const data = await fromFiles()
      const warning = `Datenbank nicht erreichbar (${reason}), gelesen wurden die Case-Dateien. Starten mit:  cd phone && npm run toolbox`
      console.warn(`[daten] ${warning}`)
      lastSource = 'dateien'
      return { ...data, source: 'dateien', warning }
    }
  })()
  loaded.catch(() => { loaded = null })
  return loaded
}

/**
 * Für die Statusanzeige: welche Quelle zuletzt getragen hat und ob die Datenbank gerade antwortet.
 * Stösst das Laden nicht an und wartet nie auf einen laufenden Ladevorgang.
 */
export async function dataStatus(): Promise<{ source: Source | null; toolbox: boolean }> {
  return { source: lastSource, toolbox: await toolboxReady() }
}

/** Nur für Tests: den Zwischenstand verwerfen. */
export function resetData(): void { loaded = null; lastSource = null }
