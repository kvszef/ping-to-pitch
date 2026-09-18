// Prüfstand, nicht Demo-Oberfläche: zeigt, was über den Webhook hereinkommt.
// Die eigentliche Darstellung für die Jury ist die App unter app/.

export const page = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live-Transkript</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; background: #0d0f12; color: #e8eaed; }
  header { position: sticky; top: 0; display: flex; align-items: center; gap: 10px;
           padding: 14px 20px; background: #0d0f12ee; border-bottom: 1px solid #ffffff1a; backdrop-filter: blur(8px); }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #6b7280; flex: none; }
  .dot.on { background: #34d399; box-shadow: 0 0 0 0 #34d39966; animation: pulse 2s infinite; }
  @keyframes pulse { 70% { box-shadow: 0 0 0 9px #34d39900; } 100% { box-shadow: 0 0 0 0 #34d39900; } }
  h1 { margin: 0; font-size: 15px; font-weight: 500; }
  .note { margin-left: auto; font-size: 12px; color: #9aa0a6; }
  main { max-width: 760px; margin: 0 auto; padding: 20px; }
  .line { padding: 9px 0; border-bottom: 1px solid #ffffff0f; }
  .line.partial { opacity: .5; font-style: italic; }
  .who { display: inline-block; min-width: 88px; font-size: 11px; letter-spacing: .04em;
         text-transform: uppercase; color: #7db8ff; vertical-align: top; }
  .who.advisor { color: #69d4d6; }
  .empty { color: #9aa0a6; }
</style>
</head>
<body>
<header>
  <span class="dot" id="dot"></span>
  <h1>Live-Transkript</h1>
  <span class="note" id="note">verbinde …</span>
</header>
<main id="log"><p class="empty" id="empty">Noch nichts gehört. Ruf die Nummer an oder starte <code>npm run simulate</code>.</p></main>
<script>
  const log = document.getElementById('log')
  const note = document.getElementById('note')
  const dot = document.getElementById('dot')
  const empty = document.getElementById('empty')
  const seen = new Map()

  const clear = () => { seen.clear(); for (const el of [...log.children]) if (el !== empty) el.remove(); empty.hidden = false }

  const render = (line) => {
    empty.hidden = true
    let el = seen.get(line.id)
    if (!el) {
      el = document.createElement('p')
      log.append(el)
      seen.set(line.id, el)
    }
    el.className = 'line' + (line.final ? '' : ' partial')
    // Vapi liefert "assistant"/"user", die Bruecke "Berater"/"Kunde" – beide hier benannt.
    const namen = { assistant: 'Assistent', user: 'Anrufer' }
    const advisor = line.speaker === 'assistant' || line.speaker === 'Berater'
    el.innerHTML = '<span class="who' + (advisor ? ' advisor' : '') + '"></span><span></span>'
    el.firstChild.textContent = namen[line.speaker] || line.speaker
    el.lastChild.textContent = line.text
    window.scrollTo(0, document.body.scrollHeight)
  }

  const es = new EventSource('/events')
  es.onopen = () => { dot.classList.add('on'); note.textContent = 'verbunden' }
  es.onerror = () => { dot.classList.remove('on'); note.textContent = 'getrennt – versuche erneut' }
  es.addEventListener('line', (e) => render(JSON.parse(e.data)))
  es.addEventListener('reset', (e) => { clear(); note.textContent = JSON.parse(e.data).note })
  es.addEventListener('status', (e) => { note.textContent = JSON.parse(e.data).note })
</script>
</body>
</html>
`
