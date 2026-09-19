# Content audit, 19.09.2026

Five read-only audits of what the app says, not how it looks: the call-today list, the predicted call reason, the numbers in the main panel, new client files, the chatbots. Clients by ref only. "Ran" = verified by running the engine or the API on the real data; "read" = from the code.

Done means pushed. Everything else is open, ranked by demo impact within each part.

## 1. Call today (`/api/outbound`, `server/market/route.ts`)

The list is a news ticker. A headline gives up to 3 points per holding, uncapped; all engine findings of a client together give at most 3. Ran: reason no. 1 is news for all of the top 6; CASE-041 (6 rule breaches, 16 months without contact) ranks 31st, CASE-001 (all cash, 5 breaches) 19th; monthly losses, cash piles, maturing bonds and contact age can never score (severity filter).

- **Done:** `server/market/score.ts` + tests, wired into `outbound()`. One line per kind of finding with points per client, two best stories, news capped at 4 points, shared headlines dampened. Live check after the change: 7 of the top 8 lead with a finding from the client's file (CASE-012: 13 breaches and CHF 328 cash against a CHF 15'000 tax payment).
- **Done, `news.ts`:** intraday tickers, adverts, fund pages and bare company names are not news; English keywords match whole words only; the offline snapshot only uses the last 30 days; the judge prompt says tickers and adverts are routine and a falling price is no opportunity.
- **Open:** `useOutbound.ts` drops `offline`/`fetchedAt`; the roster never says the news is stale.
- Contact age is not a finding yet, so "not spoken to in 16 months" cannot score.
- CASE-028: one position is 95.9% of the assets, the engine reports no concentration risk. Check the fund logic.

## 2. Why is the client calling (`engine/checks/profile-call-reason.ts`)

Ran: 35 of 47 clients get a reason, 12 none. Rank 1 is "value dropped last month" for 20 clients: one market-wide month, and the value history ends 01.07.2026, 80 days before "now".

- **Demo call ein-2 (CASE-012) predicts the wrong reason.** Predicted: follow-up on an accepted proposal. The client calls about cash for the tax payment. The engine has that as `portfolio.liquidity` / `wish.cash` findings; call-reason never looks at them (note older than 60 days). Fix: a `liquidity` reason (need from notes or plans, shortfall > 0), score 3–4. Tests: CASE-012 fires, CASE-009 does not.
- Demo call ein-1 (CASE-017): right content, reversed order. Draft and loss tie at score 3, the newer date wins; the client has the `loss-reacts` trait, the loss should win.
- Size of the loss is ignored (−7.6% scores like −3.0%); data age is not in the title.
- Not used at all: rule breaches, due call promises, a rejected proposal older than 30 days, a repeated ask (CASE-027 misses the 60-day window by one day).
- **Done, not wired:** `src/workspace/callReasons.ts` (`callReasonsOf`, `talkingPointsOf`) + tests. Stage, CallIsland and Workspace filter the findings themselves, unsorted, and count a changed house view as a reason: for CASE-012, 027, 040 the house view shows as reason no. 1. Handed to the call session.
- The agent gets the reason only on the `start` event: while identifying that is `clients[0]`'s reason, after identification it probably never arrives.
- WhyCalling does not render when the engine has not answered, and not in the text view. Both demo inbound calls ring as unknown number, so the ringing island never shows a prediction.

## 3. Numbers in the main panel

Ran, 6 clients recomputed from raw: total assets, last month / YTD / 12 months, largest position, currency split, breach counts, proposal counts all match.

- **Several portfolios: one portfolio shown as the client.** `brief.ts` strips the `CASE-xxx-02:` prefix and takes a per-portfolio performance finding before the client-level one. CASE-005: tile −6.0%, client card −5.2%, same screen. CASE-038: tile −7.1%, client −4.2%.
- **CASE-038 double-counts:** portfolio -01 is "Consolidated" and holds everything of -02. Sum of portfolio AUM 3.81M against client AUM 1.62M; weights are halved (largest position 6.2%), the chart has duplicate bars, liquidity reads 1.8% and 2.1% in two places; 15 of 18 violations point to a portfolio id that is not in the file ("Portfolio unbekannt").
- **`wish.*` and `portfolio.risk` findings never become tiles** (no entry in `GROUP` in `brief.ts`). CASE-012 loses the cash shortfall for a tax bill due 20.09.2026 and "volatility 18.4% above the profile's 15.0%".
- Breach tiles show the actual value, not the limit, though the data has it (`detail`, `numbers.threshold1`): "11.9%" instead of "11.9%, limit 11.5%".
- CASE-001: a pure cash account shows +15.6% YTD / +30.3% over 12 months: most likely deposits. The "not adjusted for flows" note is only on the chart. Also two contradicting risk tiles (max volatility breached at 11.9%, volatility band undershot at 0.0%); the first has no `LastViolatedDateUTC`.
- "Last month" means June; tiles do not name the month or the as-of date.
- Profile header takes service and strategy from `portfolios[0]`: CASE-038 shows "Consolidated / No strategy", 036/037/047 the pension product instead of the advisory mandate.
- CASE-022: strategy "Investor profile 6" against risk profile 5 is flagged nowhere.
- Noise: peer tiles, drawdown 2021–22 on a cash account, duplicate sector tiles (violation + allocation), two proposal tiles.
- **Done (`screen.ts`):** tiles about the asset mix or a position open their own graph, not the currency graph; with several portfolios the allocation graph names the portfolio it shows.

## 4. New client files

Ran: 8 synthetic clients (unknown securities and asset class, XRP/ETH, violations null and absent, no proposals/notes/history, `{ClientRef}` alone, umlauts, odd refs) through import, engine, briefing, tiles, text overview, chat, call note, ranking. Nothing threw, no NaN or "undefined" on screen. JSON only; PDF is for ex-custody statements.

- **Wrong unit is not caught:** `PortfolioValuePercentage: 35` gives "Grösste Position 3500.0%" everywhere. Guard in `engine/data.ts` and `fromRaw.ts` (failing test first).
- **IBAN in a client note reaches the findings** (`contradiction.unverifiable` quotes the note) and from there the LLM. `fromRaw` masks IBANs, the engine does not.
- **Uploads live in server memory.** Any saved edit under `app/server` or `app/engine` restarts the dev server (vite imports `server/api.ts`) and wipes them: briefing 404, chat unsupported, silently. Persist to a git-ignored file, or freeze edits during the demo and keep the three files ready.
- `/api/clients` has no uploads: a new tab and the phone page do not list the client. `/api/news-agent` reads `loadData()` only: "Client not found" for uploads.
- Re-uploading an existing ref: briefing is new, header name and AUM stay old (`mergeByRef` order). `case-038` ≠ `CASE-038`.
- Wrapper keys other than lower-case `clients` are rejected; one bad entry rejects the file; numbers as strings are dropped silently (AUM "4200000.5" → "CHF 0.00").
- "Call today" polls every 120 s, an upload does not refresh it. No body size limit.

## 5. Chatbots

Ran, 9 chat + 1 agent request on CASE-001: every figure matched the engine, none invented, prompt injection refused, honest about missing data.

- **Chat answers in German in English mode** (German-only rule in `server/api.ts` RULES wins; `brain.ts` answer/dataAnswer/think/demoScript never send `language`). The UI re-translates: extra model pass, German flash, mixed-language sources.
- **The number guard (`grounding.ts`) checks only that a digit string exists somewhere in the evidence.** Pass: sign flips, a number moved to another subject or period, unit swaps, numbers as words, any single digit, dates by parts. The evidence includes the advisor's question and the whole transcript, so anything said aloud counts as grounded.
- **The call transcript goes to the model unmasked** (clients say their own name); `maskName` exists only for the after-call note. `server/call.ts` logs the first 80 characters of every call text.
- **No timeout on any model call**, so the fallbacks never fire on a stall.
- Refusals are honest but do not cite the mandate: a leveraged oil/tobacco/Bitcoin pitch is refused for "no information", not for ESG, risk profile and 5 open breaches. There is no deterministic suitability gate for chat text.
- After-call note: `due` dates are format-checked only ("next Friday" becomes an invented date in memory); a model failure returns an empty draft, indistinguishable from "nothing agreed".
- No tool lists top positions: "largest position?" is unsupported in example mode.
- **Done (`screen.ts` `checkPlan`):** a shorter tile wording may only carry that tile's own figures; malformed model output no longer throws.

## 6. Text overview and PDF

- **Done:** a bar chart where one bar is nearly everything yields to a more telling one; the PDF ends with a line on where its numbers come from.
- It shows what the tiles show, so everything in part 3 applies.
