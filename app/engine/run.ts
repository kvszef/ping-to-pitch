// The check runner. A check is `(client, ctx) => Finding[]`; connecting one means adding one line to CHECKS.
import { checks } from './checks/index.ts'
import type { CheckContext, Finding, RawClient, Severity } from './types.ts'

export { indexReference } from './data.ts'
export type { ReferenceIndex } from './data.ts'

const ORDER: Record<Severity, number> = { risk: 0, warn: 1, info: 2, ok: 3 }

export type RunResult = Finding[] & { failed?: { check: string; error: string }[] }

// Runs every registered check. A check that throws is skipped and reported in `failed`, never thrown:
// an unknown security in an uploaded file must not take the whole briefing down.
export function run(client: unknown, ctx: CheckContext): RunResult {
  const raw: RawClient = typeof client === 'object' && client !== null && !Array.isArray(client) ? (client as RawClient) : {}
  const findings: RunResult = []
  const failed: { check: string; error: string }[] = []
  for (const [name, check] of Object.entries(checks)) {
    try {
      findings.push(...check(raw, ctx))
    } catch (e) {
      failed.push({ check: name, error: e instanceof Error ? e.message : String(e) })
    }
  }
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
  if (failed.length) findings.failed = failed
  return findings
}
