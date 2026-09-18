# PLAN

What we are building, how the pieces fit, and who can start on what right now.
How we work (git, tests, code rules): [CLAUDE.md](CLAUDE.md). Official brief and judging criteria: [task.md](task.md).

## 1. The product

**From Ping to Pitch.** The phone rings. Before the advisor says hello, the screen shows a 60-second briefing built from the client's real data: what happened, what is wrong, what to say, what to propose. During the call the tool listens and helps. After the call it drafts the call note. Next time it remembers.

Three modes:

| Mode | Trigger | What happens |
|---|---|---|
| **Inbound** | Client calls | Instant facts are on screen at pickup. Slower parts (LLM wording, news, history) stream in while the advisor does small talk. Everything is there in under 60 s. |
| **Outbound** | A rule violation, a news hit or a price move | The client lands on a "call today" list. The advisor opens a prep workspace, takes a minute or more to get ready, then calls. |
| **After the call** | Call ends | AI drafts: what was proposed, how the client reacted, why, which promises were made. One tap to confirm, saved to SQLite. The next briefing uses it: no repeated rejected ideas, open promises get closed, stale facts get updated. |

## 2. How we win

Scoring: problem fit 25, technical 20, AI grounding 20, UX 20, bonus 15. **Core is 85%.** Order of work follows from that: core on real data first, differentiators second, enrichment third.

What the real data already proves (checked against `clients.json` / `reference.json`):

- **Contradiction and fund look-through are one feature.** 13 clients have a "no fossil fuels" note, 11 of them hold energy anyway, and for 10 of those it is *only* inside funds. Invisible in the position list. Demo clients: CASE-004 (3.4% via funds), CASE-037 (ESG "Yes", 1.8% via funds), CASE-017 (direct: Neste).
- **Notes expire.** CASE-007's "property within 12 months" note is from Oct 2024, so the window closed a year ago. A naive briefing states it as fact. We turn it into a question: "did the purchase happen?"
- **Memory works from minute zero.** 76 proposals in the data are `Abgelehnt` (CASE-012 alone has 12). "Don't repeat rejected ideas" needs no call history to demo.
- **Communication profile** has real input: notes like "email only", "after 6pm", "written summary after every meeting".
- **History and peers** are computable: 58 months of NAV per portfolio, 47 clients to compare within a risk profile.
- **News and CIO view are not in the dataset.** They are enrichment, behind one interface with a mock and a live source. Judges explicitly ask where mock ends and production begins.

Framing that matters with these judges (a suitability and compliance vendor): we do not "maximise revenue per client", we **never miss a suitable opportunity**. Same features (opportunity radar, ex-custody import to win outside assets, life events from notes), but every suggestion passes mandate, risk profile, ESG preference and the client's stated wishes first.

Two lines for the pitch:

- **The call note is not a gimmick, it is a legal duty.** Swiss law (FIDLEG) makes advisors document every piece of advice. We draft that document for them, they confirm with one tap.
- **Client data can stay in Switzerland.** The LLM layer already runs on Apertus, the Swiss open model, as an alternative to OpenAI. Fits the Swiss AI Weeks and answers the bank's first question.

### The 60-second briefing, taken literally

The briefing is a talk track with a reading-time budget, not a report. Four blocks, about 150 words in total, with a visible reading-time bar:

| Block | Content |
|---|---|
| **Open with** | The one sentence to start the call, in this client's tone |
| **Must mention** | Violations, contradictions, the smallest fix with before and after |
| **Ask** | Expired notes turned into questions, open promises from the last call |
| **Don't bring up** | Ideas the client already rejected, topics the notes say to avoid |

Every statement is clickable down to its source: the position, the rule, the note with its date. On an inbound call the top of the screen also guesses **why the client is calling** (biggest loser, new violation, news hit), ranked from the findings.

### Client profile: tone and behaviour

Wording adapts to the person. Built only from what the client said and did, never invented:

- **Said**: contact preferences and style from the notes ("email only", "after 6pm", "detailed written summary", "very risk-averse since the last downturn").
- **Did**: share of proposals accepted vs rejected and what kind, whether they traded during their worst months, how much cash they really hold vs what their risk profile would allow, actual portfolio risk vs the ceiling of their profile.
- **Result**: a short persona line for the advisor ("decides alone, rejects 12 of 14 proposals: bring two options, not a recommendation") and a tone setting for every LLM-phrased sentence.

Guardrails: it is always labelled an interpretation, always shows its evidence, describes behaviour and never diagnoses a person. It is for the advisor's eyes only.

## 3. Architecture

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

Three registries, so that **connecting a piece means registering it**:

1. **Checks** (`app/engine/checks/`): `(client, ctx) => Finding[]`. One file per check, one line in the registry.
2. **Sections** (briefing tiers): each produces `Card[]` and declares `instant | fast | slow`. The UI requests all three tiers in parallel and renders each as it arrives. That is all the parallelism we need.
3. **Cards** (`app/src/cards/registry.tsx`): already exists.

The engine computes, the LLM phrases. No number reaches the screen unless deterministic code produced it. That is our answer to the 20% grounding criterion.

### Contracts v0

Code against these today. They land as TypeScript types plus JSON fixtures in `app/engine/`; change them in one place and say so in the commit.

```ts
type Finding = {
  id: string          // stable: `${check}:${clientRef}:${subject}`. Memory uses it to know "already rejected".
  check: string       // 'contradiction.fossil-fuel'
  kind: 'fact' | 'interpretation' | 'action'          // same vocabulary as app/src/types.ts
  severity: 'risk' | 'warn' | 'ok' | 'info'
  title: string       // German, one line, written for the advisor
  detail?: string
  numbers?: Record<string, number>                    // raw, fractions 0–1, never pre-formatted
  evidence: { source: string; ref?: string; quote?: string; date?: string }[]
  fix?: DraftProposal // smallest fix, same shape as clients.json → Proposals[]
  topic?: string      // links a finding to a conversation topic / chart module
}

type Check = (client: RawClient, ctx: { ref: ReferenceIndex; now: Date; memory: CallNote[] }) => Finding[]

type CallNote = {
  id: string; clientRef: string; date: string; confirmed: boolean
  proposed: { findingId?: string; text: string; reaction: 'accepted' | 'rejected' | 'open'; why?: string }[]
  promises: { text: string; due?: string; done: boolean }[]
  factUpdates: { note: string; status: 'confirmed' | 'outdated' | 'changed'; newValue?: string }[]
}
```

```
GET  /api/clients                        list for the dashboard
GET  /api/briefing/:ref?tier=instant     { cards: Card[], findings: Finding[] }   (also tier=fast, tier=slow)
POST /api/clients/upload                 a file shaped like clients.json (3 new ones arrive at the live demo)
POST /api/import/pdf                     ex-custody statement → virtual portfolio, same shape as Portfolios[]
POST /api/call/note · POST /api/call/note/:id/confirm
already there: /api/chat · /api/analyse · /api/transcribe · /api/status
```

An ex-custody portfolio is just a `Portfolios[]` entry with `isExCustody: true`. The engine needs no special case, and neither does the fix simulator: apply the fix to a copy, run the checks again, show before and after.

## 4. Tracks

Each track owns its own files, so agents running in parallel do not collide. Owner means "knows it best", not "has permission".

| | Track | Owner | Files | Delivers |
|---|---|---|---|---|
| **P0** | Foundation | Arash + Claude | `app/engine/{types,data,run}.ts`, fixtures, CI | Contracts, null-safe data index with fund look-through, check runner, fixtures, test harness |
| **E1** | Portfolio facts | Arash | `engine/checks/portfolio-*` | Performance and drivers, allocation vs SAA bands (asset class, currency, region, sector) with look-through, concentration, violations decoded, pending and rejected proposals |
| **E2** | Contradiction + fix | Arash | `engine/checks/contradiction-*`, `engine/fix/` | Wishes (notes, ESG, risk profile) vs holdings, smallest fix as a draft proposal, re-check that the fix breaks nothing else |
| **E3** | Context | Arash | `engine/checks/context-*` | Stale notes as questions, this client's own worst months, peers ("just this portfolio or the whole market?"), "clients like this did X" (aggregated, never naming anyone) |
| **E4** | Client profile | Arash | `engine/checks/profile-*` | Tone and behaviour from what the client said and did (section 2): persona line, tone setting, call-reason guess |
| **A1** | Briefing writer | Ahmet | `server/ai/briefing*` | Findings → the four 60-second blocks, likely questions, 3–5 next actions, in the client's tone (E4). Works without an LLM too (fallback) |
| **A2** | Live call copilot | Ahmet | `server/ai/call*`, `src/workspace/useCallAudio.ts` | Listening already works (ElevenLabs). Add only: to-dos the client asked for, and "show the data being talked about". Scripted call stays one click away. Biggest stage risk, so no more than that |
| **A3** | Memory | Ahmet | `server/memory*` | Post-call draft → one-tap confirm → SQLite → read by the engine. Seeded from rejected proposals |
| **A4** | Ask-the-data chat | Kaushik | `server/ai/chat*`, `src/components/ChatDock.tsx` | The on-demand twin of the live copilot: the advisor asks, the chat answers from the client's data, including niche questions no check covers (a single transaction, a fee, one position's history). The LLM only picks a tool and phrases the result; tools over the engine's data index do the lookup and the arithmetic, and every answer names its source. Says so when the data does not support an answer. Stretch, off by default: a fast outside search for things the data cannot hold (what a company does, a term), always labelled "outside source", never mixed into client numbers, and no client name or identifier in the query |
| **N1** | News + CIO view | Arash | `server/market/` | News items matched to each client's holdings with embeddings (including what sits inside funds) → `Signal[]`. Sample news file and a live source behind one interface. "This happened before, and here is what markets did next": decide when this track starts, it needs outside price data |
| **N2** | Outbound mode | free hands | `server/alerts*` | Light version: rank all clients by their findings and news hits into "who to call today", shown on the existing Anrufe & Signale page. No background watcher |
| **N3** | Ex-custody PDF | free hands | `server/import*` | PDF → virtual portfolio → same engine path (bonus points) |
| **U1** | Real data in the UI | Kaushik | `src/` | Mock replaced by the API, skeleton loading per tier, client-file upload |
| **U2** | New cards | Kaushik | `src/cards/` | Contradiction + fix (before/after), look-through, stale note, client profile, peers, to-dos, post-call confirm, click any statement to see its source |
| **U3** | 60-second format | Kaushik | `src/` | The four blocks with a reading-time bar, plus "why is the client calling" on inbound calls (section 2, bonus points) |

Integration is continuous and Claude's job. Everything plugs into a registry, so there is no big-bang merge at the end.

### Start now, nobody waits

- **Kaushik**: keep building against `src/data/mock.ts`. Its shape is the API shape; when the engine lands only the import changes. New cards can be built against hand-written findings in the `Finding` shape above. A4 starts from the existing `/api/chat` and `ChatDock.tsx`; its tools can read `clients.json` directly until the engine's data index lands.
- **Ahmet**: A1 and A3 only need `Finding[]` and `CallNote`. Until fixtures land, hand-write three findings from section 2 and build against them. A2 needs nothing from anyone.
- **Arash**: P0, then E1–E4 in parallel agents. N1 (news matching with embeddings) whenever he wants to start it; it depends on nothing but a sample news file.

## 5. Milestones

1. **M1 Real data.** Any of the 47 clients, and any uploaded file, renders a real briefing in the existing UI. Until this works nothing else counts.
2. **M2 Differentiators.** Contradiction + fix, look-through, stale notes, client profile and tone, the 60-second format, worst months, peers.
3. **M3 Enrichment.** Post-call memory, chat, news matching, "who to call today", call to-dos, PDF import.
4. **M4 Freeze.** Demo script on three hero clients, every live dependency rehearsed with its fallback, README explains mock vs production.

`main` is always demo-able. Rehearse the demo from a fresh clone before every milestone.

## 6. Risks

| Risk | Answer |
|---|---|
| Live demo brings 3 unseen client files; `reference.json` only covers today's 47 clients | Engine degrades on unknown securities (falls back to the position's own fields, says "unclassified"), never throws. A test feeds it a client with unknown IDs. |
| `DATA.md` promises "absent, never null" but explicit nulls exist (20 clients have `SuitabilityViolations: null`) | Null-safe accessors in one place, whole-dataset test |
| Live listening fails on stage (mic, latency, Swiss German) | Scripted call already exists in the UI; keep it one click away |
| LLM invents numbers | It never sees a task that needs arithmetic; it only phrases findings |
| LLM or news API down | Every live dependency has an offline fallback (pattern: example mode in `brain.ts`) |
| Real IBANs in the data | No names, IBANs or account numbers to an LLM, a log or a commit |

## 7. Decided

- Engine is TypeScript in `app/engine/`: shares types with the UI, runs in the same process, works on uploaded files. The repo is TypeScript only.
- Everyone pushes to `main`. CI is advisory. No hooks, no branch protection.
- UI text and LLM output in German (Swiss spelling). Code, commits and docs in English.

## 8. Finance words in plain language

| Word | Means |
|---|---|
| **Mandate** | The contract between client and bank: how the money may be invested ("balanced, in CHF"). |
| **SAA** (strategic asset allocation) | The target mix that mandate translates into, with a minimum and maximum per bucket: "40–60% shares". Outside the band is a problem to fix. |
| **Suitability** | The bank's legal duty to check that an investment fits this client: their risk appetite, wishes and mandate. A suitability violation is a broken rule. The judges sell this software. |
| **Risk profile** | How much up and down the client agreed to live with, measured by a questionnaire. Sets a ceiling on portfolio risk. |
| **Volatility** | How strongly a value swings. The usual number for "risk". |
| **ESG** | Sustainability preference: environment, social, governance. Here a yes/no flag plus a minimum score per holding. |
| **Look-through** | A fund is a basket of many shares. The position list shows the basket; look-through opens it and shows what is inside. |
| **Concentration / cluster risk** | Too much money in one share, sector or currency. |
| **Proposal** | A concrete set of trades the advisor suggests. Status in the data: final, rejected (`Abgelehnt`), draft. |
| **CIO view / house view** | The bank's official opinion on markets ("prefer European shares"). Advisors are expected to follow it. |
| **Ex-custody** | Assets the client keeps at another bank. Importing that statement shows the whole picture, and is how the bank wins those assets. |
| **FIDLEG** | The Swiss law that makes advisors document every piece of advice. |
