// Die Oberfläche, die der Berater während des Gesprächs offen hat.
//
// Eine einzige Zeichenkette, genau wie src/page.ts: vollständiges HTML, eigenes CSS und
// Browser-JavaScript ohne Bibliothek, ohne Bündler, ohne externe Schrift oder Bilder.
// Der Server muss sie nur ausliefern.
//
// Was der Server dafür bedienen muss:
//   GET  /            diese Seite
//   GET  /events      Server-Sent Events; Ereignisnamen und Nutzlast nach src/copilot/events.ts:
//                     call.started, client.identified, transcript.segment, suggestion,
//                     answer, call.ended, status
//                     (die alten Prüfstand-Ereignisse `line` und `reset` aus src/live.ts
//                      versteht die Seite weiterhin, damit sie auch vor dem Umbau etwas zeigt)
//   POST /api/ask     { "question": "..." } – die Antwort kommt als `answer` über SSE zurück,
//                     nicht als HTTP-Antwort. 202 genügt.
//
// Ohne Server prüfen: die Seite mit ?demo=1 aufrufen. Dann speist sie sich aus einer
// eingebauten Beispielfolge statt aus der SSE-Verbindung.

export const copilotPage = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Telefon-Copilot</title>
<style>
/* ---------------------------------------------------------------- Farben */
:root {
  color-scheme: light;
  --bg: #e9ebee;
  --flaeche: #ffffff;
  --flaeche-2: #f4f5f7;
  --flaeche-3: #eceef1;
  --rand: #d7dae0;
  --rand-2: #c3c8d0;
  --text: #23262b;
  --gedaempft: #5f646b;
  --leise: #878d95;
  --marke: #2f6fbf;
  --kunde: #2a63ad;
  --berater: #0f7173;
  --risk: #bf3125;
  --warn: #8a6410;
  --ok: #2c7a52;
  --info: #2f6fbf;
  --risk-feld: #fbe9e7;
  --warn-feld: #fbf1d8;
  --ok-feld: #e6f4ec;
  --info-feld: #e7effb;
  --spur: #dcdfe4;
  --band: #c2d3ea;
  --schatten: 0 1px 3px rgba(20, 24, 30, .12);
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #0d0f12;
    --flaeche: #15181d;
    --flaeche-2: #1b1f26;
    --flaeche-3: #21262e;
    --rand: #2b313a;
    --rand-2: #3a414c;
    --text: #e8eaed;
    --gedaempft: #a8aeb6;
    --leise: #7d848d;
    --marke: #7db8ff;
    --kunde: #7db8ff;
    --berater: #69d4d6;
    --risk: #ff8a7d;
    --warn: #f2d24b;
    --ok: #6ddba0;
    --info: #7db8ff;
    --risk-feld: #2e1a19;
    --warn-feld: #2b2716;
    --ok-feld: #14261d;
    --info-feld: #16212f;
    --spur: #2b313a;
    --band: #35516f;
    --schatten: 0 2px 8px rgba(0, 0, 0, .45);
  }
}

/* ---------------------------------------------------------------- Grundlage */
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font: 16px/1.55 ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, p, ul, ol { margin: 0; }
ul, ol { padding: 0; list-style: none; }
button, input { font: inherit; color: inherit; }
button { cursor: pointer; }
.nur-vorleser {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}

.ton-risk { color: var(--risk); }
.ton-warn { color: var(--warn); }
.ton-ok { color: var(--ok); }
.ton-info { color: var(--info); }

.punkt { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--leise); flex: none; }
.punkt.risk { background: var(--risk); }
.punkt.warn { background: var(--warn); }
.punkt.ok { background: var(--ok); }
.punkt.info { background: var(--info); }

/* ---------------------------------------------------------------- Kopf */
.kopf {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; gap: 14px;
  padding: 12px 18px;
  background: var(--flaeche);
  border-bottom: 1px solid var(--rand);
}
.kopf .punkt { width: 12px; height: 12px; }
.kopf .punkt.laeuft { background: var(--ok); box-shadow: 0 0 0 0 rgba(44, 122, 82, .55); animation: puls 2.4s ease-out infinite; }
@keyframes puls { 70% { box-shadow: 0 0 0 10px rgba(44, 122, 82, 0); } 100% { box-shadow: 0 0 0 0 rgba(44, 122, 82, 0); } }
.kopf-text { min-width: 0; flex: 1; }
.kopf-titel { font-size: 21px; font-weight: 600; letter-spacing: .005em; overflow-wrap: anywhere; }
.kopf-unter { font-size: 13.5px; color: var(--gedaempft); overflow-wrap: anywhere; }
.kopf-rechts { display: flex; align-items: center; gap: 14px; flex: none; }
.uhr { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: .01em; }
.verbindung {
  font-size: 12px; padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--rand-2); color: var(--gedaempft); background: var(--flaeche-2);
  max-width: 34ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.verbindung[data-lage="offen"] { color: var(--ok); border-color: var(--ok); }
.verbindung[data-lage="weg"] { color: var(--risk); border-color: var(--risk); }
.verbindung[data-lage="demo"] { color: var(--info); border-color: var(--info); }

/* ---------------------------------------------------------------- Raster */
.raster { display: grid; gap: 14px; padding: 14px; align-items: start; }
.spalte { display: grid; gap: 14px; align-content: start; min-width: 0; }
.bereich-titel {
  font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .09em;
  color: var(--leise); margin-bottom: 8px;
}

.karte {
  background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
  padding: 14px 16px; box-shadow: var(--schatten);
}
.karten-titel { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: var(--leise); margin-bottom: 10px; }
.karten-fuss { font-size: 12px; color: var(--leise); margin-top: 10px; }
.ruhe { color: var(--gedaempft); font-size: 14.5px; }
.ruhe-klein { color: var(--leise); font-size: 13px; margin-top: 4px; }

/* ---------------------------------------------------------------- Kundenkarte */
.kunde-kopf { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.kunde-name { font-size: 24px; font-weight: 600; letter-spacing: .005em; }
.kunde-ref { font-size: 15px; color: var(--gedaempft); font-variant-numeric: tabular-nums; }
.kunde-sicher {
  display: inline-flex; align-items: center; gap: 7px; margin-top: 10px;
  font-size: 13px; padding: 4px 11px; border-radius: 999px; border: 1px solid var(--rand-2);
}
.kunde-sicher.ok { background: var(--ok-feld); border-color: var(--ok); color: var(--ok); }
.kunde-sicher.info { background: var(--info-feld); border-color: var(--info); color: var(--info); }
.kunde-sicher.warn { background: var(--warn-feld); border-color: var(--warn); color: var(--warn); }
.kunde.unbekannt { border-left: 4px solid var(--warn); }
.kunde-hinweis { font-size: 14px; color: var(--gedaempft); margin-top: 8px; }

/* ---------------------------------------------------------------- Briefing */
.briefing { display: grid; gap: 12px; align-content: start; }
.b-headline { border-left: 4px solid var(--marke); }
.b-headline-text { font-size: 19px; font-weight: 600; line-height: 1.35; }
.b-headline-sub { font-size: 14px; color: var(--gedaempft); margin-top: 6px; }

.metrik-gitter { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px 18px; }
.metrik-label { font-size: 11.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--leise); }
.metrik-wert { font-size: 17px; font-weight: 600; overflow-wrap: anywhere; }
.metrik-delta { font-size: 12.5px; }

.allo-zeile { padding: 9px 0; border-top: 1px solid var(--rand); }
.allo-zeile:first-of-type { border-top: 0; padding-top: 0; }
.allo-kopf { display: flex; align-items: baseline; gap: 10px; }
.allo-label { font-size: 15px; font-weight: 500; flex: 1; min-width: 0; }
.allo-ist { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
.spur { position: relative; height: 16px; margin: 7px 0 5px; background: var(--flaeche-3); border-radius: 4px; overflow: hidden; }
.spur-band { position: absolute; top: 0; bottom: 0; background: var(--band); }
.spur-balken { position: absolute; top: 4px; bottom: 4px; left: 0; border-radius: 3px; background: var(--ok); }
.spur-balken.draussen { background: var(--risk); }
.spur-ziel { position: absolute; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: var(--text); opacity: .75; }
.allo-fuss { font-size: 12.5px; color: var(--gedaempft); font-variant-numeric: tabular-nums; }
.allo-lage { font-weight: 600; }

.flagge { display: flex; gap: 10px; padding: 8px 0; border-top: 1px solid var(--rand); }
.flagge:first-of-type { border-top: 0; padding-top: 0; }
.flagge .punkt { margin-top: 7px; }
.flagge-text { font-size: 15px; }
.quelle { font-size: 12px; color: var(--leise); margin-top: 2px; }

.tat { display: flex; gap: 11px; padding: 9px 0; border-top: 1px solid var(--rand); }
.tat:first-of-type { border-top: 0; padding-top: 0; }
.tat-nr {
  flex: none; width: 23px; height: 23px; border-radius: 50%; background: var(--flaeche-3);
  color: var(--gedaempft); font-size: 12.5px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; margin-top: 2px;
}
.tat-text { font-size: 15px; }
.tat-warum { font-size: 13px; color: var(--gedaempft); margin-top: 2px; }

.fa { padding: 8px 0; border-top: 1px solid var(--rand); }
.fa:first-of-type { border-top: 0; padding-top: 0; }
.fa-q { font-size: 14.5px; font-weight: 600; }
.fa-a { font-size: 14px; color: var(--gedaempft); margin-top: 2px; }

/* ---------------------------------------------------------------- Transkript */
.transkript-rahmen { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; position: relative; }
.transkript {
  background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
  padding: 10px 16px; box-shadow: var(--schatten);
  max-height: 52vh; overflow-y: auto; scroll-behavior: smooth;
}
.zeile { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; padding: 7px 0; border-top: 1px solid var(--rand); }
.zeile:first-child { border-top: 0; }
.wer { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--leise); padding-top: 4px; }
.zeile.kunde .wer { color: var(--kunde); }
.zeile.berater .wer { color: var(--berater); }
.was { font-size: 16px; overflow-wrap: anywhere; }
.zeile.vorlaeufig { opacity: .55; }
.zeile.vorlaeufig .was { font-style: italic; }
.zeile.unklar .was { color: var(--gedaempft); }
.mitlaufen {
  position: absolute; right: 14px; bottom: 12px;
  background: var(--flaeche-3); border: 1px solid var(--rand-2); border-radius: 999px;
  padding: 6px 13px; font-size: 12.5px; color: var(--text); box-shadow: var(--schatten);
}

/* ---------------------------------------------------------------- Rückfrage */
.frage { position: sticky; top: 0; z-index: 3; display: flex; gap: 8px; background: var(--bg); padding-bottom: 2px; }
.frage input {
  flex: 1; min-width: 0; padding: 11px 14px; font-size: 15.5px;
  background: var(--flaeche); border: 1px solid var(--rand-2); border-radius: 10px;
}
.frage input::placeholder { color: var(--leise); }
.frage input:focus-visible, .mitlaufen:focus-visible, .frage button:focus-visible { outline: 2px solid var(--marke); outline-offset: 2px; }
.frage button {
  flex: none; padding: 11px 18px; font-size: 15.5px; font-weight: 600;
  background: var(--marke); color: #ffffff; border: 0; border-radius: 10px;
}
@media (prefers-color-scheme: dark) { .frage button { color: #0d0f12; } }
.frage button[disabled] { opacity: .55; cursor: default; }
.frage-hinweis { font-size: 13px; color: var(--gedaempft); padding: 0 2px; overflow-wrap: anywhere; }
.frage-hinweis.fehler { color: var(--risk); }

/* ---------------------------------------------------------------- Vorschläge */
.vorschlaege { display: grid; gap: 12px; align-content: start; }
.vorschlag {
  background: var(--flaeche); border: 1px solid var(--rand); border-left: 4px solid var(--rand-2);
  border-radius: 12px; padding: 13px 15px; box-shadow: var(--schatten);
}
.vorschlag.ton-risk { border-left-color: var(--risk); }
.vorschlag.ton-warn { border-left-color: var(--warn); }
.vorschlag.ton-ok { border-left-color: var(--ok); }
.vorschlag.ton-info { border-left-color: var(--info); }
.vorschlag-kopf { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 7px; }
.marke-art {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em;
  padding: 3px 9px; border-radius: 5px; background: var(--flaeche-3); color: var(--gedaempft);
}
.art-say .marke-art { background: var(--marke); color: var(--flaeche); }
@media (prefers-color-scheme: dark) { .art-say .marke-art { color: #0d0f12; } }
.art-warning .marke-art { background: var(--warn-feld); color: var(--warn); }
.art-answer .marke-art { background: var(--info-feld); color: var(--info); }
.marke-ton { font-size: 11.5px; color: var(--leise); }
.marke-zeit { font-size: 11.5px; color: var(--leise); margin-left: auto; font-variant-numeric: tabular-nums; }
.vorschlag-text { font-size: 16.5px; line-height: 1.45; overflow-wrap: anywhere; }
/* «say» ist das, was der Berater vorlesen kann – es darf am deutlichsten hervorstechen. */
.art-say { background: var(--info-feld); }
.art-say .vorschlag-text { font-size: 20px; font-weight: 500; line-height: 1.4; }
.art-warning { background: var(--warn-feld); }
.zusatz { display: flex; gap: 7px; margin-top: 7px; font-size: 13px; color: var(--gedaempft); }
.zusatz-label { flex: none; font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--leise); padding-top: 3px; min-width: 72px; }
.zusatz-text { min-width: 0; overflow-wrap: anywhere; }
.zusatz-text.zitat { font-style: italic; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; }
.chip {
  font-size: 11.5px; padding: 2px 8px; border-radius: 5px;
  background: var(--flaeche-3); color: var(--gedaempft); border: 1px solid var(--rand);
}
.nicht-gedeckt {
  display: inline-block; margin-top: 8px; font-size: 13px; font-weight: 600;
  padding: 4px 10px; border-radius: 6px; background: var(--warn-feld); color: var(--warn); border: 1px solid var(--warn);
}
.frage-echo { font-size: 13.5px; color: var(--gedaempft); font-style: italic; margin-bottom: 6px; overflow-wrap: anywhere; }

@keyframes auftauchen { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
.neu { animation: auftauchen .4s cubic-bezier(.22, 1, .36, 1) both; }
@media (prefers-reduced-motion: reduce) {
  .neu { animation: none; }
  .kopf .punkt.laeuft { animation: none; }
  .transkript { scroll-behavior: auto; }
}

/* ---------------------------------------------------------------- Statuszeile */
.fusszeile {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px;
  padding: 8px 18px; border-top: 1px solid var(--rand);
  background: var(--flaeche); font-size: 12px; color: var(--leise);
}
.komponente { display: inline-flex; align-items: center; gap: 7px; }
.komponente b { font-weight: 600; color: var(--gedaempft); }
.komponente .punkt { width: 8px; height: 8px; }
.fuss-notiz { margin-left: auto; overflow-wrap: anywhere; }

/* ---------------------------------------------------------------- Breite Bildschirme */
@media (min-width: 900px) {
  body { height: 100vh; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
  .kopf { position: static; }
  .raster { grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); min-height: 0; overflow: hidden; }
  .links { grid-template-rows: auto auto minmax(0, 1fr); min-height: 0; }
  .rechts { grid-template-rows: auto auto minmax(0, 1fr); min-height: 0; }
  .briefing { max-height: 42vh; overflow-y: auto; padding-right: 2px; }
  .transkript { max-height: none; height: 100%; }
  .vorschlaege { overflow-y: auto; padding-right: 2px; min-height: 0; }
}
</style>
</head>
<body>

<header class="kopf">
  <span class="punkt" id="anruf-punkt" aria-hidden="true"></span>
  <div class="kopf-text">
    <h1 class="kopf-titel" id="kopf-titel">Leitung bereit</h1>
    <p class="kopf-unter" id="kopf-unter">Kein Gespräch aktiv. Sobald ein Anruf eingeht, füllt sich diese Seite von selbst.</p>
  </div>
  <div class="kopf-rechts">
    <span class="uhr" id="uhr" hidden aria-label="Gesprächsdauer">00:00</span>
    <span class="verbindung" id="verbindung" data-lage="verbinde" role="status">verbinde …</span>
  </div>
</header>

<main class="raster">
  <section class="spalte links">

    <article class="karte kunde" id="kunde" aria-label="Kunde">
      <p class="ruhe">Noch kein Kunde erkannt.</p>
      <p class="ruhe-klein">Bei einem Anruf wird die Nummer nachgeschlagen und das Dossier erscheint hier.</p>
    </article>

    <section class="briefing" id="briefing" aria-label="Briefing">
      <article class="karte">
        <p class="ruhe">Das Briefing erscheint, sobald der Kunde erkannt ist.</p>
        <p class="ruhe-klein">Kennzahlen, Mandatsband, offene Verstösse, Vorgehen und häufige Fragen.</p>
      </article>
    </section>

    <section class="transkript-rahmen" aria-label="Gespräch">
      <h2 class="bereich-titel">Gespräch</h2>
      <div class="transkript" id="transkript" role="log" aria-live="off">
        <p class="ruhe" id="transkript-ruhe">Das Transkript erscheint, sobald gesprochen wird.</p>
      </div>
      <button class="mitlaufen" id="mitlaufen" type="button" hidden>Neuste Zeilen zeigen</button>
    </section>

  </section>

  <aside class="spalte rechts">
    <form class="frage" id="frage-form" autocomplete="off">
      <label class="nur-vorleser" for="frage-feld">Rückfrage an den Copiloten</label>
      <input id="frage-feld" name="frage" type="text" placeholder="Rückfrage stellen – z. B. «Wie hoch ist die freie Liquidität?»">
      <button type="submit" id="frage-knopf">Fragen</button>
    </form>
    <p class="frage-hinweis" id="frage-hinweis" role="status" hidden></p>

    <div class="vorschlaege" id="vorschlaege" aria-live="polite" aria-label="Vorschläge">
      <article class="karte">
        <p class="ruhe">Noch keine Vorschläge.</p>
        <p class="ruhe-klein">Während des Gesprächs erscheinen hier Sätze zum Vorlesen, Fakten, nächste Schritte und Warnungen – neueste zuoberst.</p>
      </article>
    </div>
  </aside>
</main>

<footer class="fusszeile" id="fusszeile">
  <span class="komponente" id="st-toolbox"><i class="punkt"></i><b>Toolbox</b><em>unbekannt</em></span>
  <span class="komponente" id="st-brain"><i class="punkt"></i><b>Modell</b><em>unbekannt</em></span>
  <span class="komponente" id="st-telephony"><i class="punkt"></i><b>Telefonie</b><em>unbekannt</em></span>
  <span class="fuss-notiz" id="fuss-notiz"></span>
</footer>

<noscript><p style="padding:18px">Diese Seite braucht JavaScript, um die Live-Ereignisse zu empfangen.</p></noscript>

<script>
(function () {
  'use strict'

  // ================================================================ Helfer
  var $ = function (id) { return document.getElementById(id) }

  function el(tag, klasse, text) {
    var n = document.createElement(tag)
    if (klasse) n.className = klasse
    if (text !== undefined && text !== null) n.textContent = String(text)
    return n
  }

  function leeren(node) { while (node.firstChild) node.removeChild(node.firstChild) }

  function zwei(n) { return (n < 10 ? '0' : '') + n }

  function dauer(ms) {
    var s = Math.max(0, Math.floor(ms / 1000))
    return zwei(Math.floor(s / 60)) + ':' + zwei(s % 60)
  }

  function uhrzeit(wert) {
    var d = wert ? new Date(wert) : new Date()
    if (isNaN(d.getTime())) d = new Date()
    return zwei(d.getHours()) + ':' + zwei(d.getMinutes())
  }

  function zeitstempel(wert) {
    var t = wert ? Date.parse(wert) : NaN
    return isNaN(t) ? Date.now() : t
  }

  // Die Werte im Briefing sind Brüche zwischen 0 und 1, keine Prozentzahlen.
  // Ausgabe in Schweizer Schreibweise mit Dezimalkomma.
  function prozent(bruch) {
    var v = Number(bruch)
    if (!isFinite(v)) return '–'
    var p = Math.round(v * 1000) / 10
    var text = Math.round(p) === p ? String(p) : p.toFixed(1)
    return text.split('.').join(',') + ' %'
  }

  function anteil(wert, skala) {
    var v = Number(wert) / (skala || 1)
    if (!isFinite(v) || v < 0) v = 0
    if (v > 1) v = 1
    return (v * 100).toFixed(3) + '%'
  }

  // +41791234567 wird zu +41 79 123 45 67. Alles andere bleibt, wie es kam.
  function nummerLesbar(roh) {
    var s = String(roh || '').trim()
    if (!s) return 'Nummer unterdrückt'
    if (s.indexOf('+41') === 0 && s.length === 12) {
      return '+41 ' + s.slice(3, 5) + ' ' + s.slice(5, 8) + ' ' + s.slice(8, 10) + ' ' + s.slice(10, 12)
    }
    return s
  }

  var TON_WORT = { risk: 'Risiko', warn: 'Achtung', ok: 'In Ordnung', info: 'Hinweis' }
  function ton(wert) { return TON_WORT[wert] ? wert : 'info' }

  // ================================================================ Zustand
  var zustand = {
    callId: null,
    von: '',
    startMs: 0,
    laeuft: false,
    beendet: false,
    endGrund: '',
    letzteDauer: 0,
    scrollUnten: true,
    offeneFrage: '',
  }

  var K = {
    punkt: $('anruf-punkt'),
    titel: $('kopf-titel'),
    unter: $('kopf-unter'),
    uhr: $('uhr'),
    verbindung: $('verbindung'),
    kunde: $('kunde'),
    briefing: $('briefing'),
    transkript: $('transkript'),
    transkriptRuhe: $('transkript-ruhe'),
    mitlaufen: $('mitlaufen'),
    frageForm: $('frage-form'),
    frageFeld: $('frage-feld'),
    frageKnopf: $('frage-knopf'),
    frageHinweis: $('frage-hinweis'),
    vorschlaege: $('vorschlaege'),
    fussNotiz: $('fuss-notiz'),
  }

  // ================================================================ Kopf
  function kopfZeichnen() {
    if (!zustand.callId) {
      K.punkt.className = 'punkt'
      K.titel.textContent = 'Leitung bereit'
      K.unter.textContent = 'Kein Gespräch aktiv. Sobald ein Anruf eingeht, füllt sich diese Seite von selbst.'
      K.uhr.hidden = true
      document.title = 'Telefon-Copilot'
      return
    }
    K.titel.textContent = nummerLesbar(zustand.von)
    K.uhr.hidden = false
    if (zustand.laeuft) {
      K.punkt.className = 'punkt ok laeuft'
      K.unter.textContent = 'Gespräch läuft seit ' + uhrzeit(zustand.startMs) + ' Uhr.'
    } else {
      K.punkt.className = 'punkt'
      K.unter.textContent = zustand.endGrund
        ? 'Gespräch beendet · ' + zustand.endGrund
        : 'Gespräch beendet.'
    }
    uhrZeichnen()
  }

  function uhrZeichnen() {
    var ms = zustand.laeuft ? Date.now() - zustand.startMs : zustand.letzteDauer
    var text = dauer(ms)
    K.uhr.textContent = text
    document.title = zustand.laeuft ? text + ' · Telefon-Copilot' : 'Telefon-Copilot'
  }

  setInterval(function () { if (zustand.laeuft) uhrZeichnen() }, 1000)

  function verbindungSetzen(lage, text) {
    K.verbindung.setAttribute('data-lage', lage)
    K.verbindung.textContent = text
  }

  // ================================================================ Kundenkarte
  var SICHERHEIT = {
    phone: { wort: 'sicher erkannt', wie: 'über die Anrufernummer', stufe: 'ok' },
    name: { wort: 'wahrscheinlich erkannt', wie: 'über den genannten Namen', stufe: 'info' },
    manual: { wort: 'von Hand zugeordnet', wie: 'durch den Berater gesetzt', stufe: 'info' },
    unknown: { wort: 'nicht eindeutig erkannt', wie: 'Zuordnung unsicher', stufe: 'warn' },
  }

  function kundeZeichnen(ev) {
    leeren(K.kunde)
    var sicher = SICHERHEIT[ev.confidence] || SICHERHEIT.unknown

    if (!ev.clientRef) {
      // Ehrlich bleiben: lieber kein Dossier als ein falsches.
      K.kunde.className = 'karte kunde unbekannt'
      K.kunde.appendChild(el('p', 'kunde-name', ev.name ? ev.name : 'Unbekannter Anrufer'))
      K.kunde.appendChild(el('p', 'kunde-hinweis',
        'Diese Nummer steht in keinem Kundendatensatz. Es wird kein Dossier angezeigt, damit nichts Falsches gesagt wird.'))
      K.kunde.appendChild(el('p', 'kunde-hinweis',
        'Fragen Sie nach dem Namen und ordnen Sie den Kunden im Arbeitsplatz zu – oder stellen Sie rechts eine Rückfrage.'))
      var marke = el('span', 'kunde-sicher warn')
      marke.appendChild(el('i', 'punkt warn'))
      marke.appendChild(el('span', null, 'keine Zuordnung'))
      K.kunde.appendChild(marke)
      return
    }

    K.kunde.className = 'karte kunde'
    var kopf = el('div', 'kunde-kopf')
    kopf.appendChild(el('span', 'kunde-name', ev.name || 'Kunde ohne Namen'))
    kopf.appendChild(el('span', 'kunde-ref', ev.clientRef))
    K.kunde.appendChild(kopf)

    var band = el('span', 'kunde-sicher ' + sicher.stufe)
    band.appendChild(el('i', 'punkt ' + sicher.stufe))
    band.appendChild(el('span', null, sicher.wort + ' · ' + sicher.wie))
    K.kunde.appendChild(band)
  }

  // ================================================================ Briefing
  function briefingZeichnen(karten, kundeBekannt) {
    leeren(K.briefing)
    if (!karten || !karten.length) {
      var leer = el('article', 'karte')
      if (kundeBekannt) {
        leer.appendChild(el('p', 'ruhe', 'Zu diesem Kunden liegt kein Briefing vor.'))
        leer.appendChild(el('p', 'ruhe-klein', 'Die Toolbox hat nichts geliefert. Stellen Sie rechts eine Rückfrage.'))
      } else {
        leer.appendChild(el('p', 'ruhe', 'Ohne zugeordneten Kunden gibt es kein Briefing.'))
        leer.appendChild(el('p', 'ruhe-klein', 'Fragen Sie nach dem Namen. Sobald der Kunde zugeordnet ist, erscheint das Dossier hier.'))
      }
      K.briefing.appendChild(leer)
      return
    }
    for (var i = 0; i < karten.length; i++) {
      var k = briefingKarte(karten[i])
      if (k) K.briefing.appendChild(k)
    }
  }

  function briefingKarte(karte) {
    if (!karte || !karte.type) return null
    if (karte.type === 'headline') return karteSchlagzeile(karte)
    if (karte.type === 'metrics') return karteKennzahlen(karte)
    if (karte.type === 'allocation') return karteAllokation(karte)
    if (karte.type === 'flags') return karteFlaggen(karte)
    if (karte.type === 'actions') return karteHandlungen(karte)
    if (karte.type === 'questions') return karteFragen(karte)
    return null
  }

  function karteSchlagzeile(karte) {
    var k = el('article', 'karte b-headline')
    k.appendChild(el('p', 'b-headline-text', karte.text || ''))
    if (karte.sub) k.appendChild(el('p', 'b-headline-sub', karte.sub))
    return k
  }

  function karteKennzahlen(karte) {
    var k = el('article', 'karte')
    k.appendChild(el('h3', 'karten-titel', 'Kennzahlen'))
    var gitter = el('div', 'metrik-gitter')
    var items = karte.items || []
    for (var i = 0; i < items.length; i++) {
      var m = items[i]
      var zelle = el('div', 'metrik')
      zelle.appendChild(el('div', 'metrik-label', m.label || ''))
      zelle.appendChild(el('div', 'metrik-wert', m.value || '–'))
      if (m.delta) zelle.appendChild(el('div', 'metrik-delta ton-' + ton(m.tone), m.delta))
      gitter.appendChild(zelle)
    }
    k.appendChild(gitter)
    return k
  }

  function karteAllokation(karte) {
    var k = el('article', 'karte')
    k.appendChild(el('h3', 'karten-titel', karte.title || 'Mandatsband'))
    var reihen = karte.rows || []

    // Massstab bis zum nächsten Zehntel über dem grössten Wert, damit die Balken die
    // Breite nutzen. Der Massstab steht unter der Karte, damit nichts grösser wirkt, als es ist.
    var spitze = 0
    for (var s = 0; s < reihen.length; s++) {
      var r0 = reihen[s]
      spitze = Math.max(spitze, Number(r0.max) || 0, Number(r0.actual) || 0, Number(r0.target) || 0)
    }
    var skala = Math.ceil(spitze * 10 - 0.0001) / 10
    if (!isFinite(skala) || skala <= 0) skala = 1
    if (skala > 1) skala = 1
    if (skala < 0.2) skala = 0.2

    for (var i = 0; i < reihen.length; i++) {
      var r = reihen[i]
      var min = Number(r.min) || 0
      var max = Number(r.max) || 0
      var ziel = Number(r.target) || 0
      var ist = Number(r.actual) || 0
      var drin = ist >= min - 1e-9 && ist <= max + 1e-9
      var lage = drin ? 'im Band' : (ist > max ? 'über dem Band' : 'unter dem Band')
      var stufe = drin ? 'ok' : 'risk'

      var zeile = el('div', 'allo-zeile')
      var kopf = el('div', 'allo-kopf')
      kopf.appendChild(el('span', 'allo-label', r.label || ''))
      kopf.appendChild(el('span', 'allo-ist ton-' + stufe, prozent(ist)))
      zeile.appendChild(kopf)

      var spur = el('div', 'spur')
      spur.setAttribute('role', 'img')
      spur.setAttribute('aria-label',
        (r.label || '') + ': Ist ' + prozent(ist) + ', Band ' + prozent(min) + ' bis ' + prozent(max) +
        ', Ziel ' + prozent(ziel) + ', ' + lage)
      var band = el('span', 'spur-band')
      band.style.left = anteil(min, skala)
      band.style.width = anteil(Math.max(0, max - min), skala)
      var balken = el('span', 'spur-balken' + (drin ? '' : ' draussen'))
      balken.style.width = anteil(ist, skala)
      var ziellinie = el('span', 'spur-ziel')
      ziellinie.style.left = anteil(ziel, skala)
      spur.appendChild(band)
      spur.appendChild(balken)
      spur.appendChild(ziellinie)
      zeile.appendChild(spur)

      var fuss = el('div', 'allo-fuss')
      fuss.appendChild(el('span', null, 'Band ' + prozent(min) + ' bis ' + prozent(max) + ' · Ziel ' + prozent(ziel) + ' · '))
      fuss.appendChild(el('span', 'allo-lage ton-' + stufe, lage))
      zeile.appendChild(fuss)

      k.appendChild(zeile)
    }

    k.appendChild(el('p', 'karten-fuss',
      'Massstab 0 bis ' + prozent(skala) + '. Balken = Ist, helles Feld = Mandatsband, Strich = Ziel.'))
    return k
  }

  function karteFlaggen(karte) {
    var k = el('article', 'karte')
    k.appendChild(el('h3', 'karten-titel', karte.title || 'Regelwerk'))
    var items = karte.items || []
    var liste = el('ul')
    for (var i = 0; i < items.length; i++) {
      var f = items[i]
      var li = el('li', 'flagge')
      li.appendChild(el('i', 'punkt ' + ton(f.severity)))
      var rechts = el('div')
      rechts.appendChild(el('p', 'flagge-text', f.text || ''))
      rechts.appendChild(el('p', 'quelle', (TON_WORT[ton(f.severity)]) + (f.source ? ' · Quelle: ' + f.source : '')))
      li.appendChild(rechts)
      liste.appendChild(li)
    }
    k.appendChild(liste)
    return k
  }

  function karteHandlungen(karte) {
    var k = el('article', 'karte')
    k.appendChild(el('h3', 'karten-titel', karte.title || 'Vorgehen'))
    var items = karte.items || []
    var liste = el('ol')
    for (var i = 0; i < items.length; i++) {
      var a = items[i]
      var li = el('li', 'tat')
      li.appendChild(el('span', 'tat-nr', i + 1))
      var rechts = el('div')
      rechts.appendChild(el('p', 'tat-text', a.text || ''))
      if (a.why) rechts.appendChild(el('p', 'tat-warum', a.why))
      li.appendChild(rechts)
      liste.appendChild(li)
    }
    k.appendChild(liste)
    return k
  }

  function karteFragen(karte) {
    var k = el('article', 'karte')
    k.appendChild(el('h3', 'karten-titel', karte.title || 'Häufige Fragen'))
    var items = karte.items || []
    var liste = el('ul')
    for (var i = 0; i < items.length; i++) {
      var f = items[i]
      var li = el('li', 'fa')
      li.appendChild(el('p', 'fa-q', f.q || ''))
      li.appendChild(el('p', 'fa-a', f.a || ''))
      liste.appendChild(li)
    }
    k.appendChild(liste)
    return k
  }

  // ================================================================ Transkript
  var zeilen = {}

  var ROLLE = {
    caller: { klasse: 'kunde', wort: 'Kunde' },
    advisor: { klasse: 'berater', wort: 'Berater' },
    unknown: { klasse: 'unklar', wort: 'Sprecher unklar' },
  }

  function transkriptZeichnen(ev) {
    if (K.transkriptRuhe && K.transkriptRuhe.parentNode) {
      K.transkript.removeChild(K.transkriptRuhe)
      K.transkriptRuhe = null
    }
    var schluessel = 'z' + ev.lineId
    var knoten = zeilen[schluessel]
    if (!knoten) {
      knoten = el('p', 'zeile')
      knoten.appendChild(el('span', 'wer'))
      knoten.appendChild(el('span', 'was'))
      K.transkript.appendChild(knoten)
      zeilen[schluessel] = knoten
    }
    // «unknown» ist ein gültiger Zustand, kein Fehler: neutrale Farbe, ehrliche Beschriftung.
    var rolle = ROLLE[ev.speaker] || ROLLE.unknown
    knoten.className = 'zeile ' + rolle.klasse + (ev.final ? '' : ' vorlaeufig')
    knoten.firstChild.textContent = rolle.wort
    knoten.lastChild.textContent = ev.text || ''
    mitlaufen()
  }

  function amBoden() {
    return K.transkript.scrollHeight - K.transkript.scrollTop - K.transkript.clientHeight < 60
  }

  function mitlaufen() {
    if (zustand.scrollUnten) K.transkript.scrollTop = K.transkript.scrollHeight
    else K.mitlaufen.hidden = false
  }

  K.transkript.addEventListener('scroll', function () {
    zustand.scrollUnten = amBoden()
    if (zustand.scrollUnten) K.mitlaufen.hidden = true
  })

  K.mitlaufen.addEventListener('click', function () {
    zustand.scrollUnten = true
    K.mitlaufen.hidden = true
    K.transkript.scrollTop = K.transkript.scrollHeight
  })

  // ================================================================ Vorschläge
  var ART = {
    say: { wort: 'Vorlesen' },
    fact: { wort: 'Fakt' },
    next: { wort: 'Nächster Schritt' },
    warning: { wort: 'Achtung' },
  }

  var karten = {}
  var HOECHSTZAHL = 40

  function ruhezustandWeg() {
    var ruhe = K.vorschlaege.querySelector('.karte')
    if (ruhe) K.vorschlaege.removeChild(ruhe)
  }

  function obenEinsetzen(schluessel, knoten) {
    ruhezustandWeg()
    var alt = karten[schluessel]
    if (alt && alt.parentNode) {
      // Ein erneut gesendeter Vorschlag ersetzt sich selbst, statt sich zu stapeln.
      alt.parentNode.replaceChild(knoten, alt)
    } else {
      K.vorschlaege.insertBefore(knoten, K.vorschlaege.firstChild)
      knoten.classList.add('neu')
    }
    karten[schluessel] = knoten
    while (K.vorschlaege.children.length > HOECHSTZAHL) {
      K.vorschlaege.removeChild(K.vorschlaege.lastChild)
    }
  }

  function zusatzZeile(label, text, zitat) {
    var z = el('div', 'zusatz')
    z.appendChild(el('span', 'zusatz-label', label))
    z.appendChild(el('span', 'zusatz-text' + (zitat ? ' zitat' : ''), text))
    return z
  }

  function quellenZeile(quellen) {
    var liste = quellen || []
    if (!liste.length) return null
    var z = el('div', 'zusatz')
    z.appendChild(el('span', 'zusatz-label', 'Quellen'))
    var chips = el('span', 'chips')
    for (var i = 0; i < liste.length; i++) chips.appendChild(el('span', 'chip', liste[i]))
    z.appendChild(chips)
    return z
  }

  function vorschlagKarte(ev) {
    var art = ART[ev.kind] ? ev.kind : 'fact'
    var k = el('article', 'vorschlag art-' + art + ' ton-' + ton(ev.severity))
    var kopf = el('div', 'vorschlag-kopf')
    kopf.appendChild(el('span', 'marke-art', ART[art].wort))
    kopf.appendChild(el('span', 'marke-ton', TON_WORT[ton(ev.severity)]))
    kopf.appendChild(el('span', 'marke-zeit', uhrzeit()))
    k.appendChild(kopf)
    k.appendChild(el('p', 'vorschlag-text', ev.text || ''))
    if (ev.why) k.appendChild(zusatzZeile('Warum', ev.why, false))
    var q = quellenZeile(ev.sources)
    if (q) k.appendChild(q)
    if (ev.trigger) k.appendChild(zusatzZeile('Auslöser', '«' + ev.trigger + '»', true))
    return k
  }

  function antwortKarte(ev) {
    var k = el('article', 'vorschlag art-answer ton-' + (ev.supported === false ? 'warn' : 'info'))
    var kopf = el('div', 'vorschlag-kopf')
    kopf.appendChild(el('span', 'marke-art', 'Antwort'))
    kopf.appendChild(el('span', 'marke-ton', ev.supported === false ? 'nicht durch Daten gedeckt' : 'auf Ihre Rückfrage'))
    kopf.appendChild(el('span', 'marke-zeit', uhrzeit()))
    k.appendChild(kopf)
    if (ev.question) k.appendChild(el('p', 'frage-echo', '«' + ev.question + '»'))
    k.appendChild(el('p', 'vorschlag-text', ev.text || ''))
    if (ev.supported === false) {
      k.appendChild(el('p', 'nicht-gedeckt', 'Nicht durch die Daten gedeckt – bitte nicht als Zusage weitergeben.'))
    }
    var q = quellenZeile(ev.sources)
    if (q) k.appendChild(q)
    return k
  }

  // Gleichwertig zu «usePaced» in der App: eine neue Karte erscheint erst, wenn die vorige
  // mindestens TAKT_MS gestanden hat. Trifft zu einer Kennung Neues ein, bevor sie dran war,
  // wartet nur das Letzte. Warnungen und Risiken dürfen sofort durch – dafür sind sie da.
  var TAKT_MS = 1800
  var warteschlange = []
  var letzteEinblendung = 0
  var taktUhr = null

  function vorschlagAnnehmen(ev) {
    if (!ev || !ev.id) return
    if (ev.kind === 'warning' || ev.severity === 'risk') { vorschlagZeigen(ev); return }
    for (var i = 0; i < warteschlange.length; i++) {
      if (warteschlange[i].id === ev.id) { warteschlange[i] = ev; return }
    }
    warteschlange.push(ev)
    takten()
  }

  function takten() {
    if (taktUhr || !warteschlange.length) return
    var wartet = Math.max(0, letzteEinblendung + TAKT_MS - Date.now())
    taktUhr = setTimeout(function () {
      taktUhr = null
      var naechster = warteschlange.shift()
      if (naechster) vorschlagZeigen(naechster)
      takten()
    }, wartet)
  }

  function vorschlagZeigen(ev) {
    letzteEinblendung = Date.now()
    obenEinsetzen('v' + ev.id, vorschlagKarte(ev))
  }

  function antwortZeigen(ev) {
    if (!ev) return
    // Die Rückfrage hat der Berater gerade selbst gestellt – sie wartet nicht im Takt.
    obenEinsetzen('a' + (ev.id || Date.now()), antwortKarte(ev))
    if (zustand.offeneFrage && ev.question === zustand.offeneFrage) hinweisWeg()
    else if (!zustand.offeneFrage) hinweisWeg()
    K.vorschlaege.scrollTop = 0
  }

  // ================================================================ Rückfrage
  function hinweisZeigen(text, fehler) {
    K.frageHinweis.textContent = text
    K.frageHinweis.className = 'frage-hinweis' + (fehler ? ' fehler' : '')
    K.frageHinweis.hidden = false
  }

  function hinweisWeg() {
    zustand.offeneFrage = ''
    K.frageHinweis.hidden = true
    K.frageHinweis.textContent = ''
  }

  K.frageForm.addEventListener('submit', function (e) {
    e.preventDefault()
    var frage = K.frageFeld.value.trim()
    if (!frage) return
    K.frageFeld.value = ''
    zustand.offeneFrage = frage
    hinweisZeigen('Frage unterwegs: «' + frage + '» – die Antwort erscheint als Karte.')

    setTimeout(function () {
      if (zustand.offeneFrage === frage) hinweisZeigen('Noch keine Antwort auf «' + frage + '» – der Copilot rechnet.')
    }, 12000)

    if (DEMO) { demoAntwort(frage); return }

    K.frageKnopf.disabled = true
    fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: frage, callId: zustand.callId }),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status)
    }).catch(function (err) {
      zustand.offeneFrage = ''
      hinweisZeigen('Frage konnte nicht gesendet werden (' + (err && err.message ? err.message : 'Netzfehler') + '). Bitte erneut versuchen.', true)
    }).then(function () {
      K.frageKnopf.disabled = false
      K.frageFeld.focus()
    })
  })

  // ================================================================ Statuszeile
  var STATUS_FELD = { toolbox: 'st-toolbox', brain: 'st-brain', telephony: 'st-telephony' }

  function statusSetzen(ev) {
    if (!ev) return
    if (!ev.component) {
      // Altes Prüfstand-Format aus live.ts: nur eine Notiz.
      if (ev.note) K.fussNotiz.textContent = ev.note
      return
    }
    var knoten = $(STATUS_FELD[ev.component])
    if (!knoten) return
    var punkt = knoten.querySelector('.punkt')
    var wert = knoten.querySelector('em')
    punkt.className = 'punkt ' + (ev.ok ? 'ok' : 'risk')
    wert.textContent = ev.detail ? (ev.ok ? 'erreichbar · ' : 'nicht erreichbar · ') + ev.detail
      : (ev.ok ? 'erreichbar' : 'nicht erreichbar')
    wert.className = ev.ok ? 'ton-ok' : 'ton-risk'
  }

  // ================================================================ Anruf
  function allesLeeren(notiz) {
    zeilen = {}
    karten = {}
    warteschlange.length = 0
    leeren(K.transkript)
    K.transkriptRuhe = el('p', 'ruhe', 'Das Transkript erscheint, sobald gesprochen wird.')
    K.transkript.appendChild(K.transkriptRuhe)
    zustand.scrollUnten = true
    K.mitlaufen.hidden = true
    leeren(K.vorschlaege)
    var ruhe = el('article', 'karte')
    ruhe.appendChild(el('p', 'ruhe', 'Noch keine Vorschläge.'))
    ruhe.appendChild(el('p', 'ruhe-klein', 'Während des Gesprächs erscheinen hier Sätze zum Vorlesen, Fakten, nächste Schritte und Warnungen – neueste zuoberst.'))
    K.vorschlaege.appendChild(ruhe)
    leeren(K.briefing)
    var bruhe = el('article', 'karte')
    bruhe.appendChild(el('p', 'ruhe', 'Das Briefing erscheint, sobald der Kunde erkannt ist.'))
    bruhe.appendChild(el('p', 'ruhe-klein', 'Kennzahlen, Mandatsband, offene Verstösse, Vorgehen und häufige Fragen.'))
    K.briefing.appendChild(bruhe)
    leeren(K.kunde)
    K.kunde.className = 'karte kunde'
    K.kunde.appendChild(el('p', 'ruhe', 'Noch kein Kunde erkannt.'))
    K.kunde.appendChild(el('p', 'ruhe-klein', 'Bei einem Anruf wird die Nummer nachgeschlagen und das Dossier erscheint hier.'))
    hinweisWeg()
    if (notiz) K.fussNotiz.textContent = notiz
  }

  function anrufStart(ev) {
    // Nach einer Wiederverbindung schickt der Server denselben Anruf noch einmal – dann darf
    // nichts weggeworfen werden. Nur ein wirklich neuer Anruf leert die Anzeige.
    var derselbe = ev.callId && ev.callId === zustand.callId
    if (!derselbe) allesLeeren('')
    zustand.callId = ev.callId || 'anruf'
    zustand.von = ev.from || ''
    zustand.startMs = zeitstempel(ev.at)
    zustand.laeuft = true
    zustand.beendet = false
    zustand.endGrund = ''
    kopfZeichnen()
  }

  function anrufEnde(ev) {
    zustand.laeuft = false
    zustand.beendet = true
    zustand.letzteDauer = Math.max(0, zeitstempel(ev && ev.at) - zustand.startMs)
    zustand.endGrund = 'Dauer ' + dauer(zustand.letzteDauer) + (ev && ev.reason ? ' · ' + ev.reason : '')
    kopfZeichnen()
  }

  // ================================================================ Ereignisse
  function verarbeiten(ev) {
    if (!ev || !ev.type) return
    switch (ev.type) {
      case 'call.started': anrufStart(ev); break
      case 'client.identified':
        if (ev.callId) zustand.callId = zustand.callId || ev.callId
        kundeZeichnen(ev)
        briefingZeichnen(ev.briefing, !!ev.clientRef)
        break
      case 'transcript.segment': transkriptZeichnen(ev); break
      case 'suggestion': vorschlagAnnehmen(ev); break
      case 'answer': antwortZeigen(ev); break
      case 'call.ended': anrufEnde(ev); break
      case 'status': statusSetzen(ev); break
      // Die beiden alten Prüfstand-Ereignisse aus live.ts, damit die Seite auch vor dem
      // Umbau des Servers etwas Sinnvolles zeigt.
      case 'line':
        transkriptZeichnen({
          lineId: ev.id,
          speaker: ev.speaker === 'assistant' ? 'advisor' : (ev.speaker === 'user' ? 'caller' : 'unknown'),
          text: ev.text,
          final: ev.final,
        })
        break
      case 'reset': allesLeeren(ev.note || ''); break
      default: break
    }
  }

  // ================================================================ Verbindung
  var EREIGNISSE = [
    'call.started', 'client.identified', 'transcript.segment',
    'suggestion', 'answer', 'call.ended', 'status', 'line', 'reset',
  ]

  var quelle = null
  var versuche = 0
  var neuUhr = null

  function aufEreignis(e) {
    var daten = null
    try { daten = JSON.parse(e.data) } catch (err) { return }
    if (!daten || typeof daten !== 'object') return
    if (!daten.type && e.type && e.type !== 'message') daten.type = e.type
    verarbeiten(daten)
  }

  function verbinden() {
    clearTimeout(neuUhr)
    if (quelle) { try { quelle.close() } catch (err) {} }
    verbindungSetzen('verbinde', 'verbinde …')
    try {
      quelle = new EventSource('/events')
    } catch (err) {
      verbindungSetzen('weg', 'keine Verbindung möglich')
      return
    }
    quelle.onopen = function () {
      versuche = 0
      verbindungSetzen('offen', 'verbunden')
    }
    quelle.onerror = function () {
      // EventSource würde selbst neu verbinden; wir machen es selbst, damit der Zustand
      // sichtbar ist und der Abstand zwischen den Versuchen wächst.
      try { quelle.close() } catch (err) {}
      versuche = versuche + 1
      var wartet = Math.min(10000, 1000 * Math.pow(2, versuche - 1))
      verbindungSetzen('weg', 'getrennt – neuer Versuch in ' + Math.round(wartet / 1000) + ' s')
      neuUhr = setTimeout(verbinden, wartet)
    }
    for (var i = 0; i < EREIGNISSE.length; i++) quelle.addEventListener(EREIGNISSE[i], aufEreignis)
    quelle.onmessage = aufEreignis
  }

  // ================================================================ Vorführmodus
  var PARAM = new URLSearchParams(window.location.search)
  var DEMO = PARAM.get('demo') === '1' || PARAM.get('demo') === 'true'

  var DEMO_BRIEFING = [
    { type: 'headline', text: 'Aktienquote 41,5 % – 6,5 Punkte über dem Mandatsband.', sub: 'Seit der letzten Beratung am 14. Mai nicht rebalanciert.' },
    { type: 'metrics', items: [
      { label: 'Vermögen', value: 'CHF 4,82 Mio.', delta: '+2,1 % seit Jahresbeginn', tone: 'ok' },
      { label: 'Strategie', value: 'Ausgewogen' },
      { label: 'Freie Liquidität', value: 'CHF 96 400', delta: '2,0 % des Vermögens', tone: 'info' },
      { label: 'Offene Verstösse', value: '1 Fehler · 2 Warnungen', delta: 'seit 11 Tagen', tone: 'risk' },
      { label: 'Letzte Beratung', value: '14. Mai 2026' },
      { label: 'Dienstleistung', value: 'Anlageberatung' },
    ] },
    { type: 'allocation', title: 'Mandatsband gegen Ist', rows: [
      { label: 'Aktien', min: 0.25, target: 0.30, max: 0.35, actual: 0.415 },
      { label: 'Obligationen', min: 0.40, target: 0.50, max: 0.55, actual: 0.436 },
      { label: 'Immobilien', min: 0.05, target: 0.10, max: 0.15, actual: 0.109 },
      { label: 'Liquidität', min: 0.01, target: 0.05, max: 0.10, actual: 0.020 },
      { label: 'Alternative Anlagen', min: 0.00, target: 0.05, max: 0.08, actual: 0.020 },
    ] },
    { type: 'flags', title: 'Regelwerk', items: [
      { severity: 'risk', text: 'Aktienquote über dem Mandatsband, seit 11 Tagen ungelöst.', source: 'get_violations' },
      { severity: 'warn', text: 'Klumpenrisiko: eine Einzelposition macht 8,4 % des Vermögens aus.', source: 'get_positions_top' },
      { severity: 'warn', text: 'Risikoprofil älter als 24 Monate, Erneuerung ist fällig.', source: 'get_client_overview' },
    ] },
    { type: 'actions', title: 'Vorgehen für dieses Gespräch', items: [
      { text: 'Rückführung der Aktienquote auf 30 % anbieten.', why: 'Bringt das Mandat ins Band zurück und löst den offenen Verstoss.' },
      { text: 'Risikoprofil im Termin erneuern.', why: 'Letzte Erfassung Mai 2024, die Erneuerung ist fällig.' },
    ] },
    { type: 'questions', title: 'Wird erfahrungsgemäss gefragt', items: [
      { q: 'Warum ist die Aktienquote gestiegen?', a: 'Durch Kursgewinne, nicht durch Käufe. Seit Mai wurde nicht rebalanciert.' },
      { q: 'Was kostet das Rebalancing?', a: 'Rund CHF 1 900 Courtage bei vier Transaktionen.' },
    ] },
  ]

  var DEMO_FOLGE = [
    { nach: 200, ereignis: { type: 'status', component: 'telephony', ok: true, detail: 'Vapi verbunden' } },
    { nach: 200, ereignis: { type: 'status', component: 'toolbox', ok: true, detail: '9 Werkzeuge' } },
    { nach: 200, ereignis: { type: 'status', component: 'brain', ok: true, detail: 'Claude bereit' } },
    { nach: 600, ereignis: { type: 'call.started', callId: 'demo', from: '+41791234567', at: '' } },
    { nach: 1400, ereignis: { type: 'client.identified', callId: 'demo', clientRef: 'CH-4471', name: 'Margrit Bühler-Lang', confidence: 'phone', briefing: DEMO_BRIEFING } },
    { nach: 1600, ereignis: { type: 'transcript.segment', callId: 'demo', lineId: 1, speaker: 'caller', text: 'Guten Tag, hier ist', final: false, at: '' } },
    { nach: 800, ereignis: { type: 'transcript.segment', callId: 'demo', lineId: 1, speaker: 'caller', text: 'Guten Tag, hier ist Frau Bühler. Ich habe gesehen, dass die Aktien', final: false, at: '' } },
    { nach: 900, ereignis: { type: 'transcript.segment', callId: 'demo', lineId: 1, speaker: 'caller', text: 'Guten Tag, hier ist Frau Bühler. Ich habe gesehen, dass die Aktien stark gestiegen sind, und mache mir Sorgen.', final: true, at: '' } },
    { nach: 900, ereignis: { type: 'suggestion', callId: 'demo', id: 's1', kind: 'say', severity: 'info',
      text: 'Guten Tag, Frau Bühler. Sie haben recht – Ihre Aktienquote liegt heute bei 41,5 Prozent statt der vereinbarten 30. Soll ich Ihnen zeigen, wie wir das zurückführen?',
      why: 'Ist 41,5 % gegen Band 25–35 %. Der Kunde spricht das Thema selbst an, die Zahl sofort nennen wirkt souverän.',
      sources: ['get_saa_gap', 'get_portfolio_summary'], trigger: 'die Aktien stark gestiegen sind' } },
    { nach: 1300, ereignis: { type: 'transcript.segment', callId: 'demo', lineId: 2, speaker: 'advisor', text: 'Guten Tag, Frau Bühler. Ja, das haben wir auch gesehen.', final: true, at: '' } },
    { nach: 1000, ereignis: { type: 'suggestion', callId: 'demo', id: 's2', kind: 'fact', severity: 'info',
      text: 'Der Anstieg kommt aus Kursgewinnen, nicht aus Käufen. Letztes Rebalancing: 14. Mai 2026.',
      why: 'Wichtig für die Erklärung: es wurde nichts entgegen der Strategie gekauft.',
      sources: ['get_recent_notes', 'get_portfolio_summary'], trigger: 'die Aktien stark gestiegen sind' } },
    { nach: 1500, ereignis: { type: 'transcript.segment', callId: 'demo', lineId: 3, speaker: 'unknown', text: 'Kurze Rückfrage im Hintergrund – wer spricht hier gerade?', final: true, at: '' } },
    { nach: 1400, ereignis: { type: 'transcript.segment', callId: 'demo', lineId: 4, speaker: 'caller', text: 'Und mein Sohn meinte, ich soll alles verkaufen und in Gold gehen.', final: true, at: '' } },
    { nach: 700, ereignis: { type: 'suggestion', callId: 'demo', id: 's3', kind: 'warning', severity: 'risk',
      text: 'Kein Rat zu Gold oder Vollverkauf geben – das liegt ausserhalb des vereinbarten Mandats und des Risikoprofils.',
      why: 'Profil «Ausgewogen», alternative Anlagen maximal 8 %. Ein Vollverkauf wäre eine Strategieänderung und braucht ein neues Profil.',
      sources: ['get_client_overview', 'get_saa_gap'], trigger: 'alles verkaufen und in Gold gehen' } },
    { nach: 1600, ereignis: { type: 'suggestion', callId: 'demo', id: 's4', kind: 'say', severity: 'ok',
      text: 'Statt eines Vollverkaufs schlage ich vor, die Aktienquote von 41,5 auf 30 Prozent zurückzuführen. Damit nehmen Sie die Gewinne mit und bleiben im vereinbarten Rahmen.',
      why: 'Adressiert die Sorge, bleibt im Mandat und löst gleichzeitig den offenen Verstoss.',
      sources: ['get_saa_gap', 'get_open_proposals'], trigger: 'alles verkaufen und in Gold gehen' } },
    { nach: 1800, ereignis: { type: 'suggestion', callId: 'demo', id: 's5', kind: 'next', severity: 'info',
      text: 'Termin zur Erneuerung des Risikoprofils vereinbaren.',
      why: 'Letzte Erfassung Mai 2024. Ohne gültiges Profil lässt sich die Strategie ohnehin nicht ändern.',
      sources: ['get_client_overview'], trigger: 'alles verkaufen und in Gold gehen' } },
    { nach: 2000, frage: 'Wie hoch ist die freie Liquidität?' },
    // Zeigt den ehrlichen Fall: die Daten decken die Frage nicht (supported: false).
    { nach: 3400, frage: 'Wie entwickelt sich der Goldpreis im nächsten Jahr?' },
    { nach: 3400, ereignis: { type: 'transcript.segment', callId: 'demo', lineId: 5, speaker: 'advisor', text: 'Ich schicke Ihnen den Vorschlag noch heute schriftlich zu.', final: true, at: '' } },
    { nach: 1600, ereignis: { type: 'call.ended', callId: 'demo', at: '', reason: 'Kunde aufgelegt' } },
  ]

  function demoAntwort(frage) {
    var klein = String(frage).toLowerCase()
    var gedeckt = klein.indexOf('liquid') >= 0 || klein.indexOf('cash') >= 0 || klein.indexOf('barbestand') >= 0
    setTimeout(function () {
      verarbeiten(gedeckt
        ? { type: 'answer', callId: 'demo', id: 'a' + Date.now(), question: frage, supported: true,
            text: 'Frei verfügbar sind CHF 96 400, das sind 2,0 Prozent des Vermögens. Das Mandat sieht 5 Prozent vor, die Untergrenze liegt bei 1 Prozent.',
            sources: ['get_portfolio_summary', 'get_saa_gap'] }
        : { type: 'answer', callId: 'demo', id: 'a' + Date.now(), question: frage, supported: false,
            text: 'Dazu liegen in der Toolbox keine Daten. Verfügbar sind Übersicht, Portfolio, grösste Positionen, Mandatsband, offene Offerten, Verstösse und Notizen.',
            sources: ['toolbox'] })
    }, 1200)
  }

  function demoStarten() {
    verbindungSetzen('demo', 'Vorführmodus – ohne Server und ohne Telefon')
    var i = 0
    function schritt() {
      if (i >= DEMO_FOLGE.length) {
        K.fussNotiz.textContent = 'Vorführung beendet. Seite neu laden für einen weiteren Durchlauf.'
        return
      }
      var s = DEMO_FOLGE[i]
      i = i + 1
      setTimeout(function () {
        if (s.frage) {
          K.frageFeld.value = s.frage
          K.frageForm.dispatchEvent(new Event('submit', { cancelable: true }))
        } else {
          verarbeiten(s.ereignis)
        }
        schritt()
      }, s.nach)
    }
    schritt()
  }

  // ================================================================ Start
  kopfZeichnen()
  if (DEMO) demoStarten()
  else verbinden()
})()
</script>
</body>
</html>
`
