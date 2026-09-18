# CLAUDE.md

How we work in this repo. What we are building and who does what: [PLAN.md](PLAN.md). Official brief and judging criteria: [task.md](task.md).

## Ground rules

- **These are defaults, not gates.** The person you are working with outranks this file. If they ask for something different, do it, name the trade-off in one sentence, and move on. Never refuse or stall a teammate because of a rule in here.
- Anyone may change anything in any folder. Owners in PLAN.md mean "knows it best", not "has permission".
- Commit and push regularly: after each working change, commit it and push to `origin`.
- Do not add to or edit this file on your own initiative. Change it only when a person on the team asks. What belongs here is the team's decision.

## Git

- Everyone works on `main`. Pull when you start a task and again before every push: `git pull --rebase origin main`, then `git push`. One-time setup per clone: `git config pull.rebase true && git config rebase.autoStash true`.
- Small commits pushed often beat big ones. They keep merges trivial and let the others build on your work within minutes.
- `main` must always run, because any commit may be the one we demo. Unfinished code is fine to push as long as nothing imports it yet.
- Commit format: `type(scope): summary`, imperative, no full stop. Types: `feat fix docs test refactor chore ci`. Scopes: `ui engine ai voice memory market import data`. Add a body when the why is not obvious. Nothing enforces this: a badly named commit that is pushed beats a perfect one that is not.
- Conflict in `package-lock.json`: take either side, run `npm install` in `app/`, commit the result.
- Avoid force-pushing `main`. Three people push here and it silently deletes their work.
- Never commit secrets (`app/.env.local`), generated databases, models or recordings.

## Tests

- In `app/`: `npm run check` runs lint, typecheck and tests. Run it before you push. `npm test` runs tests only, `npm run test:watch` re-runs on save.
- CI runs the same on every push and is advisory. Red CI blocks nobody; it means "fix forward soon".
- Tests sit next to the code as `*.test.ts` (vitest).
- Every engine check gets a test against the real `clients.json`: one client where it must fire, one where it must not. The whole-dataset test (every check on all 47 clients, nothing throws) stays green.
- New pure logic gets a happy path and a missing-data case. UI components need no tests.
- Found a bug? Write the failing test first, then fix it.

## Code

- Add, don't restructure. A new check, section or card is a new file plus one line in a registry. Avoid moving or reformatting files someone else is working in.
- Engine code (`app/engine/`) is pure: no DOM, no Node APIs, no network, no `Date.now()`. The date arrives as `ctx.now`. That keeps it testable and lets it run on uploaded files anywhere.
- In `app/engine/` and `app/server/`, relative imports carry the `.ts` extension (the server side resolves as `nodenext`).
- Every live dependency (LLM, speech-to-text, news) has an offline fallback, so the demo never dies. Pattern: example mode in `app/src/workspace/brain.ts`.
- UI text and LLM output are German in Swiss spelling (ss, not ß). Code, new comments, commits and docs are English. Existing German comments stay.

## Grounding (20% of the score)

- The engine computes, the LLM phrases. No number reaches the screen unless deterministic code produced it.
- Every statement is a `fact`, an `interpretation` or an `action`, and names its source.
- If the data does not support an answer, say so. Never guess.
- A suggestion must pass the client's mandate, risk profile, ESG preference and stated wishes before it is shown.

## Data traps (verified against the real files)

- **Null and absent both happen.** `DATA.md` says "absent, never null", but 20 clients have `SuitabilityViolations: null`. Always `x ?? []`.
- Join on `SecurityId`, never on ISIN. One ISIN can be several securities, one per currency.
- Units: position and SAA percentages are fractions 0–1. `FundUnbundlingMappings[].Weight` is 0–100.
- Compare holdings against SAA bands with the `SAA_*` fields. The plain classification fields use a finer taxonomy that will not match.
- Dates are shifted. Engine logic never reads the wall clock; ages are relative to `ctx.now`.
- **Unknown securities will show up.** `reference.json` only covers today's 47 clients, and the 3 client files handed over at the live demo may hold securities we have never seen. Fall back to the position's own fields, call it "unclassified", never throw.
- Account `Currency` can be a crypto ticker (`BTC`, `ETH`), not an ISO code.
- IBANs in the data are real. No names, IBANs or account numbers go to an LLM, a log or a commit.

## Run

```
cd app && npm ci && npm run dev
```

API keys are optional: copy `app/.env.example` to `app/.env.local`. Without keys the app runs in example mode.
