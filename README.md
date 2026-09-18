<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logos/uro-dark.svg">
  <img src="assets/logos/uro-light.svg" alt="UNRISKOMEGA" height="34">
</picture>

<br><br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logos/partners-dark.png">
  <img src="assets/logos/partners-light.png" alt="Swiss {ai} Weeks and START Hack Tour, St. Gallen" height="77">
</picture>

# From Ping to Pitch

Our entry for the UNRISKOMEGA challenge at START Global x Swiss AI Weeks 2026.

</div>

The phone rings. Before the advisor says hello, the screen shows a 60-second briefing built from the client's real data: what happened, what is wrong, what to say, what to propose. During the call the tool listens and helps. After the call it drafts the call note. Next time it remembers.

| Mode | Trigger | What happens |
| --- | --- | --- |
| **Inbound** | Client calls | Instant facts are on screen at pickup. LLM wording, news and history stream in during small talk. Everything is there in under 60 s. |
| **Outbound** | A rule violation, a news hit or a price move | The client lands on a "call today" list. The advisor opens a prep workspace, gets ready, then calls. |
| **After the call** | Call ends | AI drafts what was proposed, how the client reacted and which promises were made. One tap to confirm. The next briefing uses it: no repeated rejected ideas, open promises get closed. |

We do not "maximise revenue per client", we **never miss a suitable opportunity**: every suggestion passes the client's mandate, risk profile, ESG preference and stated wishes before it is shown.

## Docs

| | |
| --- | --- |
| [PLAN.md](PLAN.md) | What we are building, architecture, contracts, tracks and owners, milestones, risks. |
| [CLAUDE.md](CLAUDE.md) | How we work: git, tests, code rules, grounding rules, data traps. |
| [task.md](task.md) | The official challenge brief and judging criteria. |
| [core-case/portfolio-data/DATA.md](core-case/portfolio-data/DATA.md) | Full data reference: every field and join key. |

## Run

```
cd app && npm ci && npm run dev
```

API keys are optional: copy `app/.env.example` to `app/.env.local`. Without keys the app runs in example mode. Keys stay in the Vite server and never reach the browser.

Before you push, in `app/`: `npm run check` (lint, typecheck, tests).

## How it works

```
clients.json | uploaded client file | ex-custody PDF ─┐
reference.json ───────────────────────────────────────┤
call memory (SQLite) ─────────────────────────────────┤
                                                      ▼
                     ENGINE  app/engine       pure, deterministic, tested
                     checks[]  ─►  Finding[]  every number with its evidence
                                                      │
        ┌─────────────────────────────────────────────┼──────────────────────────────┐
        ▼ instant  < 200 ms                           ▼ fast  < 5 s                   ▼ slow  < 60 s
  facts, flags, allocation,               LLM phrases findings into          news + CIO view matched to
  contradictions, stale notes             headline, questions, actions       holdings, history, peers
        └─────────────────────────────────────────────┼──────────────────────────────┘
                                                      ▼
                                  Card[]  ─►  UI  app/src/cards  (registry)
```

**The engine computes, the LLM phrases.** No number reaches the screen unless deterministic code produced it. Every statement is a `fact`, an `interpretation` or an `action` and names its source. If the data does not support an answer, the tool says so.

Connecting a piece means registering it: checks (`app/engine/checks/`), briefing sections (`instant | fast | slow`) and cards (`app/src/cards/registry.tsx`) are each a registry. Details and the v0 contracts are in [PLAN.md](PLAN.md#3-architecture).

What the real data already proves:

- **Contradictions hide inside funds.** 13 clients have a "no fossil fuels" note, 11 hold energy anyway, and for 10 of those it is only visible through fund look-through.
- **Notes expire.** A "property within 12 months" note from a year ago becomes a question, not a fact.
- **Memory works from minute zero.** 76 proposals in the data are already rejected, so "don't repeat rejected ideas" needs no call history.

## Mock vs production

| Piece | Today | Production |
| --- | --- | --- |
| Client data in the UI | `app/src/data/mock.ts`, in the API shape | Engine over `clients.json` and uploaded files (`app/engine/`, milestone M1) |
| Briefing wording, chat, call analysis | LLM via OpenAI or Apertus (OpenAI-compatible); example mode without keys (`app/src/workspace/brain.ts`) | Same, phrasing engine findings only |
| Live transcription | ElevenLabs speech-to-text; scripted call as fallback | Same |
| News and CIO view | Not in the dataset; mock source | Live source behind the same interface (`app/server/market/`) |
| Call memory | Planned, seeded from rejected proposals in the data | SQLite, confirmed call notes |

Every live dependency has an offline fallback, so the demo never dies.

## Repo layout

| | |
| --- | --- |
| [app/](app/) | The application: React + Vite UI (`src/`), API inside the Vite server (`server/`), engine (`engine/`). |
| [core-case/portfolio-data/](core-case/portfolio-data/) | The dataset: `clients.json` (47 clients: portfolios, holdings, proposals, transactions, violations, notes) and `reference.json` (security master data, fund breakdowns, suitability rules, profiles, target allocations). |
| [core-case/GUI-screenshots/](core-case/GUI-screenshots/) | Reference screenshots of the current advisory UI. |
| [side-challenge/](side-challenge/) | Ten quarterly client reports (Q4 2025) as PDFs. |
| [assets/logos/](assets/logos/) | Brand logos, `*-light` and `*-dark` variants. |

Three further client files in the shape of `clients.json` are handed over at the live demo, so the app accepts uploads and the engine never throws on securities it has not seen.

## Data traps

Verified against the real files; the full list is in [CLAUDE.md](CLAUDE.md#data-traps-verified-against-the-real-files).

- **Null and absent both happen.** `DATA.md` says "absent, never null", but 20 clients have `SuitabilityViolations: null`. Always `x ?? []`.
- **Join on `SecurityId`, not `Isin`.** One ISIN can be several securities, one per currency.
- **Mind the units.** Position and SAA percentages are fractions 0–1; `FundUnbundlingMappings[].Weight` is 0–100.
- **Use the `SAA_*` fields** to compare holdings against target allocations.
- **Dates are shifted.** Engine logic never reads the wall clock; the date arrives as `ctx.now`.
- **Account `Currency` can be a crypto ticker** (`BTC`, `ETH`), not an ISO code.
- **IBANs in the data are real.** No names, IBANs or account numbers go to an LLM, a log or a commit.
