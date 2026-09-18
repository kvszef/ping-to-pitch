# phone – Telefonnummer mit Live-Transkript

Eine echte Telefonnummer, die den Anruf annimmt, **schweigt** und alles Gesprochene live
mitschreibt. Gedacht als Zulieferer für den Gesprächsassistenten in [app/](../app/).

```
Handy ──PSTN──▶ gratis Vapi-Nummer ──▶ Assistent (schweigt)
                                          │
                                          ├─ POST /llm    ← Vapi fragt nach einer Antwort, bekommt eine leere
                                          └─ POST /vapi   ← Transkript-Ereignisse, live
                                                   │
                                                   └──▶ GET /events (SSE) ──▶ Browser
```

Vapi transkribiert selbst und schickt fertige Sätze per Webhook. Dieser Dienst muss deshalb
**kein Audio anfassen** – kein μ-law, kein Resampling, keine Streams. Vier Routen, null
Laufzeit-Abhängigkeiten, Node führt das TypeScript direkt aus.

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

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| [src/server.ts](src/server.ts) | Die vier Routen. `/vapi` nimmt die Ereignisse, `/llm` antwortet leer, `/events` verteilt, `/` zeigt an. |
| [src/live.ts](src/live.ts) | Laufendes Transkript und SSE-Verteilung. Vorläufige Zeilen ersetzen einander, statt sich zu stapeln. |
| [src/assistant.ts](src/assistant.ts) | Legt den Assistenten bei Vapi an bzw. aktualisiert ihn und hängt ihn an die Nummer. |
| [src/page.ts](src/page.ts) | Die Prüfstand-Seite. Für die Jury ist die App unter `app/` zuständig, nicht diese. |
| [src/simulate.ts](src/simulate.ts) | Gespräch ohne Telefon. |

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
