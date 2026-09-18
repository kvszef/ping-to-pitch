#!/usr/bin/env node
// Startet MCP Toolbox mit toolbox/tools.yaml und reicht Ein- und Ausgabe durch.
//
//   npm run toolbox            Dienst auf http://127.0.0.1:5000
//   npm run toolbox -- -p 5100 alles hinter -- geht unveraendert an das Binary
//
// Was danach erreichbar ist:
//   http://127.0.0.1:5000/ui                       Testoberflaeche, alle Werkzeuge anklickbar
//   http://127.0.0.1:5000/mcp/call_copilot         das Toolset, das die Anwendung laedt
//   POST /api/tool/{name}/invoke                   die REST-Schnittstelle aus src/copilot/types.ts
//
// Zwei Schalter sind nicht optional: --ui schaltet die Oberflaeche frei, --enable-api die
// REST-Schnittstelle. Ohne --enable-api antwortet /api/tool/... mit 404, und der ToolboxClient
// bekommt nichts. Hot Reload ist von Haus aus an, Aenderungen an tools.yaml greifen also sofort.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const phoneVerzeichnis = resolve(import.meta.dirname, '..')
const datei = process.platform === 'win32' ? 'toolbox.exe' : 'toolbox'
const binaer = join(phoneVerzeichnis, 'bin', datei)
const konfig = join(phoneVerzeichnis, 'toolbox', 'tools.yaml')

if (!existsSync(binaer)) {
  console.error(`Das Toolbox-Binary fehlt (erwartet: bin/${datei}).`)
  console.error('Einmalig holen mit:  npm run toolbox:get')
  process.exit(1)
}

if (!existsSync(konfig)) {
  console.error('toolbox/tools.yaml fehlt. Ohne Konfiguration gibt es keine Werkzeuge.')
  process.exit(1)
}

// Der Pfad in ${UNRISK_DB:./data/unrisk.db} ist relativ, also muss phone/ das Arbeitsverzeichnis
// sein - egal, von wo aus jemand das Skript aufruft.
const db = process.env.UNRISK_DB ?? './data/unrisk.db'
const dbAbsolut = resolve(phoneVerzeichnis, db)
if (!existsSync(dbAbsolut)) {
  console.warn(`Hinweis: ${db} gibt es noch nicht. Toolbox startet trotzdem, aber jedes Werkzeug`)
  console.warn('scheitert, bis die Datenbank da ist. Anlegen mit:  npm run load-data')
}

const argumente = [
  '--config',
  'toolbox/tools.yaml',
  '--ui',
  '--enable-api',
  ...process.argv.slice(2),
]

console.log(`Toolbox startet mit toolbox/tools.yaml auf ${db}`)
console.log('Oberflaeche: http://127.0.0.1:5000/ui   Beenden: Strg+C')

const kind = spawn(binaer, argumente, { cwd: phoneVerzeichnis, stdio: 'inherit' })

kind.on('error', (fehler) => {
  console.error('Toolbox liess sich nicht starten:', fehler.message)
  console.error('Binary neu laden mit:  npm run toolbox:get -- --force')
  process.exit(1)
})

// Strg+C soll das Kind treffen, nicht nur uns: sonst bleibt der Port belegt.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => kind.kill(signal))
}

kind.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0))
})
