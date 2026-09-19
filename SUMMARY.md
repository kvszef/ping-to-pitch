# SUMMARY

What we built, how it works, and what every piece of information on the screen means. Written for someone who is not a finance person. Deeper material: [README.md](README.md) (diagrams, mock vs production), [PLAN.md](PLAN.md) (architecture, finance words in section 8), [PROGRESS.md](PROGRESS.md) (status), [AUDIT.md](AUDIT.md) (content audit of the numbers).

## 1. In one paragraph

**From Ping to Pitch.** A bank client calls their advisor. Before the advisor says hello, the screen shows a 60-second briefing built from that client's real data: what happened, what is wrong, what to say, what to propose, and what not to bring up. During the call the tool listens and brings up the right figure when the client asks something. After the call it drafts the call note (a legal duty in Switzerland, FIDLEG), the advisor confirms it with one tap, and the next briefing remembers it. The same data also ranks which clients the advisor should call today, and prepares that call.

## 2. How it works, in six steps

1. **Data in.** The client file (portfolios, positions, proposals, rule violations, notes), the bank's reference data (what each security is, what each fund contains, the target mix per strategy), optionally a PDF statement from another bank, and what was said in earlier calls.
2. **The engine checks everything.** 26 small checks, plain code, no AI (`app/engine/checks/`). Each returns *findings*: one sentence, the raw numbers behind it, and the evidence (which position, which rule, which note with its date). It runs in under 100 ms per client, also on a file it has never seen.
3. **The AI only phrases.** A model turns the findings into the talk track in the client's tone. It never calculates. Every line it writes must cite the findings it stands on, and every number in it must appear literally in those findings, otherwise the line is dropped. Without an API key a template writes the briefing instead.
4. **The screen fills in three waves.** *Instant* (facts, flags, contradictions: well under a second), *fast* (the phrased talk track: about 7 s with a model), *slow* (news matched to the holdings).
5. **The call.** The advisor's desk and the client's phone page are connected over the internet. Speech is transcribed live; a screen agent follows the transcript and shows the one graph that answers what the client just asked.
6. **Memory.** After hanging up, the model drafts the call note: what was proposed, how the client reacted, what was promised. One tap confirms it. Open promises and rejected ideas come back in the next briefing.

The rule behind all of it: **the engine computes, the model phrases.** No number reaches the screen unless plain code produced it. If the data does not support an answer, the tool says so.

## 3. What you see, screen by screen

**Client list.** All clients with assets, strategy, last consultation and open items. On top, *Call today*: a ranking of who to call and why. A client moves up for a risk (a broken rule, bad news on a big holding) or an opportunity (news or the bank's house view fits something the client wants). The client's own file weighs more than headlines.

**Client card** (left, in the workspace).

| Item | Means |
|---|---|
| Profile (e.g. "Anlageprofil 5") | The risk profile: how much up and down the client agreed to live with, from a questionnaire. Sets a ceiling on portfolio risk. |
| Strategy / service | The agreed way of investing ("Investor profile 5") and the kind of mandate (the bank advises, or the bank decides). |
| ESG | The sustainability preference: "Wants sustainable investing" or "No sustainability preference". |
| Last consultation | Date of the last proposal. Long ago is a reason to get in touch. |
| Rule violations | How many of the bank's suitability rules are broken right now (errors and warnings). *Suitability* = the bank's legal duty to check that investments fit this client. |
| Persona line | One sentence on how this client tends to decide, from what they said and did. Always an interpretation, for the advisor's eyes only. |

**Why is the client calling** (incoming call). A ranked guess from the data: an open draft proposal, bonds maturing soon, a recent note, a weak month, news on a big holding.

**The 60-second talk track.** Four blocks, about 150 words.

| Block | Content |
|---|---|
| Open with | The one sentence to start the call, in this client's tone |
| Must mention | Violations, contradictions, the smallest fix with before and after |
| Ask | Expired notes turned into questions, open promises from the last call |
| Don't bring up | Ideas the client already rejected, topics the notes say to avoid |

**Brief tiles and graph column.** The findings as short tiles in speaking order (occasion, positions, history, proposal, earlier cases). The graph column shows pinned graphs and, during a call, one graph per client question. Any small chart opens large on click.

**Chat ("ask the data").** The advisor asks anything about this client: a holding (also inside funds), transactions, cash, value history. The model only picks a lookup tool and phrases the result; the tools do the lookup and the arithmetic, and every answer names its source. What the data cannot answer (fees, the history of a single position, exact trade dates) the chat says it cannot answer.

**Text overview.** The same content as one readable text, for printing or for an advisor who prefers reading over tiles.

**Outgoing call: the call plan.** For a client from *Call today*: the goal of the call, the arguments (the client's own wish, the agreed strategy, the client's own history, the house view), and an opener.

**During the call.** Live transcript above the chat; talk-track points are ticked off as they are covered; the screen agent answers client questions with a short note for the advisor and the matching graph. A scripted demo call is one click away if the microphone fails.

**After the call.** The drafted call note: proposals with the client's reaction, promises with due dates, facts that changed. Confirm, edit or discard.

**Phone page** (`/call.html`). The client's side of the demo call. It lists every client, including files uploaded at the desk.

**Upload.** A client file in the export's format opens at once with a full briefing. *External custody account (PDF)* reads a statement from another bank into a virtual portfolio, so the briefing covers the client's whole wealth ("ex-custody" = assets held elsewhere; showing them is how a bank wins them).

**Settings.** Language (English by default, German on request), AI provider (OpenAI, Apertus the Swiss open model, or example mode without any key), level of detail.

## 4. Every kind of finding, in plain words

Each finding is a **fact** (the data says so), an **interpretation** (our reading, always labelled) or an **action** (something to do), has a severity (risk, warning, info, ok) and names its source.

| Finding | Says | Example (illustrative wording) |
|---|---|---|
| Performance | How the portfolio did last month, 3 months, this year, 12 months, and its worst month | "−5.0% last month, +22.4% over 12 months" |
| Allocation vs band | The mix (shares, bonds, cash, ...) against the agreed target range (*SAA band*). Outside the band is a mandate breach. Regions and sectors are compared inside the share part, with funds opened up (*look-through*) | "Shares 72%, above the maximum of 65%" |
| Unclassified share | Securities the bank's reference data does not know. Shares are then minimum values and the tool says the comparison is incomplete instead of asserting a breach | "55% of the portfolio cannot be classified" |
| Concentration | Largest positions, positions that carry far more risk than their weight, single-security cluster risk, large foreign-currency share | "Alphabet is 25% of the value but 35% of the risk" |
| Risk | Volatility (how strongly the value swings) against the ceiling of the risk profile and the band of the strategy | "Volatility 12.6% above the risk profile (max. 12.0%)" |
| Violations | The bank's own rule run, decoded into plain words. Some refer to a portfolio that is not in the file; those are labelled so | "Foreign currency share above 50%: 81.6%" |
| Proposals | Open drafts, rejected proposals with their reason, how many the client accepted | "Rejected on 20.08.2024: «Tax year-end rebalancing»" |
| Maturities | Bonds that mature soon and need reinvesting | "3 bonds mature by 21.10.2026" |
| Liquidity | Cash on accounts against an amount a note asks for | "Accounts CHF 8'800, below the CHF 15'000 needed for tax payment" |
| External custody | What the imported statement adds to total wealth | "at Beispielbank AG: CHF 100'000, 15.8% of total wealth" |
| House view | The bank's official market opinion compared with the portfolio, and a re-checked trade that closes a gap. Today an example view | "Opportunity: house view overweights bonds, portfolio below target" |
| Contradiction | A wish from a note against the holdings, also inside funds, with the smallest sale that fixes it and a re-check that the sale breaks nothing else | "Wish «No fossil fuels», portfolio holds 3.4% energy, all through funds" |
| Wish cannot be verified | The data has no category for the wish; the tool says so instead of guessing | "Wish «No defence» is noted but cannot be verified" |
| Other wishes | ESG minimum score per holding, a cash reserve, no unhedged foreign currency, stated interests with suitable options from the recommendation list | "3 positions below the ESG minimum score" |
| Note not checked | A note no rule could read. Shown to be read by a person, never silently dropped | |
| Stale note | A plan whose time window has passed becomes a question, not a statement | "Outdated: Property purchase – time window ended on 10.10.2025" |
| Plan | A dated plan that still runs, with the months left | "Retirement: 20 months left" |
| Peers | Same risk profile, aggregates only, never a name: is it this portfolio or the whole market? | "Last month −5.3%, similar clients −4.9%" |
| Own history | The client's own worst drawdowns and how long recovery took | |
| Promise from a call | What the advisor promised last time and has not closed | "Promised: send the benchmark comparison" |
| Profile: traits, tone, call reason | Behaviour read from notes and decisions: decides alone or delegates, reacts to losses, wants to be asked. Sets the tone of every phrased sentence | "Tone: brief and factual" |
| News hit | A recent article about something the client holds, with the exposure in % including funds. The headline is never translated or rewritten | "S&P 500 (4% of the portfolio): ..." |

Numbers look the same in both languages, Swiss style: `80'000`, `23.9%`, `14.10.2026`.

## 5. Why you can trust what it says (grounding)

- Every sentence carries its source: the position, the rule, or the note with its date.
- The model never sees a task that needs arithmetic. Its lines are checked: finding ids must exist, numbers must match literally, else the line is dropped and the template line is used.
- A translation that changes a number is refused.
- A suggestion is only shown if it passes the mandate, the risk profile, the ESG preference and the client's stated wishes; a fix is applied to a copy and all checks run again.
- No names, IBANs or account numbers go to a model, a log or a commit. The client list sent to the browser has account fields stripped.
- Missing data is said out loud: "cannot be classified", "cannot be verified", "not in the data".

## 6. What is real and what is an example

| Real | Example or stand-in |
|---|---|
| The 47 client files and the reference data, every engine check, the look-through into funds | The house view (replace with the bank's monthly publication as JSON via `HOUSE_VIEW_FILE`) |
| Uploaded client files and PDF statements | The ten sample statements' ISINs are partly fictitious; unknown ones are classified from the statement and marked |
| Live news search per holding, judged by a model or by keyword rules | The saved news snapshot, used without network |
| Live call between desk and phone page with transcription | The scripted demo calls |
| Call notes written by a model and confirmed by the advisor | Notes live only in the running server's store |

Every live dependency has a fallback, so the demo never goes blank: no API key → template briefing, keyword chat answers, keyword news judge, example mode for the screen agent; no network → news snapshot; no microphone → scripted call.

## 7. Languages

English is the default, German (Swiss spelling) is one click in the top bar. Engine, briefing, cards, chat, news, PDF import, call note and every model prompt phrase natively in the chosen language (`app/engine/lang.ts`); fixed labels come from a hand-written dictionary, instantly and offline. Data is never translated: note quotes, rule names, security names, headlines.

## 8. Rehearsed on 2026-09-19

Three made-up client files, as the live demo will bring three unseen ones: (1) securities the reference data does not know, a crypto account, explicit nulls, an expired plan; (2) a company with an unknown risk profile, an unknown target mix, no history and missing keys; (3) other id formats, an empty portfolio, zero positions, one ISIN in two currencies.

Result: upload 0.02 s, no check fails, instant tier 0.02–0.9 s, phrased talk track about 7 s, English without any German left, chat and news work, all three are ranked in *Call today* and listed on the phone page. 409 tests green, among them every check on all 47 clients in both languages.

Found and fixed in the rehearsal: uploaded clients never reached the phone page; with unknown securities the engine asserted "shares below the minimum" although half the portfolio was unclassified; plans in notes were only recognised in the exact wording of the case data; "ESG: No" and "Portfolio unknown" said nothing.

## 9. Known limits

- No cost basis and trades are undated: no gains or losses per position.
- The bank's violation list is a snapshot: 83 agree with ours, 25 only ours, 7 only the bank's.
- 29 of 57 portfolios have no strategy, so no target mix to measure against.
- Almost all portfolios fell 3–8% in July 2026; the peer comparison is what keeps this from reading as client-specific bad news.
- Uploaded files and call notes live in the running server only; a restart forgets them.
- German news headlines stay German in English mode.

## 10. Still open before the demo

Demo script on three hero clients (CASE-004 fossil fuels inside funds, CASE-007 expired property note, CASE-012 twelve rejected proposals); a rehearsal of every fallback (no key, no network, no microphone); a run from a fresh clone.
