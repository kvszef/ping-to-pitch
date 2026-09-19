// Das Kundendossier, wie es in der Datenbank steht: Spaltennamen und Rohwerte, kein Modell
// dazwischen. Gedacht für die Oberfläche, wenn man sehen will, was wirklich hinterlegt ist,
// statt wie der Copilot es formuliert.
//
// Zwei Entscheidungen, die den Rest erklären:
//  1. Nichts wird umbenannt, gerundet oder in Prozent umgerechnet. Die Anteile bleiben Brüche
//     von 0 bis 1, die Beträge behalten ihre Nachkommastellen, ein leeres Feld bleibt leer.
//     Wer wissen will, was in der Zelle steht, soll die Zelle sehen.
//  2. Jedes Werkzeug wird einzeln abgefangen. Fällt eines aus, steht in diesem Abschnitt der
//     Grund und die übrigen Abschnitte kommen trotzdem -- eine halbe Ansicht ist mehr wert
//     als eine Fehlerseite.
//
// Es werden ausschliesslich die lesenden Werkzeuge aus TOOL_NAMES benutzt, also dieselbe
// Quelle wie das Briefing. Kein neues SQL, kein neues Werkzeug, nichts am Vertrag mit dem
// Modell geändert.

import { sourceKey } from './toolbox.ts'
import type { ToolName, ToolboxClient, ToolRow } from './types.ts'

/**
 * Ein Abschnitt des Dossiers.
 *
 *   felder   ein einziger Datensatz, Feld unter Feld (die Stammdaten)
 *   tabelle  mehrere Zeilen mit denselben Spalten (Portfolios, Positionen, Notizen ...)
 *   text     Freitext aus der Datenbank
 *   json     das unveränderte Quellobjekt, hübsch eingerückt
 */
export type DossierAbschnitt = {
  titel: string
  /** Woher die Zeilen kommen, in der vereinbarten Schreibweise: `get_saa_gap(TESTER-01)`. */
  quelle: string
  art: 'felder' | 'tabelle' | 'text' | 'json'
  /** Spaltennamen genau so, wie das Werkzeug sie liefert. */
  spalten?: string[]
  zeilen?: string[][]
  text?: string
  /** Was man über diesen Abschnitt wissen muss, damit man die Zahlen nicht falsch liest. */
  hinweis?: string
  /** Gesetzt, wenn das Werkzeug nicht geantwortet hat. Dann bleiben die Zeilen leer. */
  fehler?: string
}

export type Dossier = {
  clientRef: string
  /** Name aus dem Kundensatz, sonst die Kundenkennung. */
  name: string
  /** Zeitpunkt des Abrufs, ISO-8601. */
  stand: string
  abschnitte: DossierAbschnitt[]
  /** false, sobald ein Werkzeug ausgefallen ist. */
  vollstaendig: boolean
}

/** Welche Werkzeuge das Dossier füllen, in der Reihenfolge, in der die Abschnitte erscheinen. */
type Schritt = {
  titel: string
  tool: ToolName
  art: 'felder' | 'tabelle'
  args: (ref: string) => Record<string, unknown>
  hinweis?: string
}

const nurRef = (ref: string) => ({ client_ref: ref })

const PLAN: Schritt[] = [
  {
    titel: 'Stammdaten',
    tool: 'get_client_overview',
    art: 'felder',
    args: nurRef,
    hinweis: 'Vier Kunden haben kein Risikoprofil und neunzehn kein ESG-Profil; leere Felder sind '
      + 'also kein Fehler. ist_firma und ist_mitarbeiter stehen als 0 oder 1 in der Datenbank.',
  },
  {
    titel: 'Portfolios',
    tool: 'get_portfolio_summary',
    art: 'tabelle',
    args: nurRef,
    hinweis: 'volatilitaet, erwartete_rendite und value_at_risk sind Brüche von 0 bis 1. '
      + 'wertentwicklung_ytd und wertentwicklung_12m sind Wertveränderungen und keine Renditen: '
      + 'Ein- und Auszahlungen stecken darin.',
  },
  {
    titel: 'Soll und Ist je Anlageklasse',
    tool: 'get_saa_gap',
    art: 'tabelle',
    args: nurRef,
    hinweis: 'Alle Anteile sind Brüche von 0 bis 1. «keine Vorgabe» heisst: dieses Portfolio hat '
      + 'überhaupt kein Zielband, nicht Ziel null.',
  },
  {
    titel: 'Positionen',
    tool: 'get_positions_top',
    art: 'tabelle',
    // 25 statt der üblichen 10: hier wird gelesen und nicht telefoniert, der Kontext ist egal.
    args: (ref) => ({ client_ref: ref, limit: 25 }),
    hinweis: 'Grösste zuerst, Wertschriften und Konten gemischt. Bei Kryptokonten steht in '
      + 'waehrung ein Ticker, der Betrag ist trotzdem Geld in Portfoliowährung.',
  },
  {
    titel: 'Verstösse',
    tool: 'get_violations',
    art: 'tabelle',
    args: nurRef,
    hinweis: 'Eine Zeile je Regel, Fehler vor Warnungen. Individuell ausgesetzte Regeln fehlen '
      + 'hier bewusst -- sie stehen unten im Kundensatz unter IndividualRuleOverrides.',
  },
  {
    titel: 'Anlagevorschläge',
    tool: 'get_open_proposals',
    art: 'tabelle',
    args: nurRef,
    hinweis: 'Alles ausser «Abgelehnt». Status «Final» ohne uebermittelt_am heisst: wartet auf die '
      + 'Zustimmung des Kunden.',
  },
  {
    titel: 'Beraternotizen',
    tool: 'get_recent_notes',
    art: 'tabelle',
    args: (ref) => ({ client_ref: ref, limit: 10 }),
  },
]

/** Eine Zelle als Text. Leer bleibt leer, Zahlen bleiben roh, Objekte werden JSON. */
function alsText(wert: unknown): string {
  if (wert === null || wert === undefined) return ''
  if (typeof wert === 'string') return wert
  if (typeof wert === 'number' || typeof wert === 'boolean') return String(wert)
  try {
    return JSON.stringify(wert)
  } catch {
    return String(wert)
  }
}

/**
 * Die Spalten einer Antwort. Die erste Zeile gibt die Reihenfolge vor -- das ist die
 * Reihenfolge im SELECT und damit die, die der Leser erwartet. Spätere Zeilen können in den
 * Daten zusätzliche Schlüssel tragen; die kommen hinten dran, statt unterzugehen.
 */
function spaltenVon(zeilen: ToolRow[], weglassen: string[] = []): string[] {
  const spalten: string[] = []
  for (const zeile of zeilen) {
    for (const schluessel of Object.keys(zeile ?? {})) {
      if (weglassen.includes(schluessel)) continue
      if (!spalten.includes(schluessel)) spalten.push(schluessel)
    }
  }
  return spalten
}

const zeilenVon = (zeilen: ToolRow[], spalten: string[]): string[][] =>
  zeilen.map((zeile) => spalten.map((s) => alsText(zeile?.[s])))

/**
 * Liest das Dossier eines Kunden aus der Datenbank. Wirft nicht: ein ausgefallenes Werkzeug
 * wird zum Abschnitt mit `fehler`, und `vollstaendig` sagt, ob alles durchgekommen ist.
 *
 * Bewusst der unbeobachtete Toolbox-Zugang: das hier ist eine Ansicht und keine Arbeit des
 * Agenten, die Aufrufe gehören deshalb nicht in die Agentenspur des Gesprächs.
 */
export async function ladeDossier(client: ToolboxClient, clientRef: string): Promise<Dossier> {
  const ref = (clientRef ?? '').trim()
  const stand = new Date().toISOString()
  if (!ref) {
    return { clientRef: '', name: '', stand, vollstaendig: false, abschnitte: [] }
  }

  // Alle Werkzeuge gleichzeitig: es ist eine lokale SQLite-Datei, und der Berater soll die
  // Ansicht nicht siebenmal hintereinander abwarten.
  const ergebnisse = await Promise.all(PLAN.map(async (schritt) => {
    const args = schritt.args(ref)
    const quelle = sourceKey(schritt.tool, args)
    try {
      return { schritt, quelle, zeilen: await client.invoke(schritt.tool, args), fehler: undefined as string | undefined }
    } catch (e) {
      return { schritt, quelle, zeilen: [] as ToolRow[], fehler: e instanceof Error ? e.message : String(e) }
    }
  }))

  const abschnitte: DossierAbschnitt[] = []
  let vollstaendig = true
  let name = ''
  let freitext = ''
  let kundensatz: unknown = null

  for (const { schritt, quelle, zeilen, fehler } of ergebnisse) {
    if (fehler) vollstaendig = false

    // Aus den Stammdaten kommen drei Dinge, die eigene Abschnitte verdienen: der Name für die
    // Überschrift, der Freitext (dort hängt der Copilot seine Gesprächsnotizen an) und der
    // Kundensatz als Rohobjekt.
    let weglassen: string[] = []
    if (schritt.tool === 'get_client_overview') {
      const satz = zeilen[0] ?? {}
      name = alsText(satz.name)
      freitext = alsText(satz.beschreibung)
      kundensatz = satz.profil ?? null
      weglassen = ['beschreibung', 'profil']
    }

    const spalten = spaltenVon(zeilen, weglassen)
    abschnitte.push({
      titel: schritt.titel,
      quelle,
      art: schritt.art,
      spalten,
      zeilen: zeilenVon(zeilen, spalten),
      hinweis: schritt.hinweis,
      fehler,
    })

    // Freitext und Kundensatz stammen aus derselben Antwort. Ist sie ausgefallen, waeren die
    // beiden Abschnitte nur leere Kaesten neben einer Fehlermeldung -- dann lieber gar keine.
    if (schritt.tool === 'get_client_overview' && !fehler) {
      abschnitte.push({
        titel: 'Freitext im Dossier',
        quelle: `${quelle} · Spalte beschreibung`,
        art: 'text',
        text: freitext,
        hinweis: 'Startwert aus dem Feld Description der Quelldatei. Nach jedem Anruf hängt der '
          + 'Copilot seine Zusammenfassung hier an, und beim nächsten Anruf liest er sie wieder mit.',
      })
      if (kundensatz) {
        abschnitte.push({
          titel: 'Kundensatz aus der Quelldatei',
          quelle: `${quelle} · Spalte profil (clients.raw_json)`,
          art: 'json',
          text: JSON.stringify(kundensatz, null, 2),
          hinweis: 'Das unveränderte Quellobjekt, ohne Portfolios, Vorschläge, Transaktionen, '
            + 'Verstösse und Notizen -- die haben eigene Tabellen und stehen oben. Hier stehen '
            + 'Tags und IndividualRuleOverrides, also auch die für diesen Kunden ausgesetzten Regeln.',
        })
      }
    }
  }

  return { clientRef: ref, name: name || ref, stand, abschnitte, vollstaendig }
}
