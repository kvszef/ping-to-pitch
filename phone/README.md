# phone – Telefonnummer mit Live-Transkript und Copilot

Eine echte Telefonnummer, die den Anruf annimmt, **schweigt** und alles Gesprochene live
mitschreibt. Darauf sitzt ein Copilot: Er erkennt an der Anrufernummer, wer anruft, holt über
**MCP Toolbox** die Kundendaten und blendet dem Berater während des Gesprächs Antwortvorschläge,
Fakten und nächste Schritte ein.

```
Handy ──PSTN──▶ gratis Vapi-Nummer ──▶ Assistent (schweigt)
                                          │
                                          ├─ POST /llm    ← Vapi fragt nach einer Antwort, bekommt eine leere
                                          └─ POST /vapi   ← Transkript-Ereignisse, live
                                                   │
                                                   ├──▶ Copilot: Nummer ▶ Kunde ▶ Briefing ▶ Vorschläge
                                                   │         │
                                                   │         └──▶ MCP Toolbox ──▶ SQLite (Case-Daten)
                                                   │
                                                   └──▶ GET /events (SSE) ──▶ Browser
```

Vapi transkribiert selbst und schickt fertige Sätze per Webhook. Dieser Dienst muss deshalb
**kein Audio anfassen** – kein μ-law, kein Resampling, keine Streams. Node führt das TypeScript
direkt aus; einzige Laufzeit-Abhängigkeit ist das Anthropic-SDK für den Copiloten.

## Was nur du selbst erledigen kannst

1. **Vapi-Konto** auf [vapi.ai](https://vapi.ai) anlegen. Keine Kreditkarte, Startguthaben inklusive.
2. **Gratis Nummer beanspruchen:** Dashboard → *Phone Numbers* → *Create a Phone Number* →
   **Free Vapi Number**, US-Vorwahl eingeben. Vapi-eigene Telefonie kostet $0.00/Min.
3. **API-Key holen:** Dashboard → *Settings* → *API Keys* → der **private** Schlüssel.
4. **Tunnel-Werkzeug**, damit Vapi den lokalen Dienst erreicht:
   `winget install --id Cloudflare.cloudflared` (danach neues Terminal öffnen).

> **Die gratis Nummer kann nur Anrufe empfangen.** Ausgehende Anrufe sind mit ihr nicht möglich.
> Wer aus der App heraus anrufen will, braucht einen anderen Anbieter – siehe *Grenzen* unten.

## Schnellstart

```bash
cd phone
cp .env.example .env          # VAPI_API_KEY eintragen

npm run dev                   # Terminal 1: Dienst auf http://localhost:3100
cloudflared tunnel --url http://localhost:3100   # Terminal 2: gibt eine https-URL aus
# die https-URL als PUBLIC_URL in .env eintragen
npm run setup                 # Terminal 3: Assistent anlegen und an die Nummer hängen
```

`npm run setup` gibt am Ende `☎ Jetzt anrufen: +1 …` aus.

**Die Tunnel-URL ändert sich bei jedem Start von cloudflared.** Nach jedem Neustart also
`PUBLIC_URL` in der `.env` aktualisieren und `npm run setup` erneut laufen lassen – sonst
zeigt der Assistent bei Vapi noch auf den alten Tunnel und es kommt nichts an.

## Ohne Telefon testen

```bash
npm run dev
npm run simulate
```

Der Simulator schickt echte Vapi-Nutzlasten gegen `/vapi`: ein Gespräch in wachsenden
Bruchstücken, genau so wie Vapi es liefert. Damit ist die ganze Kette Webhook → SSE → Anzeige
prüfbar, **bevor ein Anruf Guthaben kostet**. Am Demo-Tag trennt das in Sekunden, ob die
Telefonie klemmt oder die eigene Verarbeitung.

## So sieht die Demo aus

Weil der Assistent schweigt, ist die Leitung eine **Mithörleitung, kein Sprechkanal**: wer
anruft, hört nichts zurück. Der Aufbau ist deshalb **ein Handy auf Lautsprecher**:

1. Der «Kunde» wählt die Nummer, legt das Handy auf den Tisch, Lautsprecher an.
2. Der Berater sitzt am Laptop mit der App daneben.
3. Beide sprechen ins selbe Handy, das Transkript läuft live mit.

## Konfiguration (`.env`)

| Variable | Bedeutung |
| --- | --- |
| `VAPI_API_KEY` | Privater Schlüssel aus dem Vapi-Dashboard. |
| `PUBLIC_URL` | Öffentliche https-URL dieses Dienstes, ohne Schrägstrich am Ende. Kommt vom Tunnel. |
| `PORT` | Lokaler Port, Standard `3100`. |
| `LANGUAGE` | Deepgram-Sprachcode für die Erkennung, Standard `de`. |
| `GREETING` | Ansage beim Abheben. Leer lassen, damit der Assistent von der ersten Sekunde an schweigt. |
| `VAPI_PHONE_NUMBER` | Nur nötig, wenn mehrere Nummern im Konto liegen. Sonst wird die erste genommen. |

## Der Copilot

Der Berater hat während des Gesprächs eine Seite offen, die mitliest und hilft. Was dafür nötig
war, ist genau das, was Vapi **nicht** liefert: wer anruft, was dieser Kunde besitzt, und was man
ihm gerade antworten sollte.

**Kundendaten über MCP Toolbox.** Die Case-Daten (`../core-case/portfolio-data/`) werden einmalig in
eine lokale SQLite-Datei geladen. [MCP Toolbox](https://mcp-toolbox.dev) macht daraus neun
benannte, lesende Werkzeuge, die das Sprachmodell selbst aufruft – von `find_client_by_phone` über
`get_saa_gap` bis `get_recent_notes`. Der Vorteil gegenüber selbstgebauten Abfragen: die Werkzeuge
sind ohne eine Zeile Anwendungscode prüfbar, über `http://127.0.0.1:5000/ui` oder direkt in Claude
Code.

```bash
npm install             # einmalig, zieht das Anthropic-SDK
npm run toolbox:get     # Binary nach bin/ laden, einmalig
npm run load-data       # data/unrisk.db aus den Case-Daten bauen
npm run toolbox         # Toolbox auf 127.0.0.1:5000 (eigenes Terminal)
```

**Dieselbe Datenbank versorgt auch die App.** Neben `call_copilot` liegt das Toolset `app_data`
mit neun parameterlosen Werkzeugen, die die Rohobjekte liefern statt aufbereiteter Sichten:
`app_clients` bis `app_notes` die sieben Sammlungen des Kundensatzes, `app_reference` die ganze
`reference.json` aus der Tabelle `reference_sets`. `app/server/database.ts` setzt daraus die
Kundensätze in der Form von `clients.json` zusammen, die die Engine erwartet. Getrennte Toolsets,
weil diese Werkzeuge nie in den Kontext des Sprachmodells gehören: sie liefern ganze Lieferungen,
und `app_accounts` trägt Kontonamen und IBANs.

**Der Copilot läuft auf beiden Telefoniewegen.** Jede Transkriptzeile kommt in
[src/live.ts](src/live.ts) an, gleich ob über Vapi oder über die Sprechbrücke; dort hängt der
Copilot. Ein weiterer Telefonieweg muss davon nichts wissen, er schreibt einfach wie die anderen
in `live.ts`. Die Beraterseite liegt in beiden Fällen unter `/`, die schlichte Telefonieseite
unter `/pruefstand`.

Ein Unterschied bleibt und ist sichtbar: Die Brücke trennt die Sprecher über die Audiospur und
weiss deshalb wirklich, wer spricht. Vapi liefert alles als eine Rolle, weil beide in dasselbe
Handy sprechen; dort bestimmt [src/copilot/roles.ts](src/copilot/roles.ts) die Rolle aus dem
Inhalt. Bleibt sie unklar, zeigt die Oberfläche das neutral an und der Copilot hilft trotzdem.

Startreihenfolge für die Demo:

```bash
npm run toolbox         # Terminal 1: Kundendaten
npm run bridge          # Terminal 2: Sprechbrücke (oder npm run dev für den Vapi-Weg)
cloudflared tunnel --url http://localhost:3200    # Terminal 3
npm run twilio          # Terminal 4: Nummer kaufen und Webhook setzen
```

**Die Anrufernummer muss zugeordnet werden.** Die 47 Case-Kunden enthalten keine Telefonnummern.
Deshalb legst du `data/callers.json` an; sie ist der einzige bewusst gemockte Teil der Datenkette:

```json
{ "+41791234567": "CASE-038" }
```

`CASE-038` (Charlie Brown) ist ein guter Demo-Kunde: Fremdwährungs-Klumpenrisiko in USD und EUR,
starkes Untergewicht Schweizer Aktien, dazu Notizen zu nachhaltigen Fonds und zum
Benchmark-Vergleich. Das dazu passende Gespräch liegt als
[fixtures/call-case-038.jsonl](fixtures/call-case-038.jsonl).

**Woran der Copilot sich hält.** Jede Aussage stammt aus einem Werkzeug und trägt ihre Quelle.
Tragen die Daten eine Aussage nicht, sagt er das, statt zu raten. Er gibt keine verbindliche
Anlageempfehlung ab und nennt keine IBANs. Ausgaben sind Deutsch in Schweizer Schreibweise.

**Ohne Modell und ohne Guthaben:** `MOCK_BRAIN=1` in der `.env` liefert feste, plausible Antworten
aus den Werkzeugdaten. Zusammen mit `npm run simulate` ist die ganze Kette damit jederzeit
vorführbar – auch am Demo-Tag ohne Netz.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| [src/server.ts](src/server.ts) | Die Routen. `/vapi` nimmt die Ereignisse, `/llm` antwortet leer, `/events` verteilt, `/` zeigt an. |
| [src/live.ts](src/live.ts) | Laufendes Transkript und SSE-Verteilung. Vorläufige Zeilen ersetzen einander, statt sich zu stapeln. |
| [src/assistant.ts](src/assistant.ts) | Legt den Assistenten bei Vapi an bzw. aktualisiert ihn und hängt ihn an die Nummer. |
| [src/page.ts](src/page.ts) | Die Prüfstand-Seite für die Telefonie allein. |
| [src/simulate.ts](src/simulate.ts) | Gespräch ohne Telefon. |
| [src/copilot/events.ts](src/copilot/events.ts) | Der Ereignisvertrag. Alle Teile sprechen nur darüber miteinander. |
| [src/copilot/types.ts](src/copilot/types.ts) | Die Schnittstellen zwischen den Bausteinen, inklusive der neun Werkzeugnamen. |
| [src/copilot/bus.ts](src/copilot/bus.ts) | Gesprächszustand und Verteilung an die Browser, mit Nachreichen des Verlaufs. |
| [toolbox/schema.sql](toolbox/schema.sql) | Das SQLite-Schema für `clients.json` und `reference.json`. |
| [toolbox/tools.yaml](toolbox/tools.yaml) | Quelle, die Werkzeuge und die Toolsets `call_copilot`, `app_data`, `dev` und `write`. |
| [scripts/load-data.ts](scripts/load-data.ts) | Baut `data/unrisk.db`, idempotent. |

## Warum der Assistent schweigt

Vapi ist für **sprechende** Agenten gebaut. Damit einer nur mithört, zeigt sein Sprachmodell
nicht auf OpenAI, sondern über `model.provider: 'custom-llm'` auf `/llm` in diesem Dienst –
und der antwortet auf jede Anfrage mit leerem Inhalt. Nebeneffekt: die LLM-Kosten fallen auf null.

Die Antwort muss sofort kommen; Vapi bricht nach 7,5 Sekunden ab. `/llm` beantwortet daher
ohne jede Verarbeitung, streamend wie nicht-streamend.

## Grenzen

- **Nur eingehend.** Die gratis Vapi-Nummer kann keine Anrufe tätigen, und der Warm Transfer,
  mit dem man den Berater in ein laufendes Gespräch holen könnte, verlangt Twilio-Telefonie
  darunter. Wer ausgehend anrufen oder eine echte Brücke auf ein zweites Handy will, nimmt
  Plivo: $10 Startguthaben ohne Kreditkarte, und `<Stream>` legt das rohe Audio beidseitig auf
  einen WebSocket – dann aber mit eigener Transkription und deutlich mehr Code.
- **Keine Sprechertrennung.** Beide Personen sprechen in dasselbe Handy, also trägt jede Zeile
  `role: "user"`. Die Rollen Kunde/Berater ordnet das Modell in `/api/analyse` zu – das tut es
  für die Mikrofon-Quelle heute schon.
- **Guthaben.** Rund $0.06/Min (Plattform + Deepgram), Telefonie $0.00. Jeder Testanruf zählt
  mit, deshalb `npm run simulate` für alles, was sich ohne Telefon prüfen lässt.

## Stolpersteine

- **Es kommt nichts an:** Tunnel neu gestartet, ohne `npm run setup` nachzuziehen. Der Assistent
  zeigt dann noch auf die alte URL. `PUBLIC_URL` prüfen, `npm run setup` erneut laufen lassen.
- **Der Assistent redet:** `GREETING` in der `.env` leeren und `npm run setup` erneut ausführen.
- **Die Ansage klingt falsch betont:** Vapi nimmt ohne Angabe eine Standardstimme. Im Dashboard
  eine deutschsprachige Stimme wählen oder `GREETING` leeren.
- **Der Anruf bricht in einer Sprechpause ab:** `silenceTimeoutSeconds` in
  [src/assistant.ts](src/assistant.ts) erhöhen, dann `npm run setup`.
