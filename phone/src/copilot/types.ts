// Die Schnittstellen zwischen den Bausteinen des Copiloten. Wer an einem Baustein arbeitet,
// programmiert gegen diese Datei und braucht die anderen nicht zu kennen.
//
//   toolbox.ts   stellt einen ToolboxClient bereit
//   identify.ts  nutzt find_client_by_phone und liefert eine Identity
//   brain.ts     nutzt ToolboxClient und liefert Briefing, Vorschläge und Antworten
//   roles.ts     ordnet Transkriptzeilen den Rollen Kunde und Berater zu
//   ui/          zeigt nur Ereignisse aus events.ts an

import type { Briefing, IdentityConfidence, Speaker, Suggestion, Answer } from './events.ts'

/**
 * Die Werkzeuge im Toolset `call_copilot` von MCP Toolbox. Diese Namen sind der Vertrag
 * zwischen toolbox/tools.yaml und allem, was Werkzeuge aufruft. Sie tauchen auch in
 * `sources` der Vorschläge auf, damit jede Aussage rückverfolgbar bleibt.
 */
export const TOOL_NAMES = [
  'find_client_by_phone',
  'search_clients_by_name',
  'get_client_overview',
  'get_portfolio_summary',
  'get_positions_top',
  'get_saa_gap',
  'get_open_proposals',
  'get_violations',
  'get_recent_notes',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

/**
 * Das einzige schreibende Werkzeug, in einem eigenen Toolset `write`. Es taucht bewusst
 * nicht in `TOOL_NAMES` auf: das Modell bekommt nur die lesenden Werkzeuge zu sehen und
 * kann deshalb nichts von sich aus in das Kundendossier schreiben. Den Aufruf macht
 * session.ts am Gesprächsende, mit einem Text, den das Modell vorher formuliert hat.
 */
export const WRITE_TOOLS = ['append_call_summary'] as const
export type WriteToolName = (typeof WRITE_TOOLS)[number]

/** Eine Zeile aus einem Werkzeug. Toolbox liefert Objekte; JSON-Spalten sind bereits geparst. */
export type ToolRow = Record<string, unknown>

/**
 * Zugriff auf MCP Toolbox. Die Umsetzung spricht die REST-Schnittstelle
 * `POST {TOOLBOX_URL}/api/tool/{name}/invoke` an, damit keine Abhängigkeit nötig ist.
 */
export type ToolboxClient = {
  /** Ein Werkzeug aufrufen. Wirft bei Netz- oder Werkzeugfehlern. */
  invoke(name: ToolName | WriteToolName, args: Record<string, unknown>): Promise<ToolRow[]>
  /** Kurzer Erreichbarkeitstest für die Statusanzeige. */
  health(): Promise<boolean>
  /** Beschreibungen der Werkzeuge, wie das Modell sie als Tool-Definitionen bekommt. */
  describe(): Promise<ToolDescription[]>
}

export type ToolDescription = {
  name: ToolName
  description: string
  /** JSON-Schema der Parameter, direkt als `input_schema` für Claude verwendbar. */
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

/** Ergebnis der Kundenerkennung. `clientRef: null` heisst: Nummer unbekannt. */
export type Identity = {
  clientRef: string | null
  name?: string
  confidence: IdentityConfidence
  /** Woher die Erkennung stammt, für `sources` und die Anzeige. */
  via: string
}

/** Eine Transkriptzeile, wie sie die Rollenzuordnung und das Hirn sehen. */
export type Line = {
  lineId: number
  speaker: Speaker
  text: string
  final: boolean
}

/**
 * Ordnet neuen Zeilen die Rollen zu. Nötig, weil beide Personen in dasselbe Handy sprechen und
 * Vapi deshalb alles als eine Rolle liefert. Darf den Text behutsam korrigieren, aber nichts
 * hinzufügen. Gibt für jede übergebene Zeile genau eine Zuordnung zurück.
 */
export type RoleAssigner = (
  neu: Line[],
  bisher: Line[],
) => Promise<{ lineId: number; speaker: Speaker; text: string }[]>

/**
 * Das Copilot-Hirn. Drei Aufgaben, drei Aufrufe, alle grundsätzlich abbrechbar: bei einer neuen
 * Kundenaussage wird eine laufende Anfrage verworfen, statt veraltete Vorschläge zu zeigen.
 */
export type Brain = {
  /** Einmal je Anruf, sobald der Kunde erkannt ist. Liefert das 60-Sekunden-Briefing. */
  briefing(clientRef: string, signal?: AbortSignal): Promise<Briefing>
  /** Nach jeder abgeschlossenen Kundenaussage, gedrosselt. Leeres Array heisst: nichts zu sagen. */
  hints(input: HintInput, signal?: AbortSignal): Promise<Suggestion[]>
  /** Freie Rückfrage des Beraters im Eingabefeld. */
  ask(input: AskInput, signal?: AbortSignal): Promise<Answer>
  /**
   * Einmal am Gesprächsende: zwei bis vier Sätze zu dem, was besprochen und zugesagt wurde.
   * Der Text wird über `append_call_summary` an den Freitext des Kunden angehängt, steht also
   * beim nächsten Anruf im Briefing. Nur was im Gespräch wirklich gesagt wurde, keine Zahlen
   * aus den Stammdaten wiederholen.
   */
  summary(input: SummaryInput, signal?: AbortSignal): Promise<string>
}

export type SummaryInput = {
  callId: string
  clientRef: string
  /** Das ganze Gespräch, älteste Zeile zuerst. */
  transcript: Line[]
  /** Was der Copilot währenddessen vorgeschlagen hat. */
  suggestions: Suggestion[]
}

export type HintInput = {
  callId: string
  clientRef: string
  briefing: Briefing
  /** Die letzten Zeilen des Gesprächs, älteste zuerst. */
  transcript: Line[]
  /** Die Aussage, die den Aufruf ausgelöst hat. */
  trigger: string
}

export type AskInput = {
  callId: string
  clientRef: string | null
  briefing: Briefing
  transcript: Line[]
  question: string
}

/** Grenzen für die Live-Schleife. Siehe Latenzbudget im README. */
export const LIMITS = {
  /** Höchstens ein Modellaufruf in diesem Abstand. */
  hintIntervalMs: 2000,
  /** Fenster fuer die Rollenzuordnung: mehr Kontext bringt dort nichts. */
  transcriptWindow: 12,
  /** Hinweise und Rueckfragen bekommen das ganze Gespraech, gedeckelt gegen Ausreisser. */
  transcriptVoll: 200,
  /** Obergrenze für die Antwortlänge der Live-Schleife. */
  hintMaxTokens: 800,
} as const
