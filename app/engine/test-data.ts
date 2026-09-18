// Tests only: loads the real case files once. The engine itself never touches the file system.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { indexReference } from './data.ts'
import type { CheckContext, RawClient } from './types.ts'

const dir = fileURLToPath(new URL('../../core-case/portfolio-data/', import.meta.url))
export const clients: RawClient[] = JSON.parse(readFileSync(dir + 'clients.json', 'utf8'))
export const ref = indexReference(JSON.parse(readFileSync(dir + 'reference.json', 'utf8')))
// The demo date. Case dates are shifted forward; the newest proposal is dated 2026-09-19.
export const NOW = new Date('2026-09-19T08:00:00Z')
export const ctx: CheckContext = { ref, now: NOW, memory: [] }
export const client = (clientRef: string): RawClient => {
  const c = clients.find((x) => x.ClientRef === clientRef)
  if (!c) throw new Error(`${clientRef} not in clients.json`)
  return c
}
