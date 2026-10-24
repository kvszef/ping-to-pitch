# The challenge

Our summary of the UNRISKOMEGA challenge at START Global x Swiss AI Weeks 2026, written in our own words. The official brief and the case data come from UNRISKOMEGA AG and the organisers; the data is published at [github.com/START-Hack/unriskomega-2026](https://github.com/START-Hack/unriskomega-2026).

## The task: "From Ping to Pitch"

Wealth managers often get client calls at short notice. Preparing well means looking at performance, allocation, suitability, the bank's rules, open proposals, client notes, market news and the bank's investment view, and there is rarely time for that.

Build a tool that turns a client identifier and a meeting context into a briefing an advisor can read in about 60 seconds. It should:

- pull the client's portfolio and context, plus market data and the bank's investment view;
- find the portfolio developments that matter and what drove them;
- flag risks, rule or mandate breaches, and opportunities;
- anticipate what the client may ask;
- propose three to five concrete next steps.

The briefing should read as one conversation guide, not as separate data summaries, and it should say whether a development is specific to the client or market-wide.

## Bonus challenges

- **Ex-custody import:** read a PDF statement from another bank, extract positions, weights and currencies, classify them, and add them to the analysis as a clearly labelled virtual portfolio.
- **Follow-up assistant:** answer the advisor's questions in natural language from the same data as the briefing, briefly and with sources, and say so when the data does not support an answer.
- **Creative briefing format:** an original, professional way to make the briefing faster to take in.

## Judging criteria

| Criterion | Weight | In short |
| --- | --- | --- |
| Problem–solution fit | 25% | Fits the advisor's real workflow, saves preparation time, improves the conversation |
| Technical implementation | 20% | Works and can be demonstrated, uses the data correctly, separates mock from production, shows a path to integration with the bank's advisory platform |
| AI quality, relevance and grounding | 20% | Specific to the client, prioritised, connects portfolio, context, news and house view, every statement supported by the inputs, facts, interpretations and actions kept apart |
| User experience | 20% | Usable under time pressure, readable, professional |
| Bonus features and creativity | 15% | The three bonus challenges above |

Three further client files in the shape of the case data were handed over at the live presentation, so solutions had to accept new files rather than hard-code the dataset.
