#!/usr/bin/env node
// Downloads the START Hack 2026 UNRISKOMEGA case material into the paths the app and phone/ read.
// The material belongs to UNRISKOMEGA AG and the organisers, so it is not committed here: this script
// fetches it from their public repo at one pinned commit and checks every file against its git blob hash.
// Runs on `npm ci` / `npm install` in app/ and phone/ (postinstall), or by hand: `node scripts/case-data.mjs`.
// Files that are already present and match are skipped, so it is quick and works offline after the first run.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'START-Hack/unriskomega-2026'
const COMMIT = '134d6ff9343b8703a63a7279043c57c09345d45b' // 2026-09-18, the material as published for the challenge

// path -> git blob SHA-1 at COMMIT (from the GitHub tree API)
const FILES = {
  'core-case/portfolio-data/DATA.md': '0a2e8c1e7e7e4ab35313e30dac60bf642117475f',
  'core-case/portfolio-data/clients.json': '3311d4d3c32210d9c445d6a6bf5d957c82a18f14',
  'core-case/portfolio-data/reference.json': 'cf81b9ced191b525b589ed25b454ac880e4d8191',
  'side-challenge/Quartalsreporting_Q4_2025_01_Herr_Max_Muster.pdf': 'dab4fdd2f1691dcfa55fae1c1231fd84830ad698',
  'side-challenge/Quartalsreporting_Q4_2025_02_Frau_Anna_Beispiel.pdf': 'b82e72b5d8bd9eb5d75fbe75f44a20427bb0ac99',
  'side-challenge/Quartalsreporting_Q4_2025_03_Familie_Weber_Brunner.pdf': '922551596c6ca84d11568cc2c462711222a464fe',
  'side-challenge/Quartalsreporting_Q4_2025_04_Herr_Peter_Keller.pdf': '3e874c3b65379702ce23d03bc94dbd0cd3eb3f58',
  'side-challenge/Quartalsreporting_Q4_2025_05_Frau_Laura_Steiner.pdf': '5d8ea679ef972426a30ac63ea72de4fbee4e5fd8',
  'side-challenge/Quartalsreporting_Q4_2025_06_Muster_Holding_AG.pdf': '34e9fcd9f7fc80f1d4d42e494da85f5ee442944e',
  'side-challenge/Quartalsreporting_Q4_2025_07_Herr_Daniel_Frey.pdf': '088c3b51a5d545c4cb8c77efcab384a4ad18e95c',
  'side-challenge/Quartalsreporting_Q4_2025_08_Frau_Nicole_Baumann.pdf': 'eeff29960450df62a01758b1b2188069a62eca37',
  'side-challenge/Quartalsreporting_Q4_2025_09_Pensionskasse_Fiktiva.pdf': '6845f95a609e31a1a57b8e8cd4ce6e84604ad8c6',
  'side-challenge/Quartalsreporting_Q4_2025_10_Herr_Thomas_Gerber.pdf': '72addfc7018294f380f2db8520bab5037d5aed6e',
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const blobSha = (buf) => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
// As a postinstall step a failure only warns, so `npm ci` still works offline; run by hand it fails.
const soft = process.env.npm_lifecycle_event === 'postinstall'

let fetched = 0
const failed = []
for (const [path, sha] of Object.entries(FILES)) {
  const target = resolve(root, path)
  if (existsSync(target) && blobSha(readFileSync(target)) === sha) continue
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${COMMIT}/${path}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (blobSha(buf) !== sha) throw new Error('content does not match the pinned hash')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, buf)
    fetched++
  } catch (e) {
    failed.push(`${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

if (failed.length) {
  console.warn(`[case-data] could not fetch ${failed.length} file(s) from github.com/${REPO}:\n  ${failed.join('\n  ')}`)
  console.warn('[case-data] the app and the tests need them; run `node scripts/case-data.mjs` again when online.')
  process.exit(soft ? 0 : 1)
}
console.log(fetched ? `[case-data] fetched ${fetched} file(s) from github.com/${REPO}@${COMMIT.slice(0, 7)}` : '[case-data] case material present and verified')
