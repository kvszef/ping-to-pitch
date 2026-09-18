# STT-Benchmark: Welches lokale Modell transkribiert Beratungsgespräche am besten?

Du liest den Text in `script.txt` ins Mikrofon, die Aufnahme wird gespeichert und
anschliessend durch alle Modelle gejagt. Am Ende steht eine Tabelle mit Wortfehlerrate
(WER) und Rechenzeit pro Modell, einmal für das saubere Mikrofon-Audio und einmal für
eine simulierte Telefonleitung (8 kHz, 300 bis 3400 Hz).

Alles läuft lokal auf der CPU, keine GPU und kein API-Key nötig.

## Einmalig

```powershell
cd PhoneAgent\benchmark
uv sync                       # Python-Umgebung
uv run download_models.py     # Vosk (2 GB) und Parakeet (0.7 GB)
```

Die Whisper-Modelle lädt `benchmark.py` beim ersten Lauf selbst von Hugging Face
(tiny bis large-v3 zusammen rund 7 GB). Alles landet unter `models/`.

## Test durchführen

1. `script.txt` öffnen, einmal durchlesen.
2. Aufnahme starten, Text vorlesen, Enter drücken:

   ```powershell
   uv run record.py take1
   ```

   Ergebnis: `recordings/take1.wav` und die Telefon-Variante `recordings/take1.phone.wav`.

3. Benchmark starten:

   ```powershell
   uv run benchmark.py take1
   ```

   Dauert je nach Modellen einige Minuten. Der Bericht liegt danach unter
   `results/take1.md` (Tabelle, Referenztext, alle Transkripte) und `results/take1.json`.

Nur einzelne Modelle: `uv run benchmark.py take1 --models small,turbo,parakeet`
Alle Schlüssel: `uv run benchmark.py --list`

## Modelle

| Schlüssel  | Modell                                  | Grösse | Anmerkung |
|------------|-----------------------------------------|--------|-----------|
| tiny       | faster-whisper tiny, int8               | 75 MB  | schnellster Whisper, für Live-Chunks |
| base       | faster-whisper base, int8               | 145 MB | |
| small      | faster-whisper small, int8              | 480 MB | guter Live-Kompromiss |
| medium     | faster-whisper medium, int8             | 1.5 GB | |
| turbo      | faster-whisper large-v3-turbo, int8     | 1.6 GB | Kandidat für das finale Protokoll |
| large-v3   | faster-whisper large-v3, int8           | 3 GB   | Referenzqualität, langsam |
| vosk-small | Vosk small-de-0.15                      | 45 MB  | echtes Wort-für-Wort-Streaming |
| vosk-de    | Vosk de-0.21                            | 2 GB   | |
| parakeet   | NVIDIA Parakeet TDT 0.6B v3, sherpa-onnx int8 | 0.7 GB | sehr schnell auf CPU, 25 Sprachen |

Cloud-Vergleich optional: sind `OPENAI_API_KEY` oder `DEEPGRAM_API_KEY` gesetzt,
werden gpt-4o-transcribe bzw. Deepgram nova-3 zusätzlich mitgemessen.

## Wie die Genauigkeit gemessen wird

Referenz und Transkript werden vor dem Vergleich normalisiert (`normalize.py`):
Kleinschreibung, Satzzeichen weg, ß zu ss, Zahlen zu Wörtern (`45'000` und
`fünfundvierzigtausend` zählen gleich), `%` zu `prozent`, `14:30 Uhr` zu
`vierzehn uhr dreissig`. WER ist dann der Anteil falscher, fehlender oder
zusätzlicher Wörter. CER dasselbe auf Zeichenebene.

RTF (Real-Time-Faktor) = Rechenzeit / Audiodauer. Unter 1.0 heisst schneller als
Echtzeit, was für Live-Transkription die Voraussetzung ist.

## Für den Use Case relevant

Der Vorlesetext enthält das, woran Modelle in einem Beratungsgespräch scheitern:
Kundennamen, Depotnummer, Prozentsätze, Frankenbeträge, Datum und Uhrzeit,
Produktnamen (Swiss Equity Fonds, Kassenobligation) und Fachbegriffe
(Stempelsteuer, Courtage). Schau dir im Bericht nicht nur die WER an, sondern
welche Fehler passieren. Ein falscher Betrag wiegt schwerer als ein falsches "dass".
