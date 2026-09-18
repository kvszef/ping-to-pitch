# PhoneAgent – Schweizer Telefonnummer mit KI-Kundenberatung

Ein Anrufer wählt eine Schweizer Nummer, ein KI-Assistent nimmt ab, identifiziert den Kunden und
beantwortet Fragen zu Vermögen, Portfolio, Anlagestrategie, Richtlinien-Verstössen und offenen
Anlagevorschlägen aus den Case-Daten in [core-case/portfolio-data](../core-case/portfolio-data/).

```
Anruf → Twilio-Nummer (+41 …) → ConversationRelay (Spracherkennung + Sprachausgabe)
      → WebSocket (Text) → dieser Server (Node) → Claude (Anthropic API) → Text zurück → Stimme
```

## Was nur du selbst erledigen kannst

Nummern, Konten und Identitätsprüfung lassen sich nicht aus dem Code heraus anlegen. Einmalig nötig:

1. **Twilio-Konto** auf [twilio.com/try-twilio](https://www.twilio.com/try-twilio) anlegen und mit Guthaben
   aufladen (ca. 20 USD reichen für den Hackathon). Ein Trial-Konto nimmt nur Anrufe von verifizierten
   Nummern an und spielt vor jedem Gespräch eine Trial-Ansage ab.
2. **Schweizer Nummer freischalten (Regulatory Bundle).** Twilio verkauft in der Schweiz Lokalnummern
   (z. B. 071 St. Gallen, 044 Zürich, 031 Bern) mit Sprachfunktion. Schweizer Mobilnummern bei Twilio
   können nur SMS, keine Anrufe. Für eine Lokalnummer verlangt die Regulierung:
   - Twilio Console → *Phone Numbers* → *Regulatory Compliance* → *Bundles* → *Create*: Land Switzerland,
     Typ *Local*, Endnutzer Privatperson (Pass oder ID) oder Firma (Handelsregisterauszug).
   - Einen Adressnachweis. Die Adresse muss in der Region der gewünschten Vorwahl liegen, ein Postfach
     reicht nicht. Die Adresse zusätzlich unter *Regulatory Compliance* → *Addresses* anlegen.
   - Die Prüfung dauert bis zu zwei Werktage. **Also sofort einreichen.**
   - Danach `npm run numbers -- --bundles` ausführen: zeigt die SIDs von Bundle und Adresse für die `.env`.

   **Ohne Wartezeit:** eine US-Nummer braucht kein Bundle und ist sofort da
   (`npm run numbers -- --country US --buy`). Vom Schweizer Handy per +1 erreichbar, zum Auslandtarif.
   Sobald das Schweizer Bundle genehmigt ist, die +41-Nummer kaufen und in der `.env` tauschen.
3. **Anthropic API-Key** aus [console.anthropic.com](https://console.anthropic.com/).
4. **Tunnel-Tool**, damit Twilio den lokalen Server erreicht: `winget install --id Cloudflare.cloudflared`
   (danach neues Terminal öffnen). Alternativ ngrok.

## Schnellstart

```bash
cd PhoneAgent
npm install
copy .env.example .env          # und ausfüllen: Anthropic-Key, Twilio SID/Token, Bundle- und Adress-SID

npm run numbers -- --area-code 71            # freie 071-Nummern anzeigen (Vorwahl anpassen)
npm run numbers -- --buy --number +41715…    # kaufen, dann TWILIO_PHONE_NUMBER in .env eintragen

npm run up                                   # Tunnel + Server starten, Webhook bei Twilio setzen
```

`npm run up` gibt am Ende `☎ Jetzt anrufen: +41 …` aus. Die Tunnel-URL ändert sich bei jedem Start,
der Webhook wird jedes Mal automatisch neu gesetzt. Wer den Server lieber getrennt startet:
`npm start` in einem Terminal, `npm run tunnel` im zweiten.

## Ohne Telefon testen

Der Simulator spricht das Twilio-Protokoll gegen den lokalen Server, Tippen ersetzt Sprechen:

```bash
npm start
npm run call                                                   # interaktiv, /bye legt auf
npm run call -- --say "Ich bin Yoda" --say "Wie steht mein Portfolio?"
npm run call -- --client CASE-004                              # Anrufer schon identifiziert
```

`MOCK_LLM=1` in der `.env` liefert feste Antworten ohne API-Key, um Twilio-Anbindung und
WebSocket zu prüfen. Laufende und vergangene Gespräche mit Transkript: `http://localhost:3000/calls`.

## Wie der Agent den Kunden erkennt

- **Anrufernummer:** `callers.example.json` nach `callers.json` kopieren und die eigene Handynummer
  (E.164, z. B. `+41791234567`) einer Kundennummer zuordnen. Der Anrufer wird dann mit Namen begrüsst
  und die Daten sind sofort geladen. Die Datei ist per `.gitignore` ausgeschlossen.
- **Vorauswahl für Demos:** `DEFAULT_CLIENT_REF=CASE-004` in der `.env` gilt für alle unbekannten Anrufer.
- **Im Gespräch:** Ohne Zuordnung fragt der Assistent nach dem Namen oder der Kundennummer und lädt den
  Kunden über das Werkzeug `select_client` (Kundenliste aus `clients.json`, z. B. «Ich bin Rocky Balboa»).

Der Assistent sieht pro Kunde eine kompakte Zusammenfassung: Vermögen, Risikoprofil, je Portfolio
Kennzahlen, Ist-Allokation gegen die Strategie (SAA), Währungen, grösste Positionen, Konten ohne IBAN,
Verstösse gegen Anlagerichtlinien, Anlagevorschläge, Transaktionen und Beraternotizen
(siehe [src/data.ts](src/data.ts)). Er gibt keine verbindlichen Anlageempfehlungen und bietet stattdessen
einen Rückruf des Beraters an. Neue Kundendateien im gleichen Format: `CLIENTS_JSON=a.json,b.json`.

## Konfiguration (`.env`)

| Variable | Bedeutung |
| --- | --- |
| `ANTHROPIC_API_KEY` | API-Key. `MODEL` (Standard `claude-opus-5`) und `EFFORT` (`low` für kurze Antwortzeiten) steuern das Modell. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Zugangsdaten aus der Twilio Console. Mit Token werden Webhook-Signaturen geprüft. |
| `TWILIO_PHONE_NUMBER` | Die gekaufte Nummer in E.164. `npm run up` und `npm run webhook` setzen ihren Voice-Webhook. |
| `TWILIO_BUNDLE_SID`, `TWILIO_ADDRESS_SID` | Nur zum Kauf einer Schweizer Nummer nötig. |
| `PUBLIC_URL` | Öffentliche https-URL des Servers. `npm run up` setzt sie automatisch; sonst wird der Host-Header des Tunnels verwendet. |
| `CALL_LANGUAGE` | Sprache für Erkennung und Ausgabe, Standard `de-DE`. `TRANSCRIPTION_LANGUAGE=de-CH` versucht Schweizer Erkennung (Google), `TTS_LANGUAGE` bleibt `de-DE`. |
| `TTS_PROVIDER`, `TTS_VOICE`, `TRANSCRIPTION_PROVIDER`, `SPEECH_MODEL` | Stimme und Erkennung bei Twilio (Google, Amazon, ElevenLabs bzw. Google, Deepgram). Leer = Twilio-Standard. |
| `WELCOME_GREETING`, `WELCOME_GREETING_KNOWN` | Begrüssung für unbekannte bzw. erkannte Anrufer (`{name}` wird ersetzt). |
| `DEFAULT_CLIENT_REF`, `CALLERS_JSON`, `CLIENTS_JSON`, `REFERENCE_JSON` | Kundenzuordnung und Datenpfade. |

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| [src/server.ts](src/server.ts) | HTTP `/twiml` (Twilio holt das TwiML), WebSocket `/ws` (ConversationRelay), `/calls`, `/health`. Verwaltet Gespräche, Unterbrechungen, Signaturprüfung. |
| [src/agent.ts](src/agent.ts) | Gesprächslogik mit Claude: Systemprompt, Streaming der Antwort-Token, Werkzeug `select_client`, Abbruch bei Unterbrechung. |
| [src/data.ts](src/data.ts) | Lädt `clients.json` und `reference.json`, findet Kunden per Name/Nummer, erzeugt die Zusammenfassung. |
| [src/twiml.ts](src/twiml.ts) | Baut `<Connect><ConversationRelay …/>` mit Sprache, Stimme und Begrüssung. |
| [scripts/buy-number.ts](scripts/buy-number.ts) | Nummern suchen und kaufen, Bundles und Adressen anzeigen. |
| [scripts/up.ts](scripts/up.ts) | cloudflared-Tunnel + Server starten, Webhook setzen. |
| [scripts/set-webhook.ts](scripts/set-webhook.ts) | Webhook der Nummer auf eine beliebige URL setzen (z. B. ngrok). |
| [scripts/simulate-call.ts](scripts/simulate-call.ts) | Anruf im Terminal simulieren. |

## Stolpersteine

- **403 «invalid twilio signature»:** Twilio signiert die exakte Webhook-URL. `PUBLIC_URL` muss der bei
  Twilio hinterlegten URL entsprechen (`npm run up` erledigt beides). Zum Eingrenzen `TWILIO_VALIDATE=0`.
- **Anruf wird abgewiesen:** Trial-Konto. Entweder die eigene Handynummer unter *Verified Caller IDs*
  eintragen oder das Konto aufladen.
- **Nummer klingelt, aber nichts passiert:** Server läuft nicht oder Webhook zeigt auf eine alte Tunnel-URL.
  `npm run up` neu starten oder `npm run webhook -- --url https://…`.
- **Antworten kommen langsam:** `EFFORT=low` und `MAX_TOKENS=1024` lassen; Antworten sind ohnehin auf
  ein bis drei Sätze angelegt. Erster Token und Gesamtdauer stehen pro Antwort im Server-Log.
- **Schweizerdeutsch:** Die Erkennung ist auf Hochdeutsch ausgelegt. Deutlich und in Hochdeutsch sprechen
  hilft mehr als jede Einstellung.
