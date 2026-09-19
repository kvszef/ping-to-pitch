#!/usr/bin/env node
// One command for the demo: `npm run demo` (in app/).
// Starts the app in stage mode (no hot reload, port 5190), the client-data toolbox if it was set up
// (phone/bin + phone/data; without it the app reads the case files), and a cloudflared tunnel so the
// client's phone reaches the app over HTTPS (the mic needs it). Prints both links. Ctrl+C stops all.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PORT = 5190
const LOCAL = `http://localhost:${PORT}`
const app = resolve(import.meta.dirname, '..')
const phone = resolve(app, '..', 'phone')
const win = process.platform === 'win32'
const children = []

function start(name, cmd, args, cwd, onText, only) {
  const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  const read = (chunk) => {
    const text = chunk.toString()
    for (const line of text.split(/\r?\n/)) if (line.trim() && (!only || only.test(line))) console.log(`[${name}] ${line}`)
    onText?.(text)
  }
  child.stdout.on('data', read)
  child.stderr.on('data', read)
  child.on('error', (e) => console.error(`[${name}] could not start: ${e.message}`))
  child.on('exit', (code) => { if (!stopping) console.error(`[${name}] stopped (code ${code})`) })
  return child
}

let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  for (const c of children) {
    if (c.exitCode !== null || !c.pid) continue
    // Windows: kill the whole tree, or vite's and cloudflared's own children keep the ports.
    if (win) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' })
    else c.kill()
  }
  process.exit(0)
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, stop)

// cloudflared: on the PATH, or where winget puts it (a fresh install is not on the PATH of an open terminal).
function findCloudflared() {
  const places = win
    ? [join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'), 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe']
    : ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared']
  const onPath = (process.env.PATH ?? '').split(win ? ';' : ':').map((d) => join(d, win ? 'cloudflared.exe' : 'cloudflared'))
  return [...onPath, ...places].find((p) => existsSync(p))
}

async function waitFor(url, ms = 60_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { await fetch(url); return true } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  return false
}

// A new tunnel name needs some seconds to exist. Asked over DNS-over-HTTPS and not the system resolver: a link
// opened too early makes Windows remember "not found" for minutes.
// Resolvers remember "not found" too, so the first question waits and the two resolvers take turns.
async function resolves(host, ms = 90_000) {
  const end = Date.now() + ms
  const ask = [`https://dns.google/resolve?name=${host}&type=A`, `https://cloudflare-dns.com/dns-query?name=${host}&type=A`]
  await new Promise((r) => setTimeout(r, 15_000))
  for (let n = 0; Date.now() < end; n++) {
    try {
      const r = await fetch(ask[n % 2], { headers: { accept: 'application/dns-json' } })
      if (((await r.json()).Answer ?? []).length) return true
    } catch { /* try again */ }
    await new Promise((r) => setTimeout(r, 5000))
  }
  return false
}

function banner(tunnel) {
  const line = '='.repeat(64)
  console.log(`\n${line}`)
  console.log(`  Advisor (this laptop):  ${LOCAL}`)
  if (tunnel) {
    console.log(`  Client phone:           ${tunnel}/call.html`)
    console.log(`  Advisor from anywhere:  ${tunnel}`)
  } else {
    console.log('  Client phone:           no tunnel (cloudflared is missing)')
    console.log(`  Install once:           ${win ? 'winget install --id Cloudflare.cloudflared' : 'brew install cloudflared'}`)
  }
  console.log('  Stop everything:        Ctrl+C')
  console.log(`${line}\n`)
}

// 1. Toolbox (optional)
const toolbox = join(phone, 'bin', win ? 'toolbox.exe' : 'toolbox')
if (existsSync(toolbox) && existsSync(join(phone, 'data', 'unrisk.db'))) {
  start('toolbox', toolbox, ['--config', 'toolbox/tools.yaml', '--ui', '--enable-api'], phone)
  await waitFor('http://127.0.0.1:5000/ui', 15_000)
} else {
  console.log('[toolbox] not set up, the app reads the case files (fine for the demo)')
}

// 2. App (an app that already runs on the port is reused, not started twice)
if (await waitFor(LOCAL, 1000)) console.log(`[app] already running on ${LOCAL}, using it`)
else start('app', process.execPath, [join(app, 'node_modules', 'vite', 'bin', 'vite.js'), '--mode', 'stage', '--port', String(PORT), '--strictPort'], app)
if (!(await waitFor(LOCAL))) {
  console.error(`[app] did not answer on ${LOCAL}. Is the port taken, or is "npm ci" missing?`)
  stop()
}

// 3. Tunnel
const cloudflared = findCloudflared()
if (!cloudflared) banner()
else openTunnel()

// A quick tunnel can be dropped by Cloudflare (laptop slept, network changed). cloudflared then retries under
// the old name forever ("Tunnel not found") and the printed link is dead. So: a new tunnel, a new link box.
function openTunnel() {
  let url, shown = false, lost = false
  const child = start('tunnel', cloudflared, ['tunnel', '--url', LOCAL], app, async (text) => {
    if (!lost && /Tunnel not found/.test(text)) {
      lost = true
      console.log('\n[tunnel] the link died (Cloudflare dropped the tunnel). Opening a new one: the links below will be NEW.\n')
      children.splice(children.indexOf(child), 1)
      if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill()
      if (!stopping) openTunnel()
      return
    }
    url ??= text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0]
    if (!url || shown || lost || !/Registered tunnel connection/.test(text)) return
    shown = true
    console.log('[tunnel] connected, waiting until the link is known on the internet ...')
    if (!(await resolves(new URL(url).hostname))) console.log('[tunnel] the name is slow to appear: if the link fails, wait a minute and reload')
    if (!lost) banner(url)
  }, / ERR | WRN /) // cloudflared is chatty: only its warnings and errors are shown
}
