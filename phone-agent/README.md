# phone-agent – Live-Call-Copilot

Der Berater telefoniert selbst. Die KI geht **nicht** ans Telefon, sondern hört mit: Sie erkennt am
Anruf, wer anruft, holt über [MCP Toolbox for Databases](https://mcp-toolbox.dev) die passenden
Kundendaten und blendet während des Gesprächs Antwortvorschläge, Fakten und nächste Schritte ein.

Das ergänzt den UNRISKOMEGA-Case um den Bonus «Interactive Follow-Up Assistant … useful during a live
client conversation without disrupting the interaction» (siehe `../task.md`).

Alles liegt in diesem Ordner. Ausserhalb wird nichts verändert; `../app/` und `../core-case/` werden nur gelesen.

---

## Aufbau

```
  Kunde (Telefon)                      Berater (Browser: web/)
        |                                    |
        |   << Telefonie, siehe "Drei Andockpunkte" >>
        v                                    v
  +--------------------------------------------------+
  |  Transport (LiveKit-Raum | Twilio Voice | SIP)    |
  |  liefert: Anrufernummer + zwei Audiospuren        |
  +--------------------------------------------------+
                                             |
                 lokaler Mic-Track (Berater)  | Remote-Track (Kunde)
                                             v
                                    AudioWorklet -> PCM16 16 kHz
                                             |
                          ws://localhost:4000/stt?role=advisor|caller
                                             v
  +--------------------------------------------------------------+
  |  server/   (Node + TypeScript, ein Prozess)                   |
  |    stt/        ElevenLabs | OpenAI | Deepgram | mock          |
  |    bus.ts      Ereignisbus je callId, Verlauf, Wiedergabe     |
  |    identify.ts E.164 -> find_client_by_phone                  |
  |    brain/      Claude: Briefing, Live-Hinweise, Rueckfrage    |
  |    /events     Ereignisse an die Oberflaeche                  |
  +--------------------------------------------------------------+
                        |  @toolbox-sdk/core
                        v
  +--------------------------------------------------------------+
  |  MCP Toolbox  127.0.0.1:5000                                  |
  |    Quelle: SQLite data/unrisk.db                              |
  |    Toolset "call_copilot": neun lesende Werkzeuge             |
  +--------------------------------------------------------------+
                        ^
                        |  einmalig: npm run load-data
     ../core-case/portfolio-data/{clients,reference}.json
                        +  data/callers.json (Nummer -> ClientRef)
```

Ablauf eines Anrufs:

1. Der Berater hat die Seite offen und ist erreichbar.
2. Es klingelt. Der Telefonie-Adapter meldet `call.started` mit der Anrufernummer.
3. Der Server löst die Nummer über `find_client_by_phone` auf, ruft die Briefing-Werkzeuge und schickt
   `client.identified` mit dem 60-Sekunden-Briefing. Ziel: unter 2 Sekunden, **während es noch klingelt**.
4. Der Berater nimmt an. Der Browser lädt beide Audiospuren getrennt hoch.
5. Je endgültigem Segment: `transcript.segment`; die gedrosselte Copilot-Schleife erzeugt `suggestion`.
6. Der Berater kann jederzeit tippen, das ergibt `answer` aus denselben Daten.
7. Beim Auflegen: `call.ended`; Transkript und Hinweise landen als JSONL in `data/calls/` und taugen
   direkt als neue Testfixture.

---

## Drei Andockpunkte für die Telefonie

Die Telefonnummer wird parallel gebaut. Der Copilot hängt nicht daran: Es genügt **einer** dieser drei
Wege, und alle drei münden im selben Ereignisvertrag (`contracts/events.ts`).

| Andockpunkt | Was geliefert wird | Beispiel | Was phone-agent dann übernimmt |
| --- | --- | --- | --- |
| **A – MediaStreams im Browser** (bevorzugt) | `{ callId, from, localStream, remoteStream }` über `BrowserTransport` aus `contracts/telephony.ts` | `livekit-client` (`RemoteAudioTrack.mediaStreamTrack`), Twilio Voice SDK (`call.getLocalStream()` / `getRemoteStream()`) | alles: Upload, Erkennung, STT, Hinweise |
| **B – Audio am Server** | WebSocket-Frames pro Spur an `/stt?callId=..&role=caller\|advisor` | Twilio Media Streams `<Start><Stream track="both_tracks">` | STT, Erkennung, Hinweise |
| **C – fertiges Transkript** | HTTP `POST /call` mit `CallEvent`-Objekten | Twilio `<Start><Transcription track="both_tracks" statusCallbackUrl=…>` | Erkennung, Hinweise |

Von uns braucht die Telefonie-Seite nur zwei Dinge: die Anrufernummer in **E.164** und eine stabile `callId`.

Bis der echte Transport steht, liefert `TELEPHONY=sim` genau dieselben Ereignisse aus einer Fixture.

---

## Loslegen

```bash
cd phone-agent
npm install
copy .env.example .env         # ANTHROPIC_API_KEY eintragen, Rest kann erst mal stehen bleiben

npm run toolbox:get            # laedt das MCP-Toolbox-Binary nach bin/
npm run load-data              # baut data/unrisk.db aus den Case-Daten
npm run toolbox                # MCP Toolbox auf 127.0.0.1:5000 (eigenes Terminal)
npm run dev                    # Server auf :4000            (eigenes Terminal)
npm run web                    # Oberflaeche auf :5173       (eigenes Terminal)

npm run simulate -- --fixture call-case-004    # Gespraech ohne Telefon abspielen
```

Vorher anlegen: `data/callers.json` mit der eigenen Nummer, zum Beispiel

```json
{ "+41791234567": "CASE-004" }
```

Die 47 Kunden im Case enthalten **keine** Telefonnummern. Diese Datei ist deshalb der einzige bewusst
gemockte Teil der Datenkette und wird beim Laden in die Tabelle `phone_map` überführt.

Die Werkzeuge lassen sich auch ohne App testen: `npm run toolbox` starten, dann
`http://127.0.0.1:5000/ui` öffnen oder Claude Code anhängen mit
`claude mcp add --transport http unrisk --scope project http://127.0.0.1:5000/mcp/call_copilot`.

---

## Verträge

`contracts/events.ts` ist die einzige Wahrheit. Alle Teile sprechen nur darüber miteinander:

| Ereignis | Wer erzeugt es | Wofür |
| --- | --- | --- |
| `call.started` | Telefonie-Adapter | Anruf beginnt, mit Anrufernummer |
| `client.identified` | `server/identify.ts` und `brain/briefing.ts` | Kunde erkannt, Briefing dabei |
| `transcript.segment` | STT-Schicht oder Andockpunkt C | ein Stück Gespräch, je Sprecher |
| `suggestion` | `brain/live.ts` | Antwortvorschlag, Fakt, nächster Schritt, Warnung |
| `answer` | `brain/ask.ts` | Antwort auf eine getippte Frage |
| `call.ended` | Telefonie-Adapter | Gespräch vorbei |
| `status` | alle | Diagnose für die Oberfläche, nie gesprächsrelevant |

`contracts/telephony.ts` beschreibt die Adapter, `toolbox/schema.sql` die Datenbank.

---

## Regeln für alle Beiträge

- **Belegpflicht.** Jede Aussage des Copiloten stammt aus einem Toolbox-Werkzeug. `sources` trägt
  Werkzeugnamen und Zeilenschlüssel. Decken die Daten die Frage nicht, ist `supported: false` und der
  Text sagt kurz, was fehlt. Keine erfundenen Zahlen, keine Vermutungen.
- **Keine Anlageempfehlung.** Der Copilot erklärt, was die Daten zeigen, und schlägt Gesprächsschritte
  vor. Er gibt keine verbindliche Empfehlung ab und nennt keine IBANs.
- **Deutsch, Schweizer Schreibweise** (ss statt ß), Sie-Form gegenüber dem Kunden.
- **Datenkonventionen** aus `../core-case/portfolio-data/DATA.md`: Join über `SecurityId` statt `Isin`,
  `SAA_*`-Felder für Soll-Ist-Vergleiche, Prozente sind Brüche von 0 bis 1 (Ausnahme
  `FundUnbundlingMappings[].Weight`: 0 bis 100), fehlende Felder sind abwesend statt `null`,
  Konto-`Currency` kann ein Ticker wie `BTC` sein.
- **Latenzbudget**: STT-Endsegment bis 1 s, Hinweis bis 2 s. Mittel: `EFFORT=low`, kleines
  `max_tokens`, Prompt-Caching auf Systemprompt und Briefing, höchstens ein Modellaufruf alle 2 s,
  laufende Anfrage bei neuem Segment abbrechen.
- **Sicherheit**: Toolbox bindet auf `127.0.0.1`, im Toolset `call_copilot` stehen nur lesende
  Werkzeuge, `data/` ist gitignoriert.

---

## Arbeitspakete

Jedes Paket hat eigene Dateien und eigene Tests, es gibt keine Überschneidungen.

| AP | Ziel | Eigene Dateien |
| --- | --- | --- |
| AP1 | Ereignisbus und Server-Gerüst (`/events`, `/stt`, `/call`, `/health`) | `server/index.ts`, `server/bus.ts` |
| AP2 | Browser-Audio: beide MediaStreams, AudioWorklet, Upload | `web/src/call/*`, `web/src/worklets/pcm16.js` |
| AP3 | STT-Schicht mit austauschbaren Anbietern | `server/stt/*` |
| AP4 | Datenlader JSON nach SQLite | `scripts/load-data.ts` |
| AP5 | Toolbox-Werkzeuge und Binary-Skript | `toolbox/tools.yaml`, `scripts/get-toolbox.ts`, `scripts/run-toolbox.ts` |
| AP6 | Copilot-Hirn: Briefing, Live-Hinweise, Rückfrage | `server/brain/*`, `server/toolbox.ts`, `server/identify.ts` |
| AP7 | Oberfläche: Klingel-Karte, Briefing, Transkript, Vorschläge | `web/src/ui/*`, `web/src/App.tsx` |
| AP8 | Telefonie-Adapter und Simulator | `server/telephony/*`, `scripts/simulate-call.ts` |
| AP9 | Betrieb: Skripte, Demo-Drehbuch, zweiter Laptop | dieses README, `package.json` |

Wiederverwendet statt neu gebaut: MCP Toolbox samt `@toolbox-sdk/core`, Deepgrams Muster «eine
STT-Verbindung je Spur», das Abonnentenmuster «WebSocket je callId» aus den Deepgram-Twilio-Beispielen,
LiveKits STT-only-Rezept, sowie aus diesem Repo die Twilio-Skripte und die Kennzahlenlogik aus der
Git-History (`git show 16bdd34:PhoneAgent/...`) und die Anzeigemuster aus `../app/src/workspace/`.
