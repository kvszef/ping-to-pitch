# PROGRESS

> **Snapshot.** The working board from the hackathon (18 to 19 September 2026), kept as written. Statuses and open items describe that weekend, not the code today; the [README](README.md) describes what the app does now.

Shared "what is done, what is open" board for the 60-second client briefing. Plan and track definitions: [PLAN.md](PLAN.md).

**How to update:** edit only your own track's row and the log; `git pull --rebase` before pushing. Keep each row on one line so parallel edits merge cleanly. Status words: `done`, `in progress`, `not started`, `unknown – owner to confirm`.

## Milestones

| | Milestone | Status | Why |
|---|---|---|---|
| M1 | Real data | done | Engine runs on all 47 clients and on uploaded files; rehearsed on 2026-09-19 with three made-up client files (unknown securities and a crypto account; a company with an unknown risk profile and missing keys; odd id formats and an empty portfolio): upload, briefing, chat, news, call-today ranking and the phone's caller list all work. Left: rehearse from a fresh clone. |
| M2 | Differentiators | done | Contradiction + smallest fix with look-through, stale notes as questions, client profile and tone, 60-second talk track, peers, own worst months, CIO house view: all engine checks, all on screen. |
| M3 | Enrichment | done | Call memory, ask-the-data chat, news matching, who to call today, outbound call plan, ex-custody PDF import, live call with transcript and call note, English/German. |
| M4 | Freeze | in progress | Open: demo script on three hero clients, rehearsal of every live dependency with its fallback (no key, no network, no mic), run from a fresh clone. |

## Tracks

| Track | Owner | Status | What landed (commits) | Open / next |
|---|---|---|---|---|
| P0 Foundation | Arash + Claude | done | 279f9d2 `app/engine/{types,data,run,format}.ts`: `run(client, { ref, now, memory })`, `indexReference()`, null-safe reader, exposures with fund look-through, region/sector measured within the equity part (matches the bank's own violation values, CASE-037-02: 23.9% / 11.8% / 0.7%); cf001f5 vitest, `npm run check`, advisory CI | Nothing blocking. |
| E1 Portfolio facts | Arash | done | 7f9c62e, 7e0f7d2: 7 checks `portfolio.performance`, `.allocation`, `.concentration`, `.risk`, `.violations`, `.proposals`, `.maturities`; 34 engine tests incl. whole-dataset run | Per-position gains/losses impossible (see data limits). |
| E2 Contradiction + fix | Arash | done | f2abb8c: notes → closed wish menu (`engine/wishes.ts`, rules cover all 53 notes), checks `contradiction.fossil-fuel/.region/.sector/.unverifiable` with fund look-through, smallest fix as draft proposal + re-check of the portfolio checks (`engine/fix.ts`), `wish.esg`, `wish.cash`, `wish.currency`, `wish.interest` (options from the recommendation list that pass risk profile, ESG, exclusions), `wish.unreviewed`; f4cf5f2: AI classifier for unknown notes (`server/ai/wishes.ts`, note texts only, strict menu check) → `ctx.wishes` | The contradiction card still takes its holdings from `exclusionHoldings()` in `provisional-findings.ts`. Template briefing (no model) does not mention `wish.*` findings yet. `wish.cash` and E3's `portfolio.liquidity` both read the CHF 15,000 note. |
| E3 Context | Arash | done | 6d54f34 engine: `context.stale-note`, `context.plan` (engine/notes.ts plan table), `portfolio.liquidity` (cash vs. noted amount), `context.peers` (same risk profile, aggregates only, `ctx.peers` from engine/peers.ts), `context.history` (own worst drawdowns + recovery), `context.peer-behaviour`; peers wired into both briefing routes; stopgap plan/liquidity parts removed | `memory.promise` and `profile.*` still come from the stopgap note reader (A3/E4). CASE-007 with the engine: the Benchmark promise no longer fits the 3-line mention budget (A1). |
| E4 Client profile | Arash | done | 51cdbfe engine: `profile.trait` (likely traits with evidence: self-directed/delegating, wants to be asked, reacts to losses vs calm, braver/more careful than the risk profile, safety cushion, values, family, engaged/steady, interests; all `interpretation`, from notes, proposal decisions and dates, volatility vs profile, liquidity, tags), `profile.persona` (one sentence), `profile.tone` (register + hints), `profile.call-reason` (ranked: draft, maturing bonds, recent note, recent proposal, weak month); shared reader `profile-signals.ts`. e93f872 composer uses them for persona, tone and reasons (stopgap as fallback) | UI hides `profile.*` for now (f23e3d7, Workspace/App filter); `cards.ts` profile card still reads the stopgap `profile.contact/temperament`, could switch to `profile.trait`/`profile.tone`. Stopgap `profile.contact/temperament/interest` can go once the card is switched. |
| A1 Briefing writer | Arash | done | 455cfba composer on `run()` + reading page `/briefing.html` (`/api/briefing60`); 7433c23 main app wired: `GET /api/briefing/:ref?tier=` answers in the UI card format (talktrack, metrics, context, engine flags, contradiction with fix, stalenote, profile, todos, questions, actions), `POST /api/clients/upload` keeps uploaded files server-side so demo files get the engine briefing too; 21 tests in `app/server/ai/*.test.ts` | Tested with an OpenAI key on 2026-09-19 (talk track arrives as tier `fast` in about 7 s, number-checked, English or German). Apertus path untested. `provisional-findings.ts` is still live for `profile.contact/temperament`, `memory.promise` and `exclusionHoldings()`; its contradiction, risk, violation, performance, concentration and proposal functions only run if the engine throws and could go. `briefing.html` is dev-only (not in `npm run build`). |
| A2 Live call copilot | Ahmet | done | Moved into the app: internet call between the desk and the phone page (`app/call.html`, `app/src/phone/`, `server/call.ts`), live transcript cut at speech pauses, screen agent reacts to what the client says, scripted demo calls one click away; earlier Vapi/SignalWire prototype in top-level `phone/` | Top-level `phone/` is no longer used by the app: keep or delete, owner to decide. Rehearse on stage audio. |
| A3 Memory | Ahmet | done | 077036a: `server/memory/store.ts`, `POST /api/calls/:ref/summary` drafts the call note (model, in the advisor's language), `/confirm` stores it, engine check `memory.call-promise` brings open promises and points into the next briefing | Notes live in server memory/SQLite of the running server only. |
| A4 Ask-the-data chat | Kaushik | done (tools) | 9dd6731, be9906f, 53df718; tools: `server/ai/chat-tools.ts` (holding direct + via fund look-through, transactions by security/direction/period/proposal status, portfolio value history, cash incl. crypto), `server/ai/chat-route.ts` (OpenAI function calling + keyword-routed pre-lookup; Apertus: routed lookups as context; no key: `/api/chat/data` answers deterministically). Tool results join the number check. Tested live with OpenAI | Not in the data, the chat says so: fees/costs, history of a single position, single companies inside funds, exact trade dates (proposal date only), whether orders of rejected proposals were executed. Apertus path not tested (no key). Stretch (outside search) not built |
| N1 News matching | Arash | done | `server/market/`: web news per holding (Bing News RSS, no key), model judges relevance/importance/risk vs opportunity (tested with gpt-4o-mini; keyword rules without key), watcher refreshes all clients at server start and every 10 min, inbound refetches the caller's holdings (< 1 s warm, model gets 4 s for unseen articles), `/api/news/:ref`, `/api/news`, `/api/outbound`, `/api/news/status`, `news.hit` + news call reason in `/api/briefing?tier=slow`, offline snapshot | Fund contents only via the fund theme ("S&P 500"). Responses carry `fetchedAt` for a "Stand" label in the UI. `NEWS_WATCHER=off` in .env.local disables the watcher. |
| CIO house view | Kaushik (check in Arash's engine) | done | example view `engine/houseview.ts` (labelled Beispiel), check `cio.house-view` (look-through exposure vs SAA target per stance: opportunities within mandate band, wishes and ESG floor with a product from the recommendation list; deviations against negative stances), `ctx.houseView` passed at every `run()`, `GET /api/house-view`, `HOUSE_VIEW_FILE` for the bank's own view, `houseview` card on the Briefing page, "Hausmeinung" tiles in the workspace; `engine/rebalance.ts`: one re-checked step per opportunity (sell from the deviation or surplus cash, buy the recommended product, ≤ 10% of the portfolio, before/after and new warnings); view changes (`previous`/`changed` per stance) become call reasons and push clients up in `/api/outbound` | Arash: review `cio.house-view` and `engine/rebalance.ts`. |
| N2 News on screen + inbound/outbound ranking | Kaushik | in progress | 071b396 news agent (Yahoo Finance + Bing, Google News blocked on this network) `/api/news-agent`; live news tile merging it with N1's `/api/news/:ref`; "Heute anrufen" ranking from `/api/outbound` in the client list; outbound demo calls on today's top two; call waiting with a callback list | Demo control to push a news item live. |
| N3 Ex-custody PDF | Arash (Claude) | done | 4350e53, 837cd0d, ec5d7f8: `server/import/` reads a statement PDF (unpdf + line rules), joins positions to reference.json by ISIN and currency, classifies unknown ones from the statement (SAA_* fields on the position, read by a generic fallback in `engine/data.ts`), reconciles against the printed total; `POST /api/import/pdf?ref=`, `/api/import/attach`, `/detach`, `GET /api/import/:ref`; stored via the client upload, so briefing, chat and outbound see it; check `portfolio.ex-custody` + mention line and question in the 60-second briefing; UI "Fremddepot (PDF)" in the briefing header with parse report. All 10 samples: every position read, sums match | Samples' ISINs are mostly fictitious: 20 of 52 in reference.json, the rest estimated (marked in the report). Fixes the engine proposes can target Fremddepot positions (sale happens at the other bank). Optional model step for unreadable lines is untested with a real key. Upload only in the App briefing header, not in the workspace. No FX conversion if statement and client currency differ (warned). |
| U1 Real data in the UI | Kaushik | done | b85ab39 … 9f92d36, 53df718: real client list only (samples are the offline fallback), engine briefing in the Briefing page and the workspace, tier skeletons, upload | Rehearse from a fresh clone. |
| U2 New cards | Kaushik | in progress | af7f990, dfddd55, a1f6f2d: contradiction, look-through, stale note, profile, peers, to-do, call-note cards; engine sends real ones via /api/briefing | Click-to-source on every card. |
| U3 60-second format | Kaushik | done | 57c3d3d, be9906f, 53df718: talk track with reading-time budget; workspace stage: tiles in speaking order, screen agent (/api/agent) picks tiles, focus, graphs and three talking points from a UI-element catalogue and follows the transcript; call reasons on the ringing banner | Tune agent wording with real calls. |
| L1 English / German | Arash (Claude) | done | cde9fa4, 745e5d4, 06826a7, 8f5a0bf, 03f8a03: English is the default, German through the switch in the top bar. `app/engine/lang.ts` (`ctx.lang`, evidence source names, title prefixes other code reads); all 26 checks, the briefing composer, cards, chat, news, PDF import, call note and every model prompt phrase natively in the language; German output byte-identical to before. `engine/lang.test.ts` runs every check on all 47 clients in both languages. UI: fixed-label dictionary `src/data/i18n-static.ts` (instant, offline), only German-looking text still goes to `/api/translate`, which now refuses a translation that changes a number | New fixed label: one line in `i18n-static.ts`. Still raw German: LiveIsland in `CallIsland.tsx`, some labels in `ChatDock`, `LiveOverlay`, `BriefingPage`. German news headlines stay German (source data). |
| O1 Outbound call plan | Arash (Claude, starthack-54) | done | 5815e4c, cb090ca, 1655a9b: `server/ai/callplan*`, `src/workspace/CallPrep.tsx`: goal, arguments, opener for an outgoing call, Ausgehend/Eingehend switch, why-calling card for incoming calls | – |

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

- 2026-09-19 · Arash (Claude) · Rehearsal with three made-up client files; fixes: uploaded clients reach `/api/clients` and the phone page (489e2e9), unknown securities make shares lower bounds instead of band breaches (a22e30f), plans in notes are read in general wording with the deadline from the note (992236e)
- 2026-09-19 · Arash (Claude) · L1: the whole app in English by default, German on request; engine, composer, chat, news, import, prompts and UI labels natively bilingual (cde9fa4 … 03f8a03)
- 2026-09-19 · Kaushik · house view: re-checked rebalancing step, view changes as call reasons and in the outbound ranking
- 2026-09-19 · Kaushik · CIO house view: example view, engine check cio.house-view, card and workspace tiles
- 2026-09-19 · Arash (Claude) · N3: ex-custody PDF import, statement → virtual portfolio labelled Fremddepot, in the engine and the 60-second briefing (837cd0d, ec5d7f8)
- 2026-09-19 · Arash (Claude) · A4: ask-the-data tools (holdings incl. fund look-through, transactions, value history, cash) with OpenAI function calling, keyword fallback and a no-key answer
- 2026-09-19 · Kaushik · N2/U3: inbound demo calls with caller recognition, outbound ranking and demo calls, call waiting, live news tile
- 2026-09-19 · Arash (Claude) · N1: news watcher keeps news at most 10 min old; calls answer from cache in 0.3 s, tested with the real model
- 2026-09-19 · Arash (Claude) · N1: news agent searches the web per holding, inbound news + outbound ranking endpoints for Kaushik's N2
- 2026-09-19 · Arash (Claude) · News split: N1 matching stays with Arash, N2 news on screen + inbound/outbound ranking + internal tooling moves to Kaushik; contract in PLAN.md
- 2026-09-19 · Arash (engine session) · E2: wishes vs holdings, smallest fix with re-check, AI classifier for unknown notes (f2abb8c, f4cf5f2)
- 2026-09-19 · Arash (Claude) · E4: client profile in the engine (traits with evidence, persona, tone, call reasons) and wired into the briefing composer (51cdbfe, e93f872)
- 2026-09-19 · Arash · E3: context checks (stale notes, plans, liquidity, peers, own history) in the engine, stopgap parts removed (6d54f34)
- 2026-09-19 · Kaushik · U3/A4: screen agent picks what the advisor sees, workspace on real data only (53df718)
- 2026-09-19 · Arash (engine session) · A1: the model now writes the whole briefing from the findings (lines must cite finding ids, numbers checked); template stays as no-key fallback (67bb00a)
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
