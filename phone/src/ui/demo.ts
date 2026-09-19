// Die Vorführseite: ein aufgezeichneter Anruf, langsam abgespielt, und daneben alles,
// was der Agent dabei tut. Die Inhalte stammen unverändert aus einem echten Durchlauf
// gegen die Case-Daten von CASE-038 mit gpt-5.6-luna; gedehnt ist nur das Tempo, damit
// man mitlesen kann.
//
// Erreichbar unter /demo. Braucht weder Telefon noch Toolbox noch Modell, läuft also
// auch am Demo-Tag ohne Netz.

export const demoPage = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Telefon-Copilot</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Public+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
  :root {
    --paper:      #eef1f0;
    --surface:    #ffffff;
    --surface-2:  #f6f8f7;
    --line:       #d3dad8;
    --line-soft:  #e3e8e6;
    --ink:        #12181c;
    --ink-2:      #47555a;
    --ink-3:      #6f7d82;
    --accent:     #0e6e5c;
    --accent-ink: #0a4e42;
    --live:       #a8801a;
    --risk:       #a3291f;
    --warn:       #8a6410;
    --ok:         #0e6e5c;
    --info:       #3b5b79;
    --shadow:     0 1px 2px rgba(18,24,28,.05), 0 8px 24px -16px rgba(18,24,28,.25);

    --f-display: "Newsreader", Georgia, "Times New Roman", serif;
    --f-body:    "Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --f-mono:    "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper:      #0d1114;
      --surface:    #161c20;
      --surface-2:  #1c2429;
      --line:       #2b353a;
      --line-soft:  #222b30;
      --ink:        #e7ecea;
      --ink-2:      #a3b0b3;
      --ink-3:      #78868a;
      --accent:     #4fb8a1;
      --accent-ink: #7fd0bc;
      --live:       #d9b03f;
      --risk:       #e0786c;
      --warn:       #d3a84a;
      --ok:         #4fb8a1;
      --info:       #7fa8cc;
      --shadow:     0 1px 2px rgba(0,0,0,.4), 0 10px 30px -18px rgba(0,0,0,.8);
    }
  }
  :root[data-theme="dark"] {
    --paper:      #0d1114;
    --surface:    #161c20;
    --surface-2:  #1c2429;
    --line:       #2b353a;
    --line-soft:  #222b30;
    --ink:        #e7ecea;
    --ink-2:      #a3b0b3;
    --ink-3:      #78868a;
    --accent:     #4fb8a1;
    --accent-ink: #7fd0bc;
    --live:       #d9b03f;
    --risk:       #e0786c;
    --warn:       #d3a84a;
    --ok:         #4fb8a1;
    --info:       #7fa8cc;
    --shadow:     0 1px 2px rgba(0,0,0,.4), 0 10px 30px -18px rgba(0,0,0,.8);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--f-body);
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1480px; margin: 0 auto; padding: 0 20px 64px; }

  /* ---------------------------------------------------------------- Kopf */
  .bar {
    position: sticky; top: 0; z-index: 20;
    background: color-mix(in srgb, var(--paper) 88%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
    margin: 0 -20px 26px; padding: 14px 20px;
  }
  .bar-in { max-width: 1440px; margin: 0 auto; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .brand { display: flex; align-items: baseline; gap: 10px; margin-right: auto; }
  .brand h1 {
    font-family: var(--f-display); font-weight: 600; font-size: 21px;
    margin: 0; letter-spacing: -.01em;
  }
  .brand .num { font-family: var(--f-mono); font-size: 12.5px; color: var(--ink-3); }

  .state { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2); }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--live); flex: none; }
  .playing .dot { animation: puls 1.6s ease-in-out infinite; }
  @keyframes puls { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.8); } }
  .clock { font-family: var(--f-mono); font-variant-numeric: tabular-nums; font-size: 15px; color: var(--ink); }

  .ctrls { display: flex; align-items: center; gap: 8px; }
  button {
    font: inherit; font-size: 13px; color: var(--ink);
    background: var(--surface); border: 1px solid var(--line);
    padding: 7px 13px; border-radius: 7px; cursor: pointer;
    transition: border-color .15s, background .15s;
  }
  button:hover { border-color: var(--accent); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 500; min-width: 108px; }
  :root[data-theme="dark"] .primary, :root:not([data-theme="light"]) .primary { color: #08110f; }
  @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) .primary { color: #fff; } }
  .speeds { display: flex; border: 1px solid var(--line); border-radius: 7px; overflow: hidden; }
  .speeds button { border: 0; border-radius: 0; padding: 7px 11px; font-family: var(--f-mono); font-size: 12px; background: var(--surface); }
  .speeds button + button { border-left: 1px solid var(--line); }
  .speeds button[aria-pressed="true"] { background: var(--accent); color: #fff; }
  :root[data-theme="dark"] .speeds button[aria-pressed="true"] { color: #08110f; }

  /* ---------------------------------------------------------------- Raster */
  .console { display: grid; gap: 18px; grid-template-columns: 1fr; align-items: start; }
  @media (min-width: 1080px) { .console { grid-template-columns: 1fr 1.25fr .95fr; } }

  .col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .col > h2 {
    font-family: var(--f-body); font-size: 11px; font-weight: 600;
    letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3);
    margin: 0 0 2px; padding-bottom: 8px; border-bottom: 1px solid var(--line-soft);
    display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
  }
  .col > h2 span { font-family: var(--f-mono); letter-spacing: 0; text-transform: none; font-weight: 400; }

  .panel { background: var(--surface); border: 1px solid var(--line-soft); border-radius: 10px; padding: 14px 15px; }
  .scroller { max-height: 560px; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 10px; padding-right: 2px; }

  /* ---------------------------------------------------------------- Leitung */
  .caller { display: flex; align-items: center; gap: 13px; padding: 4px 0 2px; }
  .caller .ring {
    width: 42px; height: 42px; border-radius: 50%; flex: none;
    background: var(--surface-2); border: 1px solid var(--line);
    display: grid; place-items: center; font-size: 18px;
  }
  .caller .who { min-width: 0; }
  .caller .who b { display: block; font-weight: 600; font-size: 15px; }
  .caller .who small { font-family: var(--f-mono); font-size: 12px; color: var(--ink-3); }

  .turn { display: grid; grid-template-columns: 62px 1fr; gap: 10px; align-items: start; animation: rein .4s ease both; }
  @keyframes rein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .turn .rolle {
    font-size: 10.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase;
    padding-top: 3px; text-align: right;
  }
  .turn.caller .rolle { color: var(--info); }
  .turn.advisor .rolle { color: var(--accent); }
  .turn p { margin: 0; font-size: 14.5px; }
  .turn.caller p { color: var(--ink); }
  .turn.advisor p { color: var(--ink-2); }
  .turn.aktiv p { box-shadow: -11px 0 0 -9px var(--live); padding-left: 8px; margin-left: -8px; }

  /* ---------------------------------------------------------------- Berater */
  .client { border-left: 3px solid var(--accent); }
  .client .kopf { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .client h3 { font-family: var(--f-display); font-size: 20px; font-weight: 600; margin: 0; letter-spacing: -.01em; }
  .client .ref { font-family: var(--f-mono); font-size: 12px; color: var(--ink-3); }
  .sicher {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
    color: var(--ok); background: color-mix(in srgb, var(--ok) 11%, transparent);
    padding: 3px 9px; border-radius: 20px;
  }

  .brief-kopf { font-family: var(--f-display); font-size: 17px; line-height: 1.4; margin: 0 0 6px; text-wrap: balance; }
  .brief-sub { font-size: 13px; color: var(--ink-2); margin: 0; }

  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1px; background: var(--line-soft); border-radius: 8px; overflow: hidden; }
  .metric { background: var(--surface); padding: 10px 12px; }
  .metric dt { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 3px; }
  .metric dd { margin: 0; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }
  .metric[data-tone="risk"] dd { color: var(--risk); }
  .metric[data-tone="warn"] dd { color: var(--warn); }
  .metric[data-tone="ok"] dd { color: var(--ok); }

  .flag { display: grid; grid-template-columns: 4px 1fr; gap: 11px; align-items: start; font-size: 13.5px; }
  .flag i { display: block; height: 100%; min-height: 20px; border-radius: 2px; background: var(--warn); }
  .flag[data-sev="risk"] i { background: var(--risk); }
  .flag[data-sev="info"] i { background: var(--info); }
  .flag[data-sev="ok"] i  { background: var(--ok); }
  .flag p { margin: 0 0 3px; }
  .liste { display: flex; flex-direction: column; gap: 11px; }
  .qa { font-size: 13.5px; }
  .qa b { display: block; font-weight: 600; }
  .qa span { color: var(--ink-2); }
  .schritt { display: grid; grid-template-columns: 1fr; gap: 2px; font-size: 13.5px; }
  .schritt b { font-weight: 500; }
  .schritt span { color: var(--ink-3); font-size: 12.5px; }

  .kartentitel { font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 10px; }

  /* ---------------------------------------------------------------- Vorschläge */
  .vor {
    border: 1px solid var(--line-soft); border-radius: 10px; padding: 13px 14px;
    background: var(--surface); animation: rein .45s ease both;
    border-left: 3px solid var(--info);
  }
  .vor[data-kind="say"] { background: color-mix(in srgb, var(--accent) 8%, var(--surface)); border-left-color: var(--accent); }
  .vor[data-kind="warning"] { background: color-mix(in srgb, var(--warn) 9%, var(--surface)); border-left-color: var(--warn); }
  .vor[data-kind="next"] { border-left-color: var(--ink-3); }
  .vor .art {
    display: inline-block; font-size: 10.5px; font-weight: 600; letter-spacing: .08em;
    text-transform: uppercase; color: var(--ink-3); margin-bottom: 6px;
  }
  .vor[data-kind="say"] .art { color: var(--accent-ink); }
  .vor[data-kind="warning"] .art { color: var(--warn); }
  .vor .text { margin: 0; font-size: 14.5px; }
  .vor[data-kind="say"] .text { font-size: 15.5px; font-weight: 500; }
  .vor .quelle { margin: 8px 0 0; font-family: var(--f-mono); font-size: 11px; color: var(--ink-3); word-break: break-all; }
  .vor .ausloeser { margin: 6px 0 0; font-size: 12px; color: var(--ink-3); font-style: italic; }

  /* ---------------------------------------------------------------- Agent */
  .log { display: flex; flex-direction: column; gap: 0; font-family: var(--f-mono); font-size: 12px; }
  .ev {
    display: grid; grid-template-columns: 46px 1fr; gap: 10px;
    padding: 7px 0; border-bottom: 1px solid var(--line-soft);
    animation: rein .3s ease both;
  }
  .ev:last-child { border-bottom: 0; }
  .ev time { color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .ev .was { color: var(--ink-2); word-break: break-word; }
  .ev .was b { color: var(--ink); font-weight: 500; }
  .ev[data-art="tool"] .was b { color: var(--accent-ink); }
  .ev[data-art="modell"] .was b { color: var(--info); }
  .ev[data-art="treffer"] .was b { color: var(--ok); }
  .ms { color: var(--ink-3); }

  /* ---------------------------------------------------------------- Fuss */
  .fuss { margin-top: 42px; padding-top: 26px; border-top: 1px solid var(--line); }
  .fuss h2 { font-family: var(--f-display); font-size: 22px; font-weight: 600; margin: 0 0 16px; letter-spacing: -.01em; }
  .kette { display: grid; gap: 12px; grid-template-columns: 1fr; margin-bottom: 26px; }
  @media (min-width: 760px) { .kette { grid-template-columns: repeat(4, 1fr); } }
  .glied { background: var(--surface); border: 1px solid var(--line-soft); border-radius: 10px; padding: 14px 15px; position: relative; }
  .glied .nr { font-family: var(--f-mono); font-size: 11px; color: var(--ink-3); }
  .glied b { display: block; margin: 4px 0 5px; font-size: 14.5px; font-weight: 600; }
  .glied p { margin: 0; font-size: 13px; color: var(--ink-2); }
  .glied .zeit { display: block; margin-top: 8px; font-family: var(--f-mono); font-size: 11.5px; color: var(--accent-ink); }

  .notiz { font-size: 13.5px; color: var(--ink-2); max-width: 68ch; }
  .notiz b { color: var(--ink); font-weight: 600; }
  .notiz + .notiz { margin-top: 10px; }

  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
  }
</style>
</head>
<body>
<div class="bar" id="bar">
  <div class="bar-in">
    <div class="brand">
      <h1>Telefon-Copilot</h1>
      <span class="num">+41 79 123 45 67</span>
    </div>
    <div class="state"><span class="dot"></span><span id="zustand">Gespräch läuft</span></div>
    <span class="clock" id="uhr">00:00</span>
    <div class="ctrls">
      <button class="primary" id="spielen">Pause</button>
      <button id="neu">Von vorn</button>
      <div class="speeds" role="group" aria-label="Tempo">
        <button data-tempo="0.5" aria-pressed="false">0,5×</button>
        <button data-tempo="1" aria-pressed="true">1×</button>
        <button data-tempo="2" aria-pressed="false">2×</button>
      </div>
    </div>
  </div>
</div>

<div class="wrap">
  <div class="console">

    <section class="col">
      <h2>Die Leitung <span id="zaehler">0 Beiträge</span></h2>
      <div class="panel">
        <div class="caller">
          <div class="ring">☎</div>
          <div class="who">
            <b>Eingehender Anruf</b>
            <small>+41 79 123 45 67 · Mobil</small>
          </div>
        </div>
      </div>
      <div class="panel scroller" id="transkript"></div>
    </section>

    <section class="col">
      <h2>Was der Berater sieht <span id="vorzaehler">0 Vorschläge</span></h2>
      <div class="panel client" id="kunde"></div>
      <div class="panel" id="briefing"></div>
      <div id="vorschlaege" class="liste"></div>
    </section>

    <section class="col">
      <h2>Was der Agent tut <span id="werkzeugzaehler">0 Aufrufe</span></h2>
      <div class="panel scroller"><div class="log" id="log"></div></div>
    </section>

  </div>

  <footer class="fuss">
    <h2>Was dabei wirklich passiert</h2>
    <div class="kette">
      <div class="glied">
        <span class="nr">Schritt 1</span>
        <b>Nummer erkennen</b>
        <p>Die Anrufernummer wird auf E.164 gebracht und über das Werkzeug <code>find_client_by_phone</code> nachgeschlagen.</p>
        <span class="zeit">gemessen: 38 ms</span>
      </div>
      <div class="glied">
        <span class="nr">Schritt 2</span>
        <b>Briefing bauen</b>
        <p>Sieben Werkzeuge laufen parallel gegen die Kundendaten, das Modell verdichtet sie zu fünf Karten.</p>
        <span class="zeit">gemessen: 9 655 ms</span>
      </div>
      <div class="glied">
        <span class="nr">Schritt 3</span>
        <b>Mithören</b>
        <p>Jede abgeschlossene Aussage bekommt einen Sprecher. Nur Kundenaussagen lösen etwas aus.</p>
        <span class="zeit">gemessen: unter 10 ms</span>
      </div>
      <div class="glied">
        <span class="nr">Schritt 4</span>
        <b>Vorschlagen</b>
        <p>Das Modell ruft die passenden Werkzeuge nach und liefert Antwort, Fakt und nächsten Schritt.</p>
        <span class="zeit">gemessen: 1,4 bis 3,6 s</span>
      </div>
    </div>

    <p class="notiz"><b>Alle Inhalte auf dieser Seite sind echt.</b> Briefing, Vorschläge, Werkzeugaufrufe und Laufzeiten stammen aus einem aufgezeichneten Durchlauf gegen die Case-Daten von CASE-038 mit <span style="font-family:var(--f-mono);font-size:12.5px">gpt-5.6-luna</span>. Nichts davon ist für die Darstellung ausgedacht.</p>
    <p class="notiz"><b>Die Wiedergabe ist absichtlich langsamer als das Gespräch.</b> In Wirklichkeit erscheint ein Vorschlag ein bis drei Sekunden nach der Aussage des Kunden, also noch während der Berater Luft holt. Hier läuft es im Lesetempo.</p>
    <p class="notiz"><b>Die Zuordnung von Nummer zu Kunde ist der einzige erfundene Teil.</b> Die 47 Case-Kunden führen keine Telefonnummern, deshalb kommt sie aus einer eigenen kleinen Tabelle. Alles andere steht in den gelieferten Daten.</p>
  </footer>
</div>

<script>
// Aufgezeichneter Durchlauf: Briefing, Gespraech und Vorschlaege kommen unveraendert
// aus einem echten Lauf gegen die Case-Daten (CASE-038, Charlie Brown).
const BRIEFING = [
  { type: "headline",
    text: "Das Beratungsdepot ist seit Jahresbeginn von rund 1,3 Millionen auf rund 1,6 Millionen Franken gestiegen; die Daten enthalten Ein- und Auszahlungen.",
    sub: "Depotberatung in CHF mit Anlageprofil 6; maximale Volatilität 15 Prozent und Aktienquote bis 100 Prozent. Ein ESG-Profil liegt nicht vor." },
  { type: "metrics", items: [
    { label: "Vermögen", value: "rund 1,6 Mio. Franken", tone: "info" },
    { label: "Seit Jahresbeginn", value: "1,3 → 1,6 Mio.", tone: "info" },
    { label: "Aktien im Depot", value: "76,31 %", tone: "ok" },
    { label: "Offene Verstösse", value: "18", tone: "risk" },
    { label: "Offene Vorschläge", value: "12", tone: "warn" } ] },
  { type: "flags", title: "Risiken und Chancen", items: [
    { severity: "risk", text: "10 Fehler und 5 Warnungen sind offen. Dazu gehören ein USD-Anteil über 35,5 Prozent, ein Fremdwährungsanteil über 50 Prozent, ein EUR-Anteil über 9 Prozent und drei Einzelinstrument-Klumpenrisiken.", source: "get_violations(CASE-038)" },
    { severity: "warn", text: "Als Einzelpositionen sind der S&P-500-ETF mit rund 237 Tausend Franken und 14,64 Prozent im Beratungsdepot sowie der World-Value-ETF und Nestlé mit je rund 87 beziehungsweise 82 Tausend Franken ausgewiesen.", source: "get_positions_top(CASE-038)" },
    { severity: "info", text: "Das konsolidierte Portfolio hat keine Zielbandvorgaben; seine Aktienquote beträgt 80,64 Prozent. Es darf nicht zum Beratungsdepot addiert werden.", source: "get_portfolio_summary(CASE-038)" },
    { severity: "warn", text: "Der Kunde wünscht bei der nächsten Umschichtung möglichst hohe Nachhaltigkeitsfonds und möchte fossile Energie vermeiden; ein ESG-Profil liegt nicht vor.", source: "get_recent_notes(CASE-038)" },
    { severity: "warn", text: "Ein finaler Vorschlag vom 24. Mai 2025 zur Auszahlung ist noch nicht übermittelt.", source: "get_open_proposals(CASE-038)" } ] },
  { type: "questions", title: "Womit der Kunde kommt", items: [
    { q: "Warum ist der Depotwert so stark gestiegen?", a: "Von rund 1,3 auf rund 1,6 Millionen Franken. Diese Zahl enthält Ein- und Auszahlungen; eine Rendite lässt sich daraus nicht ableiten." },
    { q: "Liegt das Depot ausserhalb meiner Zielaufteilung?", a: "Nein. Alle ausgewiesenen Kategorien liegen innerhalb ihrer Bandbreiten. Aktien liegen bei 76,31 Prozent gegenüber einem Ziel von 75 Prozent." },
    { q: "Was muss wegen der Regelverstösse geprüft werden?", a: "Offen sind 10 Fehler und 5 Warnungen. Besonders die Fremdwährungsanteile, die Nordamerika- und Sektorabweichungen sowie drei Klumpenrisiken." },
    { q: "Wurde mein Wunsch nach nachhaltigen Anlagen berücksichtigt?", a: "Dazu liegt mir keine Angabe vor. Ein ESG-Profil ist nicht hinterlegt; die letzte Notiz hält den Wunsch fest." } ] },
  { type: "actions", title: "Nächste Schritte", items: [
    { text: "Prüfen Sie die 10 Fehler und 5 Warnungen, zuerst USD, EUR und den gesamten Fremdwährungsanteil.", why: "Grenzwerte: USD 35,5 Prozent, EUR 9 Prozent, Fremdwährung gesamt 50 Prozent." },
    { text: "Prüfen Sie die drei Einzelinstrument-Klumpen im Beratungsdepot.", why: "Betroffen sind der S&P-500-ETF, Zurich Insurance und ein weiteres Instrument." },
    { text: "Klären Sie das ESG-Profil vor einer Umschichtung.", why: "Das Profil fehlt, während die letzte Notiz nachhaltige Fonds und den Ausschluss fossiler Energie festhält." },
    { text: "Klären Sie den offenen Vorschlag vom 24. Mai 2025 über 41 Positionen.", why: "Er betrifft eine Auszahlung und wartet auf die Übermittlung." },
    { text: "Vergleichen Sie die aktuelle Aufteilung mit der Benchmark.", why: "Am 16. Juni 2026 gewünscht; mehrere Benchmarkabweichungen sind ausgewiesen." } ] }
];

const GESPRAECH = [
  { sp: "advisor", t: "Grüezi Herr Brown, schön hören Sie sich. Was kann ich für Sie tun?" },
  { sp: "caller", t: "Grüezi. Ich habe mir gestern den Depotauszug angeschaut und mich gefragt, wie es eigentlich um mein Portfolio steht.", ms: 796, tools: [], h: [] },
  { sp: "advisor", t: "Gerne, ich schaue mir das gerade mit Ihnen an." },
  { sp: "caller", t: "Mir ist vor allem aufgefallen, dass da sehr viel in Dollar drin ist. Ist das nicht ein bisschen viel?", ms: 1836, tools: ["get_violations"], h: [
    { k: "say",  t: "Ja, Ihr Dollar-Anteil liegt über der Grenze von 35,5 Prozent; auch der gesamte Fremdwährungsanteil überschreitet 50 Prozent.", q: "get_violations(CASE-038)" },
    { k: "fact", t: "Der USD-Anteil liegt über 35,5 Prozent, der Fremdwährungsanteil über 50 Prozent.", q: "get_violations(CASE-038)" },
    { k: "next", t: "Prüfen Sie zuerst die betroffenen Dollar-Positionen und eine mögliche Rückführung innerhalb des Anlageprofils.", q: "get_violations(CASE-038)" } ] },
  { sp: "advisor", t: "Da haben Sie recht, das schauen wir uns an." },
  { sp: "caller", t: "Und der Euro-Anteil kommt ja auch noch dazu. Trifft mich das zusätzlich, wenn der Franken stark bleibt?", ms: 2516, tools: ["get_violations"], h: [
    { k: "say",  t: "Ja, ein starker Franken belastet Fremdwährungsanlagen zusätzlich; der Euro-Anteil überschreitet die Grenze von 9 Prozent.", q: "get_violations(CASE-038)" },
    { k: "fact", t: "Der Euro-Anteil liegt über 9 Prozent und der gesamte Fremdwährungsanteil über 50 Prozent.", q: "get_violations(CASE-038)" },
    { k: "next", t: "Prüfen Sie zuerst die genaue Währungsaufteilung und mögliche Absicherung, bevor Sie eine Umschichtung vorschlagen.", q: "get_violations(CASE-038)" } ] },
  { sp: "advisor", t: "Der gesamte Fremdwährungsanteil ist tatsächlich höher als in Ihrem Profil vorgesehen." },
  { sp: "caller", t: "Und wie sieht es mit Schweizer Aktien aus? Ich dachte immer, da wäre ich breiter aufgestellt.", ms: 2586, tools: ["get_violations", "get_saa_gap"], h: [
    { k: "say",  t: "Schweizer Aktien sind gegenüber der Benchmark deutlich untergewichtet; die Daten nennen keinen aktuellen Anteil in Prozent.", q: "get_violations(CASE-038)" },
    { k: "fact", t: "Die Untergewichtung ist als Fehler ausgewiesen; die Ausprägung beträgt mehr als 10 Prozentpunkte gegenüber dem Benchmark-Sollwert.", q: "get_violations(CASE-038)" },
    { k: "next", t: "Prüfen Sie den aktuellen Schweizer Aktienanteil und den Benchmark-Sollwert, bevor Sie eine Umschichtung besprechen.", q: "get_violations(CASE-038)" } ] },
  { sp: "advisor", t: "Das ist ein guter Punkt, den nehme ich gleich mit auf." },
  { sp: "caller", t: "Ich hatte ausserdem beim letzten Mal gesagt, dass ich gerne mehr nachhaltige Fonds hätte. Ist da etwas passiert?", ms: 2427, tools: ["get_recent_notes", "get_client_overview"], h: [
    { k: "say",  t: "Dazu liegt mir keine Angabe vor; festgehalten ist jedoch Ihr Wunsch nach möglichst nachhaltigen Fonds bei der nächsten Umschichtung.", q: "get_recent_notes(CASE-038)" },
    { k: "fact", t: "Ein ESG-Profil ist nicht hinterlegt.", q: "get_recent_notes(CASE-038)" },
    { k: "next", t: "Klären Sie vor einer Umschichtung das ESG-Profil und die gewünschte Nachhaltigkeitsquote.", q: "get_recent_notes(CASE-038)" } ] },
  { sp: "advisor", t: "Das ist notiert, und beim nächsten Rebalancing setzen wir das um." },
  { sp: "caller", t: "Wichtig ist mir, dass keine fossilen Energieträger drin sind. Das hatte ich damals ausdrücklich gesagt.", ms: 1778, tools: ["get_recent_notes"], h: [] },
  { sp: "advisor", t: "Das ist so hinterlegt, daran halten wir uns." },
  { sp: "caller", t: "Und können Sie mir noch sagen, wie ich im Vergleich zur Benchmark liege? Das wollte ich schon letztes Mal wissen.", ms: 1447, tools: [], h: [
    { k: "say",  t: "Ein Benchmarkvergleich wurde am 16. Juni 2026 für die nächste Überprüfung gewünscht; konkrete Vergleichswerte liegen mir hier nicht vor.", q: "briefing(CASE-038)" },
    { k: "fact", t: "Konkrete Benchmarkabweichungen sind als Fehler oder Warnungen ausgewiesen, aber ohne Vergleichswerte.", q: "briefing(CASE-038)" },
    { k: "next", t: "Prüfen Sie den Benchmarkvergleich in der nächsten Überprüfung.", q: "briefing(CASE-038)" } ] },
  { sp: "advisor", t: "Ja, den Vergleich bereite ich Ihnen auf und schicke ihn Ihnen zu." },
  { sp: "caller", t: "Gut. Dann machen wir das so. Besten Dank und auf Wiederhören.", ms: 3595, tools: [], h: [] },
  { sp: "advisor", t: "Sehr gerne, Herr Brown. Ich melde mich diese Woche. Auf Wiederhören." }
];

const ART = { say: "Das können Sie sagen", fact: "Fakt", next: "Nächster Schritt", warning: "Achtung" };

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const zahl = (n) => n.toLocaleString("de-CH");

let tempo = 1, laeuft = true, lauf = 0, sekunden = 0, werkzeuge = 0, vorschlaege = 0, beitraege = 0;

// ----------------------------------------------------------------- Aufbau
function kundeZeigen() {
  $("kunde").innerHTML =
    '<div class="kopf"><h3>Charlie Brown</h3><span class="sicher">über die Nummer erkannt</span></div>' +
    '<div class="ref">CASE-038 · Anlageprofil 6 · Depotberatung · CHF</div>';
}

function briefingZeigen() {
  const ziel = $("briefing");
  ziel.innerHTML = "";
  for (const k of BRIEFING) {
    if (k.type === "headline") {
      ziel.append(el("p", "brief-kopf", esc(k.text)), el("p", "brief-sub", esc(k.sub)));
    } else if (k.type === "metrics") {
      const d = el("dl", "metrics");
      d.style.marginTop = "14px";
      for (const m of k.items) {
        const c = el("div", "metric");
        c.dataset.tone = m.tone || "info";
        c.append(el("dt", null, esc(m.label)), el("dd", null, esc(m.value)));
        d.append(c);
      }
      ziel.append(d);
    } else {
      const box = el("div");
      box.style.marginTop = "18px";
      box.append(el("p", "kartentitel", esc(k.title)));
      const liste = el("div", "liste");
      for (const i of k.items) {
        if (k.type === "flags") {
          const f = el("div", "flag");
          f.dataset.sev = i.severity;
          f.append(el("i"), el("div", null, "<p>" + esc(i.text) + "</p><p class=\\"quelle\\" style=\\"font-family:var(--f-mono);font-size:11px;color:var(--ink-3);margin:0\\">" + esc(i.source) + "</p>"));
          liste.append(f);
        } else if (k.type === "questions") {
          liste.append(el("div", "qa", "<b>" + esc(i.q) + "</b><span>" + esc(i.a) + "</span>"));
        } else {
          liste.append(el("div", "schritt", "<b>" + esc(i.text) + "</b><span>" + esc(i.why) + "</span>"));
        }
      }
      box.append(liste);
      ziel.append(box);
    }
  }
}

function logEintrag(art, html, ms) {
  const mm = String(Math.floor(sekunden / 60)).padStart(2, "0");
  const ss = String(sekunden % 60).padStart(2, "0");
  const e = el("div", "ev");
  e.dataset.art = art;
  e.append(el("time", null, mm + ":" + ss), el("div", "was", html + (ms ? ' <span class="ms">' + zahl(ms) + " ms</span>" : "")));
  $("log").append(e);
  e.parentElement.parentElement.scrollTop = 1e6;
}

function beitrag(sp, text) {
  document.querySelectorAll(".turn.aktiv").forEach((n) => n.classList.remove("aktiv"));
  const t = el("div", "turn aktiv " + sp);
  t.append(el("div", "rolle", sp === "caller" ? "Kunde" : "Berater"), el("p", null, esc(text)));
  $("transkript").append(t);
  $("transkript").scrollTop = 1e6;
  beitraege++;
  $("zaehler").textContent = beitraege + (beitraege === 1 ? " Beitrag" : " Beiträge");
}

function vorschlag(v, ausloeser) {
  const n = el("div", "vor");
  n.dataset.kind = v.k;
  n.append(
    el("span", "art", ART[v.k] || v.k),
    el("p", "text", esc(v.t)),
    el("p", "ausloeser", "ausgelöst durch: „" + esc(ausloeser.slice(0, 58)) + (ausloeser.length > 58 ? "…" : "") + "“"),
    el("p", "quelle", "Quelle: " + esc(v.q))
  );
  $("vorschlaege").prepend(n);
  vorschlaege++;
  $("vorzaehler").textContent = vorschlaege + (vorschlaege === 1 ? " Vorschlag" : " Vorschläge");
}

// ----------------------------------------------------------------- Ablauf
const schlaf = (ms) => new Promise((r) => {
  const start = Date.now();
  const id = lauf;
  (function tick() {
    if (id !== lauf) return;
    if (!laeuft) return setTimeout(tick, 120);
    if (Date.now() - start >= ms / tempo) return r();
    setTimeout(tick, 60);
  })();
});

function uhrStarten() {
  const id = lauf;
  (function tick() {
    if (id !== lauf) return;
    setTimeout(() => {
      if (id !== lauf) return;
      if (laeuft) {
        sekunden++;
        $("uhr").textContent = String(Math.floor(sekunden / 60)).padStart(2, "0") + ":" + String(sekunden % 60).padStart(2, "0");
      }
      tick();
    }, 1000 / tempo);
  })();
}

async function abspielen() {
  const id = lauf;
  logEintrag("treffer", "Anruf angenommen von <b>+41 79 123 45 67</b>");
  await schlaf(700); if (id !== lauf) return;
  logEintrag("tool", "<b>find_client_by_phone</b> · Nummer auf E.164 gebracht", 38);
  await schlaf(900); if (id !== lauf) return;
  logEintrag("treffer", "Kunde erkannt: <b>CASE-038</b> Charlie Brown");
  werkzeuge++; $("werkzeugzaehler").textContent = werkzeuge + " Aufrufe";
  await schlaf(900); if (id !== lauf) return;
  logEintrag("tool", "7 Werkzeuge parallel: <b>overview, portfolio, positions, saa_gap, proposals, violations, notes</b>");
  werkzeuge += 7; $("werkzeugzaehler").textContent = werkzeuge + " Aufrufe";
  await schlaf(1400); if (id !== lauf) return;
  logEintrag("modell", "<b>gpt-5.6-luna</b> verdichtet zu 5 Briefing-Karten", 9655);

  for (const z of GESPRAECH) {
    await schlaf(900); if (id !== lauf) return;
    beitrag(z.sp, z.t);
    const lesezeit = Math.min(7000, Math.max(3000, z.t.split(" ").length * 210));
    if (z.sp !== "caller") { await schlaf(lesezeit); continue; }

    await schlaf(600); if (id !== lauf) return;
    logEintrag("treffer", "Rolle bestimmt: <b>Kunde</b> · Hinweise angestossen");
    for (const w of z.tools || []) {
      await schlaf(500); if (id !== lauf) return;
      logEintrag("tool", "<b>" + w + "(CASE-038)</b> nachgeschlagen");
      werkzeuge++; $("werkzeugzaehler").textContent = werkzeuge + " Aufrufe";
    }
    await schlaf(700); if (id !== lauf) return;

    if (!z.h.length) {
      logEintrag("modell", "<b>gpt-5.6-luna</b> · nichts Belegtes zu ergänzen", z.ms);
      await schlaf(lesezeit); continue;
    }
    logEintrag("modell", "<b>gpt-5.6-luna</b> · " + z.h.length + " Vorschläge", z.ms);
    for (const v of z.h) { await schlaf(750); if (id !== lauf) return; vorschlag(v, z.t); }
    await schlaf(lesezeit);
  }

  if (id !== lauf) return;
  logEintrag("treffer", "Gespräch beendet · Mitschnitt abgelegt");
  $("zustand").textContent = "Gespräch beendet";
  $("bar").classList.remove("playing");
  $("spielen").textContent = "Von vorn";
  laeuft = false;
}

function start() {
  lauf++;
  sekunden = 0; werkzeuge = 0; vorschlaege = 0; beitraege = 0; laeuft = true;
  $("uhr").textContent = "00:00";
  $("transkript").innerHTML = "";
  $("vorschlaege").innerHTML = "";
  $("log").innerHTML = "";
  $("zaehler").textContent = "0 Beiträge";
  $("vorzaehler").textContent = "0 Vorschläge";
  $("werkzeugzaehler").textContent = "0 Aufrufe";
  $("zustand").textContent = "Gespräch läuft";
  $("spielen").textContent = "Pause";
  $("bar").classList.add("playing");
  kundeZeigen();
  briefingZeigen();
  uhrStarten();
  abspielen();
}

$("spielen").addEventListener("click", () => {
  if ($("spielen").textContent === "Von vorn") return start();
  laeuft = !laeuft;
  $("spielen").textContent = laeuft ? "Pause" : "Weiter";
  $("bar").classList.toggle("playing", laeuft);
  $("zustand").textContent = laeuft ? "Gespräch läuft" : "angehalten";
});
$("neu").addEventListener("click", start);
document.querySelectorAll(".speeds button").forEach((b) => {
  b.addEventListener("click", () => {
    tempo = parseFloat(b.dataset.tempo);
    document.querySelectorAll(".speeds button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  });
});

start();
</script>
</body>
</html>
`
