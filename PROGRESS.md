# PROGRESS

Shared "what is done, what is open" board for the 60-second client briefing. Plan and track definitions: [PLAN.md](PLAN.md).

**How to update:** edit only your own track's row and the log; `git pull --rebase` before pushing. Keep each row on one line so parallel edits merge cleanly. Status words: `done`, `in progress`, `not started`, `unknown – owner to confirm`.

## Milestones

| | Milestone | Status | Why |
|---|---|---|---|
| M1 | Real data | in progress | Engine (P0, E1) runs on all 47 clients and the main app now shows it: `/api/briefing/:ref` serves engine findings plus the A1 talk track in the UI card format for every case client and every uploaded file (7433c23). Left: rehearse from a fresh clone. |
| M2 | Differentiators | in progress | 60-second talk track and the new cards exist in the UI; the engine checks behind them (E2 contradiction + fix, E3 stale notes / peers / worst months, E4 profile) are not built yet, a stopgap covers them. |
| M3 | Enrichment | in progress | Live call copilot in `phone/` and the chat panel are moving; memory, news matching, "who to call today" and PDF import have not started. |
| M4 | Freeze | not started | No demo script or fallback rehearsal yet. |

## Tracks

| Track | Owner | Status | What landed (commits) | Open / next |
|---|---|---|---|---|
| P0 Foundation | Arash + Claude | done | 279f9d2 `app/engine/{types,data,run,format}.ts`: `run(client, { ref, now, memory })`, `indexReference()`, null-safe reader, exposures with fund look-through, region/sector measured within the equity part (matches the bank's own violation values, CASE-037-02: 23.9% / 11.8% / 0.7%); cf001f5 vitest, `npm run check`, advisory CI | Nothing blocking. |
| E1 Portfolio facts | Arash | done | 7f9c62e, 7e0f7d2: 7 checks `portfolio.performance`, `.allocation`, `.concentration`, `.risk`, `.violations`, `.proposals`, `.maturities`; 34 engine tests incl. whole-dataset run | Per-position gains/losses impossible (see data limits). |
| E2 Contradiction + fix | Arash | not started | – (stopgap: `app/server/ai/provisional-findings.ts` emits `contradiction.*`) | Next engine work: wishes vs holdings (e.g. fossil fuel via funds), smallest fix as draft proposal, re-check the fix. |
| E3 Context | Arash | not started | – (stopgap emits `context.*`, `memory.promise`) | Stale notes as questions, peers, this client's worst months (needed to explain the July 2026 drop). |
| E4 Client profile | Arash | not started | – (stopgap emits `profile.*`) | Persona line, tone setting, call-reason guess from what the client said and did. |
| A1 Briefing writer | Arash | done (AI wording untested with a real key) | 455cfba composer on `run()` + reading page `/briefing.html` (`/api/briefing60`); 7433c23 main app wired: `GET /api/briefing/:ref?tier=` answers in the UI card format (talktrack, metrics, context, engine flags, contradiction with fix, stalenote, profile, todos, questions, actions), `POST /api/clients/upload` keeps uploaded files server-side so demo files get the engine briefing too; 21 tests in `app/server/ai/*.test.ts` | Try with an OpenAI/Apertus key in `app/.env.local` (phrased talk track arrives as tier `fast`, number-checked). Delete `provisional-findings.ts` once E2/E3/E4 land. `briefing.html` is dev-only (not in `npm run build`). |
| A2 Live call copilot | Ahmet | in progress | cf59e72, f78af13, 22e98db, 2e2d6a4, 70f2792, cbdb5b0, 10b3233, 418bf2a, 9511ffb, 2033021: `phone/` with Vapi number, live transcript, copilot event bus, SQLite loader, cXML bridge (SignalWire/Twilio) | Lives in `phone/`, not `app/server/ai/call*` as PLAN.md says; call to-dos and "show the data being talked about" in the app: unknown – owner to confirm. |
| A3 Memory | Ahmet | not started | – (no `server/memory*`, no call-note table in `phone/toolbox/schema.sql`) | Post-call draft → confirm → SQLite → `ctx.memory`. unknown – owner to confirm. |
| A4 Ask-the-data chat | Kaushik | in progress | 9dd6731 chat as slide-in panel (`ChatDock.tsx`); 1dd3e32 concrete sentences with figures | Tools over the engine's data index with source per answer: unknown – owner to confirm. |
| N1 News + CIO view | Arash | not started | – | Sample news file, embedding match to holdings incl. fund contents → `Signal[]`. |
| N2 Outbound mode | free hands | not started | – | Rank clients by findings into "who to call today". |
| N3 Ex-custody PDF | free hands | not started | – (sample PDFs sit in `side-challenge/`) | PDF → virtual portfolio → same engine path. |
| U1 Real data in the UI | Kaushik | in progress | b85ab39, 6239647, 57cacc9, 8023ac6, efa6d98, 937944b, 9f92d36, fa31746, e573e5e: raw files → briefing, data source with engine API + local fallback, tier skeletons, upload, search/pager | Engine endpoint now answers (7433c23); `main` typecheck fails in `src/workspace/Workspace.tsx` (`Settings.focus`, `dragSplit` missing) since 25ae675, probably an uncommitted `settings.ts`: owner to confirm. |
| U2 New cards | Kaushik | in progress | af7f990, dfddd55, a1f6f2d: contradiction, look-through, stale note, profile, peers, to-do, call-note cards (sample data) | Feed them from real findings once E2–E4 land; click-to-source. |
| U3 60-second format | Kaushik | in progress | 57c3d3d, 773f7bc: talk track with reading-time budget and rehearsal | "Why is the client calling" on inbound: unknown – owner to confirm. |

## Known data limits

- No cost basis and trades are undated, so no per-position gains or losses.
- The bank's violation list is a stale snapshot: 83 agree with ours, 25 only ours, 7 only the bank's.
- Proposals are whole-portfolio snapshots, not trade lists.
- Almost all portfolios fell 3–8% in July 2026; without E3 peer context this reads as client-specific bad news.
- 29 of 57 portfolios have "No strategy", so they have no SAA targets to measure against.
- `SuitabilityViolations: null` on 20 clients, securities join on `SecurityId` not ISIN, fund weights 0–100 vs positions 0–1 (see CLAUDE.md "Data traps").

## Cross-team notes

- **Engine API:** `run(client, { ref, now, memory })` in `app/engine/run.ts` returns `Finding[]` plus `.failed` (checks that threw are skipped, never thrown); `ref = indexReference(referenceJson)` from `app/engine/data.ts`. Pure: pass `now`, never read the clock.
- **Finding id:** `${check}:${clientRef}:${subject}`; stable, memory keys on it.
- **What the briefing composer (`app/server/ai/briefing.ts`) reads; keep these stable or tell Arash:**
  - `portfolio.performance` → `numbers.lastMonth` (falls back to `month`) and `numbers.ytd`.
  - `portfolio.risk` → `numbers.maxVola` (falls back to `volaMax`, `max`).
  - `portfolio.proposals` → one finding per rejected proposal, title "Abgelehnt vom DD.MM.YYYY: «Reason»".
  - Violation titles may start with a case prefix `CASE-xxx-yy: `; the composer strips it.
  - `portfolio.proposals` acceptance finding with `numbers.accepted/rejected/total` (persona line), `portfolio.allocation` `numbers.bankFlagged` (shown instead of the duplicate violation), `portfolio.maturities` findings of kind `action` (next steps).
  - **UI contract A1 depends on:** card shapes in `app/src/types.ts` (`talktrack`, `contradiction`, `stalenote`, `profile`, `todos`) and `fromRaw()` for key figures; relative imports there carry `.ts` so the server can import them, keep that.
  - Checks are matched by prefix (`contradiction`, `context`, `profile`, ...), so new sub-checks are picked up automatically.

## Log

- 2026-09-19 · Arash · A1: main app shows the engine briefing via /api/briefing/:ref, server-side upload for demo files (7433c23)
- 2026-09-19 · Claude (engine session) · PROGRESS.md board added
- 2026-09-19 · Ahmet · phone: cXML bridge replaces Plivo, runs on SignalWire or Twilio (9511ffb, 2033021)
- 2026-09-19 · Ahmet · phone: data loader into SQLite and advisor view (418bf2a)
- 2026-09-19 · Kaushik · UI: collapsible client list in the insights workspace (fa31746)
- 2026-09-19 · Ahmet · phone: Plivo bridge so the advisor can talk in the call (10b3233)
- 2026-09-19 · Ahmet · phone: copilot event bus, grounded call fixture, README (70f2792, cbdb5b0)
- 2026-09-19 · Arash · A1: 60-second briefing writer and reading page (455cfba)
- 2026-09-19 · Kaushik · A4: chat as slide-in panel (9dd6731)
- 2026-09-19 · Ahmet · phone: copilot contracts, DB schema, Vapi number setup (22e98db, 2e2d6a4)
- 2026-09-19 · Arash · E1: violations, proposals and maturities checks (7e0f7d2)
- 2026-09-19 · Ahmet · phone: live-call copilot foundation, inbound number with live transcript (cf59e72, f78af13)
- 2026-09-19 · Arash · E1: allocation, performance, risk and concentration checks (7f9c62e)
- 2026-09-19 · Arash · P0: engine foundation with look-through and check runner (279f9d2)
- 2026-09-19 · Kaushik · U3: 60-second talk track with reading-time budget (57c3d3d, 773f7bc)
- 2026-09-19 · Kaushik · U1: workspace runs on real client files, parallel tiers, upload, search (b85ab39 … 9f92d36)
- 2026-09-19 · Kaushik · U2: contradiction, look-through, stale note, profile, peers, to-do, call-note cards (af7f990)
- 2026-09-19 · Arash · PLAN.md, conventions, vitest + CI (2975b36, cf001f5)
