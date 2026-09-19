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

  /* Das Dossier: was aus dem Gespräch dauerhaft beim Kunden landet. Erscheint erst am Ende. */
  .dossier { border-left: 3px solid var(--live); animation: rein .5s ease both; }
  .dossier .kartentitel { color: var(--live); }
  .dossier .alt { font-size: 13px; color: var(--ink-3); margin: 0 0 10px; }
  .dossier .neu { font-size: 14px; margin: 0; padding: 10px 12px; border-radius: 8px;
                  background: color-mix(in srgb, var(--live) 12%, var(--surface)); }
  .dossier .neu b { font-family: var(--f-mono); font-size: 12px; font-weight: 500; display: block; margin-bottom: 4px; }

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

  /* ---------------------------------------------------------------- Dossier */
  .fussnote { font-size: 12.5px; color: var(--ink-3); margin: 8px 0 0; max-width: 72ch; }
  .fuss > .fussnote { margin-bottom: 22px; font-size: 13.5px; }
  .fussnote code, .fuss code { font-family: var(--f-mono); font-size: .92em; }

  .dossier-raster { display: grid; gap: 14px; grid-template-columns: 1fr; }
  @media (min-width: 720px)  { .dossier-raster { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1180px) { .dossier-raster { grid-template-columns: repeat(3, 1fr); } }
  .karte { background: var(--surface); border: 1px solid var(--line-soft); border-radius: 10px; padding: 15px 16px; min-width: 0; }
  .karte.weit { grid-column: 1 / -1; }
  .karte h3 { font-family: var(--f-display); font-size: 17px; font-weight: 600; margin: 0 0 12px;
              display: flex; align-items: baseline; gap: 9px; }
  .karte h4 { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
              color: var(--ink-3); margin: 16px 0 9px; }
  .anzahl { font-family: var(--f-mono); font-size: 12px; font-weight: 400; color: var(--ink-3); }

  .paare { display: grid; gap: 1px; background: var(--line-soft); border-radius: 8px; overflow: hidden; margin: 0; }
  .paare > div { background: var(--surface); display: flex; justify-content: space-between; gap: 14px; padding: 7px 11px; }
  .paare dt { font-size: 12.5px; color: var(--ink-3); margin: 0; }
  .paare dd { margin: 0; font-size: 13.5px; text-align: right; }
  .mono { font-family: var(--f-mono); font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .warnzeile { font-size: 13px; color: var(--risk); margin: 11px 0 0; }

  .band { display: grid; gap: 4px; margin-bottom: 11px; font-size: 13px; }
  .band .kopf { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .band .kopf b { font-weight: 500; }
  .band .kopf span { font-family: var(--f-mono); font-size: 12px; font-variant-numeric: tabular-nums; color: var(--ink-3); }
  .band .kopf span.raus { color: var(--risk); }
  .spur { position: relative; height: 10px; background: var(--surface-2); border: 1px solid var(--line-soft); border-radius: 5px; }
  .spur i { position: absolute; display: block; }
  .spur .zone { top: 0; bottom: 0; background: color-mix(in srgb, var(--ok) 22%, transparent); }
  .spur .ziel { top: -3px; bottom: -3px; width: 2px; background: var(--ink-3); }
  .spur .ist { top: 1px; bottom: 1px; width: 3px; border-radius: 2px; background: var(--ok); }
  .spur .ist.draussen { background: var(--risk); }

  .tabelle-rahmen { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line-soft); white-space: nowrap; }
  th { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); font-weight: 600; }
  td:first-child { white-space: normal; min-width: 200px; }
  .r { text-align: right; }
  tr.konto td { color: var(--ink-2); }
  tbody tr:last-child td { border-bottom: 0; }

  .notiz { padding: 9px 0; border-bottom: 1px solid var(--line-soft); font-size: 13.5px; }
  .notiz:last-of-type { border-bottom: 0; }
  .notiz time { display: block; font-size: 11.5px; color: var(--ink-3); margin-bottom: 3px; }
  .notiz p { margin: 0; }
  .notiz p + p { color: var(--ink-2); margin-top: 2px; }
  .freitext { font-size: 14px; margin: 0; padding: 12px 14px; border-radius: 8px;
              background: var(--surface-2); border-left: 3px solid var(--live); }

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
      <div class="panel dossier" id="dossier" hidden></div>
      <div class="panel" id="briefing"></div>
      <div id="vorschlaege" class="liste"></div>
    </section>

    <section class="col">
      <h2>Was der Agent tut <span id="werkzeugzaehler">0 Aufrufe</span></h2>
      <div class="panel scroller"><div class="log" id="log"></div></div>
    </section>

  </div>

  <footer class="fuss">
    <h2>Das Dossier von Tester Muster</h2>
    <p class="fussnote">Genau diese Daten liest der Copilot über MCP Toolbox. Sie stehen in
    <code>data/unrisk.db</code>, gebaut aus <code>fixtures/tester.json</code>. Die Wertschriften und die
    Anlagestrategie stammen aus den echten Stammdaten des Falls, die Beträge sind erfunden.</p>

    <div class="dossier-raster">

      <section class="karte">
        <h3>Stammdaten</h3>
        <dl class="paare">
          <div><dt>Kundennummer</dt><dd class="mono">TESTER-01</dd></div>
          <div><dt>Name</dt><dd>Tester Muster</dd></div>
          <div><dt>Kundentyp</dt><dd>Private client</dd></div>
          <div><dt>Referenzwährung</dt><dd>CHF</dd></div>
          <div><dt>Geburtstag</dt><dd>12.04.1979</dd></div>
          <div><dt>Profiliert am</dt><dd>18.03.2025</dd></div>
          <div><dt>Vermögen</dt><dd class="mono">842’500 CHF</dd></div>
          <div><dt>Liquidität</dt><dd class="mono">33’700 CHF</dd></div>
          <div><dt>Interessen</dt><dd>Switzerland (Region), Sustainability (Theme)</dd></div>
        </dl>
      </section>

      <section class="karte">
        <h3>Anlageprofil und Grenzen</h3>
        <dl class="paare">
          <div><dt>Profil</dt><dd>Anlageprofil 5</dd></div>
          <div><dt>ESG-Profil</dt><dd>Yes</dd></div>
          <div><dt>Risikostufe</dt><dd class="mono">5</dd></div>
          <div><dt>Max. Volatilität</dt><dd class="mono">12 %</dd></div>
          <div><dt>Max. Produktrisiko</dt><dd class="mono">7</dd></div>
          <div><dt>Max. Aktienquote</dt><dd class="mono">85 %</dd></div>
        </dl>
        <p class="warnzeile">Die gemessene Volatilität liegt bei 13,5 % und damit über den zulässigen 12 %.</p>
      </section>

      <section class="karte">
        <h3>Portfolio TESTER-01-01</h3>
        <dl class="paare">
          <div><dt>Bezeichnung</dt><dd>Anlageberatung Test</dd></div>
          <div><dt>Dienstleistung</dt><dd>Comprehensive Investment Advisory</dd></div>
          <div><dt>Strategie</dt><dd>Investor profile 5</dd></div>
          <div><dt>Vermögen</dt><dd class="mono">842’500 CHF</dd></div>
          <div><dt>Volatilität</dt><dd class="mono">13,5 %</dd></div>
          <div><dt>Erwartete Rendite</dt><dd class="mono">4,1 %</dd></div>
          <div><dt>Value at Risk</dt><dd class="mono">14,6 %</dd></div>
          <div><dt>Wertveränderung</dt><dd class="mono">–</dd></div>
        </dl>
        <p class="fussnote">Die Wertveränderung enthält Ein- und Auszahlungen und ist deshalb keine Rendite.</p>
      </section>

      <section class="karte weit">
        <h3>Ist gegen Anlagestrategie</h3>
        <div class="band">
    <div class="kopf"><b>Shares</b><span class="raus">86,8 % · Band 20 % bis 85 %</span></div>
    <div class="spur">
      <i class="zone" style="left:20%;width:64.99999999999999%"></i>
      <i class="ziel" style="left:50%"></i>
      <i class="ist draussen" style="left:calc(86.81305637982196% - 1px)"></i>
    </div>
  </div>
        <div class="band">
    <div class="kopf"><b>Bonds</b><span class="raus">5,0 % · Band 10 % bis 70 %</span></div>
    <div class="spur">
      <i class="zone" style="left:10%;width:60%"></i>
      <i class="ziel" style="left:42%"></i>
      <i class="ist draussen" style="left:calc(4.985163204747774% - 1px)"></i>
    </div>
  </div>
        <div class="band">
    <div class="kopf"><b>Real estate</b><span class="">2,5 % · Band 0 % bis 15 %</span></div>
    <div class="spur">
      <i class="zone" style="left:0%;width:15%"></i>
      <i class="ziel" style="left:5%"></i>
      <i class="ist" style="left:calc(2.4807121661721068% - 1px)"></i>
    </div>
  </div>
        <div class="band">
    <div class="kopf"><b>Specialties andCommodities</b><span class="">1,7 % · Band 0 % bis 20 %</span></div>
    <div class="spur">
      <i class="zone" style="left:0%;width:20%"></i>
      <i class="ziel" style="left:0%"></i>
      <i class="ist" style="left:calc(1.7210682492581602% - 1px)"></i>
    </div>
  </div>
        <div class="band">
    <div class="kopf"><b>Liquidity</b><span class="">4,0 % · Band 0 % bis 60 %</span></div>
    <div class="spur">
      <i class="zone" style="left:0%;width:60%"></i>
      <i class="ziel" style="left:3%"></i>
      <i class="ist" style="left:calc(4% - 1px)"></i>
    </div>
  </div>
        <p class="fussnote">Helles Feld ist das Mandatsband, der Strich das Ziel, der Balken der Ist-Wert. Rot heisst: ausserhalb des Bandes.</p>
      </section>

      <section class="karte weit">
        <h3>Positionen</h3>
        <div class="tabelle-rahmen">
          <table>
            <thead><tr><th>Titel</th><th>ISIN</th><th class="r">Stück</th><th class="r">Kurs</th><th class="r">Betrag</th><th class="r">Anteil</th><th>Klasse</th></tr></thead>
            <tbody>
              <tr><td>Namen-Aktie OC Oerlikon Corporation AG</td><td class="mono">CH0000816824</td><td class="r mono">9’800</td><td class="r mono">31.5</td><td class="r mono">308’700 CHF</td><td class="r mono">36,6 %</td><td>Shares</td></tr>
              <tr><td>Anteile -P- UBS (CH) Equity Fund - Small Caps Switzerland</td><td class="mono">CH0004311335</td><td class="r mono">480</td><td class="r mono">640</td><td class="r mono">307’200 CHF</td><td class="r mono">36,5 %</td><td>Shares</td></tr>
              <tr><td>Namen-Aktie Rieter Holding AG</td><td class="mono">CH0003671440</td><td class="r mono">1’250</td><td class="r mono">92.4</td><td class="r mono">115’500 CHF</td><td class="r mono">13,7 %</td><td>Shares</td></tr>
              <tr><td>Anteile CHF (Hedged) PIMCO Funds Glob.Inv.Series</td><td class="mono">IE00B4YLF345</td><td class="r mono">2’100</td><td class="r mono">20</td><td class="r mono">42’000 CHF</td><td class="r mono">5,0 %</td><td>Bonds</td></tr>
              <tr><td>Anteile -FA CHF- Swisscanto (CH) Real Estate Fund</td><td class="mono">CH0037430946</td><td class="r mono">190</td><td class="r mono">110</td><td class="r mono">20’900 CHF</td><td class="r mono">2,5 %</td><td>Real estate</td></tr>
              <tr><td>Goldbarren 100 Gramm 999.9 fein</td><td class="mono">CH0002811245</td><td class="r mono">2</td><td class="r mono">7’250</td><td class="r mono">14’500 CHF</td><td class="r mono">1,7 %</td><td>Specialties andCommodities</td></tr>
              <tr class="konto"><td>Privatkonto Test CHF</td><td class="mono">Konto</td><td class="r">–</td><td class="r">–</td><td class="r mono">33’700 CHF</td><td class="r mono">4,0 %</td><td>Liquidity</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="karte">
        <h3>Offene Verstösse <span class="anzahl">4</span></h3>
        <div class="flag" data-sev="risk"><i></i><div><p><b>Minimum limit fixed income</b></p><p>Der Obligationenanteil liegt unter der Untergrenze von 10 Prozent der Anlagestrategie.</p></div></div>
        <div class="flag" data-sev="risk"><i></i><div><p><b>Cluster risk of a single financial instrument</b></p><p>Für Privatkunden mit umfassender Anlageberatung darf eine Einzelposition 20 Prozent nicht überschreiten.</p></div></div>
        <div class="flag" data-sev="risk"><i></i><div><p><b>Compliance with maximum volatility</b></p><p>Die Volatilität des Portfolios überschreitet die für Anlageprofil 5 zulässigen 12 Prozent.</p></div></div>
        <div class="flag" data-sev="warn"><i></i><div><p><b>Overweight in the equity sector "Industrials"</b></p><p>Übergewicht (+/- 5% zum SAA-Sollwert der Benchmark) im Aktiensektor "Industrie".</p></div></div>
        <h4>Bewusst ausgesetzt</h4><div class="flag" data-sev="info"><i></i><div><p><b>Minimum limit liquidity</b></p><p>Mindestliquidität wurde auf Wunsch des Kunden bis Ende 2026 ausgesetzt.</p></div></div><p class="fussnote">Ausgesetzte Regeln stehen in derselben Tabelle wie Verstösse und müssen gefiltert werden, sonst zählt der Copilot sie mit.</p>
      </section>

      <section class="karte">
        <h3>CRM-Notizen <span class="anzahl">3</span></h3>
        <div class="notiz"><time class="mono">28.08.2026</time><p>Möchte beim nächsten Rebalancing einen nachhaltigen Schweizer Aktienfonds statt der Einzeltitel prüfen.</p></div>
        <div class="notiz"><time class="mono">04.07.2026</time><p>Hat angekündigt, Anfang 2027 rund 80 Tausend Franken für einen Wohnungskauf zu entnehmen.</p></div>
        <div class="notiz"><time class="mono">18.03.2026</time><p>Jahresgespräch geführt, Anlageprofil 5 bestätigt, keine Änderung der Strategie gewünscht.</p></div>
        <p class="fussnote">Diese Notizen sind der Grund, warum der Copilot im Gespräch auf Nachhaltigkeit und auf die geplante Entnahme kommt.</p>
      </section>

      <section class="karte">
        <h3>Anlagevorschläge <span class="anzahl">2</span></h3>
        <div class="notiz"><time class="mono">02.09.2026 · Entwurf</time><p><b>Nachhaltigkeitswunsch aus dem letzten Gespräch</b></p><p>Prüfung eines nachhaltigen Schweizer Aktienfonds als Ersatz für die Einzeltitel.</p></div>
        <div class="notiz"><time class="mono">12.08.2026 · Final</time><p><b>Rückführung der Aktienquote in die Bandbreite</b></p><p>Teilverkauf OC Oerlikon, Aufbau Obligationen CHF.</p></div>
      </section>

      <section class="karte">
        <h3>Letzte Transaktionen</h3>
        <div class="notiz"><p><b>Namen-Aktie OC Oerlikon Corporation AG</b></p><p class="mono">undefined Stück · –</p></div>
        <div class="notiz"><p><b>Goldbarren 100 Gramm 999.9 fein</b></p><p class="mono">undefined Stück · –</p></div>
      </section>

      <section class="karte weit">
        <h3>Freitext im Dossier</h3>
        <p class="freitext">Testkunde für Entwicklung und Vorführung. Alle Zahlen sind erfunden, die Wertschriften und die Anlagestrategie stammen aber aus den echten Stammdaten, damit die Auswertungen greifen.</p>
        <p class="fussnote">Hier hängt der Copilot nach jedem Gespräch seine Zusammenfassung an. Beim nächsten Anruf liest er sie wieder mit.</p>
      </section>

    </div>
  </footer>
</div>

<script>
// Aufgezeichneter Durchlauf: Briefing, Gespraech, Vorschlaege und die Dossiernotiz am Ende
// kommen unveraendert aus einem echten Lauf gegen TESTER-01 mit gpt-5.6-luna.
const KUNDE = { ref: "TESTER-01", name: "Tester Muster", profil: "Anlageprofil 5 · umfassende Anlageberatung · CHF" };

const DOSSIER_VORHER = "Testkunde für Entwicklung und Vorführung. Alle Zahlen sind erfunden, die Wertschriften und die Anlagestrategie stammen aber aus den echten Stammdaten, damit die Auswertungen greifen.";
const DOSSIER_NOTIZ = "Der Kunde wollte prüfen, ob die hohe Aktienquote und der geringe Obligationenanteil noch seinem Profil entsprechen, und äusserte Bedenken zur Grösse der OC-Oerlikon-Position. Zudem erkundigte er sich nach dem gewünschten nachhaltigen Schweizer Fonds; dazu wurde ein noch nicht finalisierter Entwurf erwähnt. Der Kunde wies auf einen geplanten Bedarf von rund 80 Tausend Franken für die Wohnung Anfang 2027 hin, und der Berater sagte zu, dies in die Planung aufzunehmen und sich diese Woche zu melden. Offen bleiben die Besprechung des vorbereiteten Vorschlags zur Oerlikon-Position und zu Schweizer Obligationen sowie die Prüfung und Finalisierung des Fondsentwurfs.";

const BRIEFING = [
  { type: "headline",
    text: "Ihr Vermögen beträgt rund 843 Tausend Franken; die Aktienquote liegt mit 86,81 Prozent über dem Maximum von 85 Prozent und die Volatilität mit 13,48 Prozent über den zulässigen 12 Prozent.",
    sub: "Mandat: umfassende Anlageberatung, Anlageprofil 5, ESG-Profil vorhanden, Referenzwährung Schweizer Franken." },
  { type: "metrics", items: [
    { label: "Vermögen", value: "rund 843 Tsd. Franken", tone: "info" },
    { label: "Volatilität", value: "13,48 %", tone: "risk" },
    { label: "Aktienanteil", value: "86,81 %", tone: "risk" },
    { label: "Obligationen", value: "4,99 %", tone: "warn" },
    { label: "Offene Vorschläge", value: "2", tone: "info" } ] },
  { type: "allocation", title: "Soll und Ist", rows: [
    { label: "Shares", min: 0.20, target: 0.50, max: 0.85, actual: 0.8681 },
    { label: "Bonds", min: 0.10, target: 0.42, max: 0.70, actual: 0.0499 },
    { label: "Real estate", min: 0, target: 0.05, max: 0.15, actual: 0.0248 },
    { label: "Specialties andCommodities", min: 0, target: 0, max: 0.20, actual: 0.0172 },
    { label: "Liquidity", min: 0, target: 0.03, max: 0.60, actual: 0.04 } ] },
  { type: "flags", title: "Risiken und Chancen", items: [
    { severity: "risk", text: "Vier offene Regelverstösse: Einzelposition über 20 Prozent, Volatilität über 12 Prozent, Obligationen unter dem Minimum und ein Sektorübergewicht Industrie.", source: "get_violations(TESTER-01)" },
    { severity: "warn", text: "Die grössten Positionen sind OC Oerlikon mit rund 309 Tausend Franken und ein UBS-Small-Caps-Fonds mit rund 307 Tausend Franken, zusammen 73 Prozent des Portfolios.", source: "get_positions_top(TESTER-01)" },
    { severity: "warn", text: "Ein finaler Vorschlag vom 12. August 2026 wartet auf Zustimmung: Teilverkauf OC Oerlikon und Aufbau von Schweizer Obligationen.", source: "get_open_proposals(TESTER-01)" },
    { severity: "info", text: "Für Anfang 2027 wurde eine Entnahme von rund 80 Tausend Franken für einen Wohnungskauf angekündigt.", source: "get_recent_notes(TESTER-01)" },
    { severity: "info", text: "Die Mindestliquidität ist auf Kundenwunsch bis Ende 2026 ausgesetzt und zählt deshalb nicht als offener Verstoss.", source: "get_client_overview(TESTER-01)" } ] },
  { type: "questions", title: "Womit der Kunde kommt", items: [
    { q: "Warum ist mein Portfolio zu risikoreich?", a: "Die Aktienquote liegt bei 86,81 Prozent gegenüber einem Maximum von 85 Prozent, die Volatilität bei 13,48 gegenüber 12 Prozent." },
    { q: "Was soll mit den Aktien und Obligationen geschehen?", a: "Ein finaler Vorschlag sieht den Teilverkauf von OC Oerlikon und den Aufbau von Schweizer Obligationen vor; er wartet auf Zustimmung." },
    { q: "Wurde mein Wunsch nach Nachhaltigkeit berücksichtigt?", a: "Ein Entwurf vom 2. September 2026 prüft einen nachhaltigen Schweizer Aktienfonds als Ersatz für die Einzeltitel." },
    { q: "Kann ich Anfang 2027 rund 80 Tausend Franken entnehmen?", a: "Die Entnahme ist notiert. Zur Finanzierbarkeit liegt keine Berechnung vor." } ] },
  { type: "actions", title: "Nächste Schritte", items: [
    { text: "Besprechen Sie den finalen Vorschlag über zwei Positionen zur Rückführung der Aktienquote.", why: "Er liegt seit dem 12. August 2026 bereit und wartet auf die Zustimmung des Kunden." },
    { text: "Klären Sie die Zustimmung zum Teilverkauf von OC Oerlikon und zum Aufbau von Schweizer Obligationen.", why: "Die Einzelposition liegt mit 36,64 Prozent deutlich über der Klumpengrenze von 20 Prozent." },
    { text: "Prüfen Sie den Entwurf für einen nachhaltigen Schweizer Aktienfonds.", why: "Notiz vom 28. August 2026: Ersatz der Einzeltitel beim nächsten Rebalancing gewünscht." },
    { text: "Planen Sie die angekündigte Entnahme von rund 80 Tausend Franken für Anfang 2027 ein.", why: "Notiz vom 4. Juli 2026, Wohnungskauf." } ] }
];

const GESPRAECH = [
  { sp: "advisor", t: "Grüezi Herr Muster, schön hören Sie sich. Was kann ich für Sie tun?" },
  { sp: "caller", t: "Grüezi. Ich habe den Depotauszug angeschaut und mich gefragt, ob bei mir noch alles im Rahmen ist.", ms: 1481, tools: [], h: [
    { k: "say", t: "Ihr Aktienanteil liegt mit 86,81 Prozent über dem Maximum von 85 Prozent, und die Volatilität beträgt 13,48 Prozent statt maximal 12 Prozent.", q: "briefing(TESTER-01)" },
    { k: "fact", t: "Die Obligationenquote beträgt 4,99 Prozent; das Mindestband liegt bei 10 Prozent. Quelle: get_saa_gap(TESTER-01)", q: "briefing(TESTER-01)" },
    { k: "next", t: "Besprechen Sie den finalen Vorschlag zum Teilverkauf von OC Oerlikon und zum Aufbau von Schweizer Obligationen. Quelle: get_open_proposals(TESTER-01)", q: "briefing(TESTER-01)" }
  ] },
  { sp: "advisor", t: "Gerne, ich schaue mir das gerade mit Ihnen an." },
  { sp: "caller", t: "Mir ist vor allem aufgefallen, dass ich fast nur noch Aktien drin habe. Ist das nicht zu viel für mein Profil?", ms: 1576, tools: [], h: [
    { k: "say", t: "Ja, Ihr Aktienanteil beträgt 86,81 Prozent und liegt damit 1,81 Prozentpunkte über dem Maximum von 85 Prozent.", q: "briefing(TESTER-01)" },
    { k: "fact", t: "Die Volatilität beträgt 13,48 Prozent gegenüber maximal 12 Prozent im Anlageprofil 5. Quelle: get_client_overview(TESTER-01), get_portfolio_summary(TESTER-01)", q: "briefing(TESTER-01)" },
    { k: "next", t: "Besprechen Sie den finalen Vorschlag zum Teilverkauf von OC Oerlikon und zum Aufbau von Schweizer Obligationen. Quelle: get_open_proposals(TESTER-01)", q: "briefing(TESTER-01)" }
  ] },
  { sp: "advisor", t: "Das ist ein berechtigter Punkt, den schauen wir uns an." },
  { sp: "caller", t: "Und von Obligationen sehe ich fast nichts mehr. War das nicht mal deutlich mehr?", ms: 1626, tools: [], h: [
    { k: "say", t: "Ihr Obligationenanteil liegt aktuell bei 4,99 Prozent und damit unter dem Mindestanteil von 10 Prozent.", q: "briefing(TESTER-01)" },
    { k: "fact", t: "Obligationen: 4,99 Prozent; Mindestanteil: 10 Prozent. Quelle: get_saa_gap(TESTER-01)", q: "briefing(TESTER-01)" },
    { k: "next", t: "Besprechen Sie den finalen Vorschlag zum Aufbau Schweizer Obligationen; er wartet noch auf Ihre Zustimmung. Quelle: get_open_proposals(TESTER-01)", q: "briefing(TESTER-01)" }
  ] },
  { sp: "advisor", t: "Ja, da hat sich einiges verschoben." },
  { sp: "caller", t: "Die Oerlikon-Position kommt mir auch gross vor. Ist das nicht ein Klumpenrisiko?", ms: 2494, tools: ["get_positions_top"], h: [
    { k: "say", t: "Ja, die Oerlikon-Position beträgt rund 309 Tausend Franken und entspricht 36,64 Prozent des Portfolios; die Einzelpositionsgrenze liegt bei 20 Prozent.", q: "get_positions_top(TESTER-01)" },
    { k: "fact", t: "OC Oerlikon beträgt rund 309 Tausend Franken beziehungsweise 36,64 Prozent des Portfolios. Quelle: get_positions_top(TESTER-01)", q: "get_positions_top(TESTER-01)" },
    { k: "next", t: "Besprechen Sie den finalen Vorschlag zum Teilverkauf von OC Oerlikon. Quelle: get_open_proposals(TESTER-01)", q: "get_positions_top(TESTER-01)" }
  ] },
  { sp: "advisor", t: "Dazu habe ich Ihnen bereits etwas vorbereitet." },
  { sp: "caller", t: "Ich hatte ausserdem beim letzten Mal nach einem nachhaltigen Schweizer Fonds gefragt. Ist da etwas passiert?", ms: 1377, tools: [], h: [
    { k: "say", t: "Dazu gibt es bisher einen Entwurf vom 2. September 2026 für einen nachhaltigen Schweizer Aktienfonds als Ersatz für Einzeltitel.", q: "briefing(TESTER-01)" },
    { k: "fact", t: "Der Vorschlag ist noch nicht final. Quelle: get_open_proposals(TESTER-01).", q: "briefing(TESTER-01)" },
    { k: "next", t: "Prüfen Sie den Entwurf gemeinsam mit dem Kunden; eine konkrete Umsetzung ist erst nach Finalisierung möglich.", q: "briefing(TESTER-01)" }
  ] },
  { sp: "advisor", t: "Das ist notiert, dazu liegt ein Entwurf bereit." },
  { sp: "caller", t: "Und denken Sie bitte daran, ich brauche Anfang 2027 rund achtzig Tausend Franken für die Wohnung.", ms: 1696, tools: [], h: [
    { k: "say", t: "Die Entnahme von rund 80 Tausend Franken für Anfang 2027 ist notiert; zur konkreten Finanzierbarkeit liegen mir keine weiteren Daten vor.", q: "briefing(TESTER-01)" },
    { k: "fact", t: "Für Anfang 2027 ist eine Entnahme von rund 80 Tausend Franken für einen Wohnungskauf angekündigt. Quelle: get_recent_notes(TESTER-01)", q: "briefing(TESTER-01)" },
    { k: "next", t: "Berücksichtigen Sie die geplante Entnahme bei der weiteren Allokationsprüfung.", q: "briefing(TESTER-01)" }
  ] },
  { sp: "advisor", t: "Das nehme ich in die Planung auf." },
  { sp: "caller", t: "Gut. Dann machen wir das so. Besten Dank und auf Wiederhören.", ms: 894, tools: [], h: [
  ] },
  { sp: "advisor", t: "Sehr gerne, Herr Muster. Ich melde mich diese Woche. Auf Wiederhören." },
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
    '<div class="kopf"><h3>Tester Muster</h3><span class="sicher">über die Nummer erkannt</span></div>' +
    '<div class="ref">' + esc(KUNDE.ref + ' · ' + KUNDE.profil) + '</div>';
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
  logEintrag("treffer", "Kunde erkannt: <b>TESTER-01</b> Tester Muster");
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
      logEintrag("tool", "<b>" + w + "(TESTER-01)</b> nachgeschlagen");
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
  await schlaf(1200); if (id !== lauf) return;

  // Der Rückweg: was im Gespräch aufkam, wandert in den Freitext des Kunden und steht
  // beim nächsten Anruf wieder im Briefing.
  logEintrag("modell", "<b>gpt-5.6-luna</b> fasst das Gespräch fürs Dossier zusammen", 1751);
  await schlaf(1400); if (id !== lauf) return;
  logEintrag("tool", "<b>append_call_summary(TESTER-01)</b> · an den Freitext angehängt");
  werkzeuge++; $("werkzeugzaehler").textContent = werkzeuge + " Aufrufe";
  dossierZeigen();
  await schlaf(900); if (id !== lauf) return;
  logEintrag("treffer", "Dossier ergänzt · beim nächsten Anruf im Briefing");

  $("zustand").textContent = "Gespräch beendet";
  $("bar").classList.remove("playing");
  $("spielen").textContent = "Von vorn";
  laeuft = false;
}

function dossierZeigen() {
  const d = $("dossier");
  d.hidden = false;
  d.innerHTML =
    '<p class="kartentitel">Ins Dossier geschrieben</p>' +
    '<p class="alt">' + esc(DOSSIER_VORHER) + "</p>" +
    '<p class="neu"><b>Telefon 2026-09-19</b>' + esc(DOSSIER_NOTIZ) + "</p>";
  d.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
