// Der Sandkasten: ein Anruf ohne Telefon. Du tippst abwechselnd als Kunde und als Berater,
// alles andere ist echt -- echte Werkzeuge gegen die Kundendatenbank, echtes Modell, echter
// Eintrag ins Dossier am Ende. Die Rolle kommt hier vom Absender, es wird also nichts geraten.
//
// Die Seite ist eine einzige Zeichenkette wie page.ts und copilot.ts: kein Bündler, keine
// Abhängigkeit, Node liefert sie direkt aus. Erreichbar unter /sim.

export const simPage = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anruf-Sandkasten</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,600&family=Public+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
  :root {
    --paper:#eef1f0; --surface:#fff; --surface-2:#f6f8f7; --line:#d3dad8; --line-soft:#e3e8e6;
    --ink:#12181c; --ink-2:#47555a; --ink-3:#6f7d82;
    --accent:#0e6e5c; --accent-ink:#0a4e42; --live:#a8801a;
    --risk:#a3291f; --warn:#8a6410; --ok:#0e6e5c; --info:#3b5b79;
    --f-display:"Newsreader",Georgia,serif;
    --f-body:"Public Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    --f-mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --paper:#0d1114; --surface:#161c20; --surface-2:#1c2429; --line:#2b353a; --line-soft:#222b30;
    --ink:#e7ecea; --ink-2:#a3b0b3; --ink-3:#78868a;
    --accent:#4fb8a1; --accent-ink:#7fd0bc; --live:#d9b03f;
    --risk:#e0786c; --warn:#d3a84a; --ok:#4fb8a1; --info:#7fa8cc;
  } }
  :root[data-theme="dark"] {
    --paper:#0d1114; --surface:#161c20; --surface-2:#1c2429; --line:#2b353a; --line-soft:#222b30;
    --ink:#e7ecea; --ink-2:#a3b0b3; --ink-3:#78868a;
    --accent:#4fb8a1; --accent-ink:#7fd0bc; --live:#d9b03f;
    --risk:#e0786c; --warn:#d3a84a; --ok:#4fb8a1; --info:#7fa8cc;
  }

  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font-family:var(--f-body); font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1520px; margin:0 auto; padding:0 20px 56px; }

  .bar { position:sticky; top:0; z-index:20; background:color-mix(in srgb,var(--paper) 90%,transparent);
         backdrop-filter:blur(10px); border-bottom:1px solid var(--line); margin:0 -20px 22px; padding:13px 20px; }
  .bar-in { max-width:1480px; margin:0 auto; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
  .brand { display:flex; align-items:baseline; gap:10px; margin-right:auto; }
  .brand h1 { font-family:var(--f-display); font-weight:600; font-size:21px; margin:0; letter-spacing:-.01em; }
  .brand .num { font-family:var(--f-mono); font-size:12.5px; color:var(--ink-3); }
  .state { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--ink-2); }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--ink-3); flex:none; }
  .laeuft .dot { background:var(--live); animation:puls 1.6s ease-in-out infinite; }
  @keyframes puls { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.35;transform:scale(.8)} }
  .clock { font-family:var(--f-mono); font-variant-numeric:tabular-nums; font-size:15px; }

  button { font:inherit; font-size:13px; color:var(--ink); background:var(--surface);
           border:1px solid var(--line); padding:7px 13px; border-radius:7px; cursor:pointer; transition:border-color .15s; }
  button:hover:not(:disabled) { border-color:var(--accent); }
  button:disabled { opacity:.45; cursor:not-allowed; }
  button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:500; }
  :root[data-theme="dark"] .primary { color:#08110f; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .primary { color:#08110f; } }
  .beenden { border-color:var(--risk); color:var(--risk); }

  .console { display:grid; gap:18px; grid-template-columns:1fr; align-items:start; }
  @media (min-width:1120px) { .console { grid-template-columns:1.05fr 1.2fr 1fr; } }
  .col { display:flex; flex-direction:column; gap:12px; min-width:0; }
  .col > h2 { font-size:11px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-3);
              margin:0; padding-bottom:8px; border-bottom:1px solid var(--line-soft);
              display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
  .col > h2 span { font-family:var(--f-mono); letter-spacing:0; text-transform:none; font-weight:400; }
  .panel { background:var(--surface); border:1px solid var(--line-soft); border-radius:10px; padding:14px 15px; }
  .scroller { max-height:46vh; min-height:120px; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; gap:10px; }

  /* Eingabe */
  .sprechen { display:flex; flex-direction:column; gap:10px; }
  .rollenwahl { display:flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .rollenwahl button { border:0; border-radius:0; flex:1; padding:9px 10px; font-weight:500; background:var(--surface); }
  .rollenwahl button + button { border-left:1px solid var(--line); }
  .rollenwahl button[aria-pressed="true"][data-rolle="caller"] { background:color-mix(in srgb,var(--info) 16%,var(--surface)); color:var(--info); }
  .rollenwahl button[aria-pressed="true"][data-rolle="advisor"] { background:color-mix(in srgb,var(--accent) 16%,var(--surface)); color:var(--accent-ink); }
  textarea { font:inherit; font-size:14.5px; color:var(--ink); background:var(--surface-2);
             border:1px solid var(--line); border-radius:8px; padding:10px 12px; resize:vertical; min-height:74px; width:100%; }
  textarea:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
  .zeile { display:flex; gap:8px; align-items:center; }
  .zeile .hinweis { font-size:12px; color:var(--ink-3); margin-left:auto; }
  .vorschlaege-kurz { display:flex; flex-wrap:wrap; gap:6px; }
  .vorschlaege-kurz button { font-size:12px; padding:5px 9px; color:var(--ink-2); }

  /* Transkript */
  .turn { display:grid; grid-template-columns:58px 1fr; gap:10px; align-items:start; animation:rein .35s ease both; }
  @keyframes rein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
  .turn .rolle { font-size:10.5px; font-weight:600; letter-spacing:.07em; text-transform:uppercase; padding-top:3px; text-align:right; }
  .turn.caller .rolle { color:var(--info); }
  .turn.advisor .rolle { color:var(--accent); }
  .turn.unknown .rolle { color:var(--ink-3); }
  .turn p { margin:0; font-size:14.5px; }
  .turn.advisor p { color:var(--ink-2); }

  /* Kunde und Briefing */
  .client { border-left:3px solid var(--accent); }
  .client h3 { font-family:var(--f-display); font-size:19px; font-weight:600; margin:0; }
  .client .ref { font-family:var(--f-mono); font-size:12px; color:var(--ink-3); }
  .sicher { display:inline-block; font-size:10.5px; font-weight:600; letter-spacing:.04em; text-transform:uppercase;
            color:var(--ok); background:color-mix(in srgb,var(--ok) 12%,transparent); padding:3px 9px; border-radius:20px; }
  .brief-kopf { font-family:var(--f-display); font-size:16.5px; line-height:1.4; margin:0 0 6px; text-wrap:balance; }
  .brief-sub { font-size:13px; color:var(--ink-2); margin:0; }
  .metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:1px; background:var(--line-soft); border-radius:8px; overflow:hidden; margin-top:14px; }
  .metric { background:var(--surface); padding:9px 11px; }
  .metric dt { font-size:10.5px; letter-spacing:.04em; text-transform:uppercase; color:var(--ink-3); margin:0 0 3px; }
  .metric dd { margin:0; font-size:14px; font-weight:500; font-variant-numeric:tabular-nums; }
  .metric[data-tone="risk"] dd { color:var(--risk); }
  .metric[data-tone="warn"] dd { color:var(--warn); }
  .metric[data-tone="ok"] dd { color:var(--ok); }
  .kartentitel { font-size:10.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-3); margin:18px 0 9px; }
  .flag { display:grid; grid-template-columns:4px 1fr; gap:10px; font-size:13.5px; margin-bottom:10px; }
  .flag i { display:block; border-radius:2px; background:var(--warn); }
  .flag[data-sev="risk"] i { background:var(--risk); }
  .flag[data-sev="info"] i { background:var(--info); }
  .flag p { margin:0; }
  .flag .q { font-family:var(--f-mono); font-size:11px; color:var(--ink-3); }
  .band { display:grid; grid-template-columns:1fr; gap:3px; margin-bottom:9px; font-size:13px; }
  .band .kopf { display:flex; justify-content:space-between; gap:10px; }
  .band .kopf b { font-weight:500; }
  .band .kopf span { font-family:var(--f-mono); font-size:12px; font-variant-numeric:tabular-nums; }
  .spur { position:relative; height:9px; background:var(--surface-2); border:1px solid var(--line-soft); border-radius:5px; }
  .spur .zone { position:absolute; top:0; bottom:0; background:color-mix(in srgb,var(--ok) 20%,transparent); }
  .spur .ziel { position:absolute; top:-2px; bottom:-2px; width:2px; background:var(--ink-3); }
  .spur .ist { position:absolute; top:1px; bottom:1px; width:3px; border-radius:2px; background:var(--ok); }
  .spur .ist.draussen { background:var(--risk); }

  /* Vorschläge */
  .vor { border:1px solid var(--line-soft); border-left:3px solid var(--info); border-radius:10px;
         padding:12px 13px; background:var(--surface); animation:rein .4s ease both; }
  .vor[data-kind="say"] { background:color-mix(in srgb,var(--accent) 8%,var(--surface)); border-left-color:var(--accent); }
  .vor[data-kind="warning"] { background:color-mix(in srgb,var(--warn) 9%,var(--surface)); border-left-color:var(--warn); }
  .vor[data-kind="next"] { border-left-color:var(--ink-3); }
  .vor .art { display:inline-block; font-size:10.5px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3); margin-bottom:5px; }
  .vor[data-kind="say"] .art { color:var(--accent-ink); }
  .vor[data-kind="warning"] .art { color:var(--warn); }
  .vor .text { margin:0; font-size:14.5px; }
  .vor[data-kind="say"] .text { font-size:15.5px; font-weight:500; }
  .vor .q { margin:7px 0 0; font-family:var(--f-mono); font-size:11px; color:var(--ink-3); word-break:break-all; }
  .vor .trig { margin:5px 0 0; font-size:12px; color:var(--ink-3); font-style:italic; }

  /* Agentenspur */
  .log { display:flex; flex-direction:column; font-family:var(--f-mono); font-size:12px; }
  .ev { display:grid; grid-template-columns:44px 1fr; gap:9px; padding:6px 0; border-bottom:1px solid var(--line-soft); animation:rein .25s ease both; }
  .ev:last-child { border-bottom:0; }
  .ev time { color:var(--ink-3); font-variant-numeric:tabular-nums; }
  .ev .was { color:var(--ink-2); word-break:break-word; }
  .ev[data-kind="tool"] .was { color:var(--accent-ink); }
  .ev[data-kind="model"] .was { color:var(--info); }
  .ev[data-kind="result"] .was { color:var(--ok); }
  .ev .ms { color:var(--ink-3); }

  .dossier { border-left:3px solid var(--live); }
  .dossier .alt { font-size:12.5px; color:var(--ink-3); margin:0 0 9px; }
  .dossier .neu { font-size:13.5px; margin:0; padding:10px 12px; border-radius:8px; background:color-mix(in srgb,var(--live) 12%,var(--surface)); }

  .ruhe { color:var(--ink-3); font-size:13.5px; margin:0; }
  .fehler { color:var(--risk); font-size:12.5px; margin:6px 0 0; }
  .fuss { margin-top:34px; padding-top:22px; border-top:1px solid var(--line); font-size:13.5px; color:var(--ink-2); max-width:70ch; }
  .fuss b { color:var(--ink); }
  .fuss p { margin:0 0 9px; }
  @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
</style>
</head>
<body>

<div class="bar" id="bar">
  <div class="bar-in">
    <div class="brand"><h1>Anruf-Sandkasten</h1><span class="num" id="nummer">+41 79 123 45 67</span></div>
    <div class="state"><span class="dot"></span><span id="zustand">bereit</span></div>
    <span class="clock" id="uhr">00:00</span>
    <button class="primary" id="starten">Anruf starten</button>
    <button class="beenden" id="beenden" disabled>Auflegen</button>
  </div>
</div>

<div class="wrap">
  <div class="console">

    <section class="col">
      <h2>Sprechen <span id="zaehler">0 Beiträge</span></h2>
      <div class="panel sprechen">
        <div class="rollenwahl" role="group" aria-label="Rolle">
          <button data-rolle="caller" aria-pressed="true">Als Kunde</button>
          <button data-rolle="advisor" aria-pressed="false">Als Berater</button>
        </div>
        <textarea id="text" placeholder="Was gesagt wird. Enter schickt ab, Umschalt+Enter macht eine neue Zeile." disabled></textarea>
        <div class="zeile">
          <button class="primary" id="senden" disabled>Abschicken</button>
          <span class="hinweis" id="rollenhinweis">Nur Kundenaussagen lösen Vorschläge aus.</span>
        </div>
        <div class="vorschlaege-kurz" id="bausteine"></div>
        <p class="fehler" id="fehler" hidden></p>
      </div>
      <div class="panel scroller" id="transkript"><p class="ruhe">Noch kein Anruf. Oben auf «Anruf starten» drücken.</p></div>
    </section>

    <section class="col">
      <h2>Was der Berater sieht <span id="vorzaehler">0 Vorschläge</span></h2>
      <div class="panel client" id="kunde"><p class="ruhe">Kein Kunde erkannt.</p></div>
      <div class="panel dossier" id="dossier" hidden></div>
      <div class="panel" id="briefing"><p class="ruhe">Das Briefing entsteht, sobald der Anruf läuft.</p></div>
      <div id="vorschlaege" style="display:flex;flex-direction:column;gap:11px"></div>
    </section>

    <section class="col">
      <h2>Was der Agent tut <span id="schrittzaehler">0 Schritte</span></h2>
      <div class="panel scroller" style="max-height:72vh"><div class="log" id="log"><p class="ruhe">Sobald etwas passiert, steht es hier.</p></div></div>
    </section>

  </div>

  <footer class="fuss">
    <p><b>Hier ist alles echt ausser dem Telefon.</b> Jede Aussage geht denselben Weg wie ein echter Anruf: durch die Rollenzuordnung, die Werkzeuge gegen die Kundendatenbank und das Sprachmodell. Die rechte Spalte zeigt jeden Werkzeugaufruf und jeden Modellaufruf mit gemessener Dauer.</p>
    <p><b>Die Rolle kommt hier vom Absender</b>, nicht aus dem Inhalt. Am Telefon muss der Copilot raten, wer spricht; im Sandkasten weisst du es, und deshalb bleibt die Zuordnung sicher.</p>
    <p><b>Beim Auflegen wird ins Dossier geschrieben.</b> Das Modell fasst das Gespräch zusammen, der Text wird an den Freitext des Kunden angehängt und steht beim nächsten Anruf im Briefing. Das Gespräch wird ausserdem als Datei unter <code>data/calls/</code> abgelegt.</p>
  </footer>
</div>

<script>
const $ = (id) => document.getElementById(id);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
const esc = (s) => String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const pct = (f) => (f * 100).toFixed(1).replace(".", ",") + " %";

const BAUSTEINE = {
  caller: [
    "Ich habe den Depotauszug angeschaut und mich gefragt, ob bei mir noch alles im Rahmen ist.",
    "Mir ist aufgefallen, dass ich fast nur noch Aktien drin habe. Ist das nicht zu viel?",
    "Die Oerlikon-Position kommt mir gross vor. Ist das nicht ein Klumpenrisiko?",
    "Ich hatte nach einem nachhaltigen Schweizer Fonds gefragt. Ist da etwas passiert?",
    "Denken Sie daran, ich brauche Anfang 2027 rund achtzig Tausend Franken für die Wohnung.",
  ],
  advisor: [
    "Grüezi Herr Muster, was kann ich für Sie tun?",
    "Das schaue ich mir gerade mit Ihnen an.",
    "Das ist notiert, dazu liegt bereits ein Entwurf bereit.",
    "Ich melde mich diese Woche mit dem Vorschlag.",
  ],
};

let rolle = "caller", laeuft = false, callId = null, sekunden = 0, uhrId = null;
let beitraege = 0, vorschlaege = 0, schritte = 0, briefingDa = false;

// ------------------------------------------------------------------ Anzeige
function zaehlerSetzen() {
  $("zaehler").textContent = beitraege + (beitraege === 1 ? " Beitrag" : " Beiträge");
  $("vorzaehler").textContent = vorschlaege + (vorschlaege === 1 ? " Vorschlag" : " Vorschläge");
  $("schrittzaehler").textContent = schritte + (schritte === 1 ? " Schritt" : " Schritte");
}

function uhrStellen() {
  $("uhr").textContent = String(Math.floor(sekunden / 60)).padStart(2, "0") + ":" + String(sekunden % 60).padStart(2, "0");
}

function bausteineZeigen() {
  const box = $("bausteine");
  box.innerHTML = "";
  for (const s of BAUSTEINE[rolle]) {
    const b = el("button", null, esc(s.length > 46 ? s.slice(0, 44) + "…" : s));
    b.title = s;
    b.addEventListener("click", () => { $("text").value = s; $("text").focus(); });
    box.append(b);
  }
}

function rolleSetzen(neu) {
  rolle = neu;
  document.querySelectorAll(".rollenwahl button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.rolle === neu)));
  $("rollenhinweis").textContent = neu === "caller"
    ? "Kundenaussagen lösen Vorschläge aus."
    : "Beraterzeilen laufen mit, lösen aber nichts aus.";
  bausteineZeigen();
}

function beitragZeigen(speaker, text) {
  if (!beitraege) $("transkript").innerHTML = "";
  const t = el("div", "turn " + speaker);
  const name = speaker === "caller" ? "Kunde" : speaker === "advisor" ? "Berater" : "unklar";
  t.append(el("div", "rolle", name), el("p", null, esc(text)));
  $("transkript").append(t);
  $("transkript").scrollTop = 1e6;
  beitraege++;
  zaehlerSetzen();
}

function schrittZeigen(e) {
  if (!schritte) $("log").innerHTML = "";
  const d = new Date(e.at || Date.now());
  const n = el("div", "ev");
  n.dataset.kind = e.kind || "info";
  n.append(
    el("time", null, String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0")),
    el("div", "was", esc(e.text) + (e.ms != null ? ' <span class="ms">' + e.ms.toLocaleString("de-CH") + " ms</span>" : ""))
  );
  $("log").append(n);
  const box = $("log").parentElement;
  box.scrollTop = 1e6;
  schritte++;
  zaehlerSetzen();
}

function kundeZeigen(e) {
  const k = $("kunde");
  if (!e.clientRef) {
    k.innerHTML = '<p class="ruhe">Diese Nummer steht in keinem Kundendatensatz. Es wird kein Dossier angezeigt.</p>';
    return;
  }
  const grad = { phone: "über die Nummer erkannt", name: "über den Namen erkannt", manual: "vorausgewählt", unknown: "unsicher" }[e.confidence] || e.confidence;
  k.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap">' +
    "<h3>" + esc(e.name || e.clientRef) + '</h3><span class="sicher">' + esc(grad) + "</span></div>" +
    '<div class="ref">' + esc(e.clientRef) + "</div>";
}

function briefingZeigen(karten) {
  const z = $("briefing");
  z.innerHTML = "";
  for (const k of karten) {
    if (k.type === "headline") {
      z.append(el("p", "brief-kopf", esc(k.text)));
      if (k.sub) z.append(el("p", "brief-sub", esc(k.sub)));
    } else if (k.type === "metrics") {
      const d = el("dl", "metrics");
      for (const m of k.items) {
        const c = el("div", "metric");
        c.dataset.tone = m.tone || "info";
        c.append(el("dt", null, esc(m.label)), el("dd", null, esc(m.value)));
        d.append(c);
      }
      z.append(d);
    } else if (k.type === "allocation") {
      z.append(el("p", "kartentitel", esc(k.title || "Soll und Ist")));
      const max = Math.max(1, ...k.rows.map((r) => Math.max(r.max || 0, r.actual || 0)));
      for (const r of k.rows) {
        const draussen = r.actual < r.min || r.actual > r.max;
        const b = el("div", "band");
        b.append(el("div", "kopf", "<b>" + esc(r.label) + "</b><span>" + pct(r.actual) +
          " · Band " + pct(r.min) + " bis " + pct(r.max) + "</span>"));
        const spur = el("div", "spur");
        spur.append(
          el("i", "zone", ""), el("i", "ziel", ""), el("i", "ist" + (draussen ? " draussen" : ""), "")
        );
        const [zone, ziel, ist] = spur.children;
        zone.style.left = (r.min / max * 100) + "%";
        zone.style.width = ((r.max - r.min) / max * 100) + "%";
        ziel.style.left = (r.target / max * 100) + "%";
        ist.style.left = "calc(" + (r.actual / max * 100) + "% - 1px)";
        b.append(spur);
        z.append(b);
      }
    } else {
      z.append(el("p", "kartentitel", esc(k.title || "")));
      for (const i of k.items) {
        if (k.type === "flags") {
          const f = el("div", "flag");
          f.dataset.sev = i.severity;
          f.append(el("i"), el("div", null, "<p>" + esc(i.text) + '</p><p class="q">' + esc(i.source) + "</p>"));
          z.append(f);
        } else if (k.type === "questions") {
          z.append(el("div", "flag", '<i style="background:var(--info)"></i><div><p><b>' + esc(i.q) + "</b></p><p>" + esc(i.a) + "</p></div>"));
        } else {
          z.append(el("div", "flag", '<i style="background:var(--accent)"></i><div><p>' + esc(i.text) + '</p><p class="q">' + esc(i.why) + "</p></div>"));
        }
      }
    }
  }
  briefingDa = true;
}

const ART = { say: "Das können Sie sagen", fact: "Fakt", next: "Nächster Schritt", warning: "Achtung" };

function vorschlagZeigen(v) {
  const n = el("div", "vor");
  n.dataset.kind = v.kind;
  n.append(el("span", "art", ART[v.kind] || v.kind), el("p", "text", esc(v.text)));
  if (v.why) n.append(el("p", "trig", esc(v.why)));
  if (v.trigger) n.append(el("p", "trig", "ausgelöst durch: „" + esc(String(v.trigger).slice(0, 64)) + "“"));
  if (v.sources && v.sources.length) n.append(el("p", "q", "Quelle: " + esc(v.sources.join(", "))));
  $("vorschlaege").prepend(n);
  vorschlaege++;
  zaehlerSetzen();
}

function antwortZeigen(a) {
  const n = el("div", "vor");
  n.dataset.kind = a.supported ? "fact" : "warning";
  n.append(el("span", "art", a.supported ? "Antwort" : "Nicht gedeckt"), el("p", "text", esc(a.text)));
  n.append(el("p", "trig", "auf die Frage: „" + esc(a.question) + "“"));
  if (a.sources && a.sources.length) n.append(el("p", "q", "Quelle: " + esc(a.sources.join(", "))));
  $("vorschlaege").prepend(n);
}

// ------------------------------------------------------------------ Ereignisstrom
let quelle = null;
function verbinden() {
  if (quelle) quelle.close();
  quelle = new EventSource("/events");
  const on = (name, fn) => quelle.addEventListener(name, (ev) => { try { fn(JSON.parse(ev.data)); } catch (e) { /* kaputte Zeile überspringen */ } });

  on("call.started", (e) => {
    callId = e.callId;
    laeuft = true;
    sekunden = 0; uhrStellen();
    $("bar").classList.add("laeuft");
    $("zustand").textContent = "Anruf läuft";
    $("nummer").textContent = e.from || "unbekannt";
    $("starten").disabled = true;
    $("beenden").disabled = false;
    $("text").disabled = false;
    $("senden").disabled = false;
    if (uhrId) clearInterval(uhrId);
    uhrId = setInterval(() => { sekunden++; uhrStellen(); }, 1000);
    $("text").focus();
  });
  on("client.identified", (e) => { kundeZeigen(e); if (e.briefing && e.briefing.length) briefingZeigen(e.briefing); });
  on("transcript.segment", (e) => { if (e.final) beitragZeigen(e.speaker, e.text); });
  on("agent.step", schrittZeigen);
  on("suggestion", vorschlagZeigen);
  on("answer", antwortZeigen);
  on("call.ended", () => {
    laeuft = false;
    if (uhrId) clearInterval(uhrId);
    $("bar").classList.remove("laeuft");
    $("zustand").textContent = "aufgelegt";
    $("starten").disabled = false;
    $("beenden").disabled = true;
    $("text").disabled = true;
    $("senden").disabled = true;
  });
  on("status", (e) => {
    if (e.component === "toolbox" && e.detail && e.detail.indexOf("Dossier") >= 0) dossierZeigen(e.detail);
  });

  quelle.onerror = () => { $("zustand").textContent = "Verbindung unterbrochen"; };
}

function dossierZeigen(text) {
  const d = $("dossier");
  d.hidden = false;
  d.innerHTML = '<p class="kartentitel" style="margin-top:0;color:var(--live)">Ins Dossier geschrieben</p><p class="neu">' + esc(text) + "</p>";
}

// ------------------------------------------------------------------ Steuerung
async function ruf(pfad, daten) {
  $("fehler").hidden = true;
  try {
    const r = await fetch("/api/sim/" + pfad, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(daten || {}) });
    if (!r.ok) {
      const t = await r.text();
      $("fehler").textContent = "Server antwortet " + r.status + ": " + t.slice(0, 160);
      $("fehler").hidden = false;
      return false;
    }
    return true;
  } catch (e) {
    $("fehler").textContent = "Der Dienst ist nicht erreichbar. Läuft npm run dev?";
    $("fehler").hidden = false;
    return false;
  }
}

function zuruecksetzen() {
  beitraege = 0; vorschlaege = 0; schritte = 0; briefingDa = false;
  $("transkript").innerHTML = '<p class="ruhe">Der Anruf steht. Schreib als Kunde oder als Berater.</p>';
  $("vorschlaege").innerHTML = "";
  $("log").innerHTML = '<p class="ruhe">Wartet auf den ersten Schritt …</p>';
  $("briefing").innerHTML = '<p class="ruhe">Das Briefing wird gerade gebaut …</p>';
  $("kunde").innerHTML = '<p class="ruhe">Die Nummer wird nachgeschlagen …</p>';
  $("dossier").hidden = true;
  zaehlerSetzen();
}

$("starten").addEventListener("click", async () => {
  zuruecksetzen();
  await ruf("start", {});
});
$("beenden").addEventListener("click", async () => {
  $("zustand").textContent = "legt auf, Dossier wird geschrieben …";
  await ruf("end", {});
});
$("senden").addEventListener("click", senden);
$("text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); senden(); }
});
async function senden() {
  const text = $("text").value.trim();
  if (!text || !laeuft) return;
  $("text").value = "";
  const ok = await ruf("say", { text, speaker: rolle });
  if (!ok) $("text").value = text;
}
document.querySelectorAll(".rollenwahl button").forEach((b) => b.addEventListener("click", () => rolleSetzen(b.dataset.rolle)));

rolleSetzen("caller");
zaehlerSetzen();
verbinden();
</script>
</body>
</html>
`
