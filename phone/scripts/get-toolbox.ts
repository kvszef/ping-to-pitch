#!/usr/bin/env node
// Laedt das passende Binary von MCP Toolbox for Databases nach phone/bin/.
//
// Toolbox ist ein einzelnes statisches Go-Programm ohne Installer: eine Datei aus dem
// oeffentlichen Google-Storage-Bucket, fertig. Deshalb kein npm-Paket und keine Abhaengigkeit.
//
//   node scripts/get-toolbox.ts          laedt, wenn noch nicht da
//   node scripts/get-toolbox.ts --force  laedt in jedem Fall neu
//
// Danach startet `npm run toolbox` den Dienst mit toolbox/tools.yaml.

import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Version von MCP Toolbox. Hier anheben, sonst nirgends. */
const VERSION = '1.12.0'

/** Woher die Binaries kommen. Muster: <BASIS>/v<VERSION>/<os>/<arch>/toolbox[.exe] */
const BASIS = 'https://storage.googleapis.com/mcp-toolbox-for-databases'

const phoneVerzeichnis = resolve(import.meta.dirname, '..')
const binVerzeichnis = join(phoneVerzeichnis, 'bin')

/** process.platform/process.arch auf die Namen im Bucket abbilden. */
function ziel(): { os: string; arch: string; datei: string } {
  const os = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform as string]
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch as string]

  if (!os || !arch) {
    console.error(
      `Fuer ${process.platform}/${process.arch} gibt es kein Toolbox-Binary.\n` +
        'Unterstuetzt sind linux, darwin und windows, jeweils amd64 und arm64.\n' +
        'Selbst bauen: https://github.com/googleapis/mcp-toolbox',
    )
    process.exit(1)
  }
  return { os, arch, datei: os === 'windows' ? 'toolbox.exe' : 'toolbox' }
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

const { os, arch, datei } = ziel()
const pfad = join(binVerzeichnis, datei)
const erzwingen = process.argv.includes('--force')

if (existsSync(pfad) && !erzwingen) {
  console.log(`Toolbox liegt schon da: bin/${datei} (${mb(statSync(pfad).size)})`)
  console.log('Neu laden mit: node scripts/get-toolbox.ts --force')
  process.exit(0)
}

const url = `${BASIS}/v${VERSION}/${os}/${arch}/${datei}`
console.log(`Lade Toolbox ${VERSION} fuer ${os}/${arch} ...`)
console.log(`  ${url}`)

const antwort = await fetch(url)
if (!antwort.ok) {
  console.error(`\nDownload fehlgeschlagen: HTTP ${antwort.status} ${antwort.statusText}`)
  console.error(`Gibt es Version ${VERSION} wirklich? Siehe https://github.com/googleapis/mcp-toolbox/releases`)
  process.exit(1)
}

const bytes = Buffer.from(await antwort.arrayBuffer())
mkdirSync(binVerzeichnis, { recursive: true })

// Erst daneben schreiben, dann umbenennen: ein Abbruch hinterlaesst so keine halbe Datei,
// die spaeter als "schon vorhanden" durchgeht.
const temporaer = pfad + '.download'
writeFileSync(temporaer, bytes)
if (process.platform !== 'win32') chmodSync(temporaer, 0o755)
rmSync(pfad, { force: true })
renameSync(temporaer, pfad)

console.log(`Fertig: bin/${datei} (${mb(bytes.length)})`)
console.log('Starten mit: npm run toolbox')
