FROM PING TO PITCH: AI FOR WEALTH MANAGERS

UNRISKOMEGA AG | WEALTHTECH · ADVISORY AI

Turn scattered client, portfolio and market data into a 60-second briefing.

About UNRISKOMEGA AG

UNRISKOMEGA is a Swiss WealthTech company providing modular digital investment advisory and self-service solutions for financial institutions. Its platform combines portfolio analytics, risk profiling, suitability and compliance checks, investment proposals and digital investment journeys. UnRiskOmega supports more than 25 banks, over 1,000 active advisors and 500,000 portfolios, combining expertise in banking, quantitative finance and enterprise software.

Description — From Ping to Pitch

Wealth managers regularly face short-notice client calls, unexpected meetings and time-consuming preparation for scheduled conversations. To prepare properly, they may need to review portfolio performance, asset allocation, suitability, investment rules, open proposals, client notes, market developments and the bank's current investment view. Collecting and interpreting all of this takes time that advisors often do not have.

Your challenge: Build a tool that generates a 60-second briefing for a wealth manager preparing for a client conversation.

Given a client identifier and a meeting context, the system should:

Retrieve the client's portfolio and relevant contextual information
Fetch current market data and the bank's investment view
Identify the most relevant portfolio developments
Detect risks, constraint violations or investment opportunities
Generate the three to five most appropriate next actions or concrete and relevant actions that the advisor could consider during or after the client conversation
Present the result clearly — the briefing must be structured for an advisor working under time pressure and should be readable in approximately 60 seconds

Required Briefing Content — The generated briefing should contain three core sections:

The client's current situation
The most relevant portfolio developments
The issues or opportunities that deserve attention
The likely questions the client may raise
The most appropriate next steps

1. Recent Portfolio Development
The objective is a practical tool that reduces preparation time, improves advisor confidence and supports more consistent, informed client conversations. Explain how the portfolio has developed and identify the main drivers. Relevant information may include:

Recent portfolio performance
Positions or asset classes with the largest positive or negative contribution
Concentration in individual securities, sectors or currencies
Changes in suitability, mandate compliance or risk levels

2. Risks and Opportunities
Flag developments that require the advisor's attention. Relevant information may include:

Mandate or constraint violations
Suitability concerns
Asset class or factor exposures outside mandate
Open investment proposals still pending
External market developments affecting the portfolio

3. Next Best Actions
Recommend the three to five most appropriate steps for the advisor to take based on all available information.

Deep Dive — The Core Product Experience

The briefing assistant should integrate with the URO Advisor Pro environment and be accessible from within the advisor's existing workflow.

Available Data:

Client context: balanced mandate, CHF portfolio
Portfolio: 62% equity, +1.8% MTD, led by quality equities
Market news: 14 items, 2 relevant
Bank CIO view: Overweight quality
Risk to flag: USD exposure 3pts above mandate band
Next best action: Propose a currency hedge on the USD sleeve

Example scenario (Three Client, One Advisor):
Client A has an aggressive mandate focused on global equities and recently expressed interest in sustainable investments. The portfolio is concentrated in US technology equities and shows a currency mismatch relative to the mandate baseline. The market has recently experienced significant volatility in the technology sector.

Client B has a balanced mandate in CHF. The portfolio has underperformed the benchmark over the last quarter. The bank's CIO has issued a positive outlook for European equities. The client has asked about sustainable investment options in a previous interaction.

Client C has a conservative mandate with a strong preference for capital preservation. The portfolio holds a position in a bond fund that has recently been flagged for a suitability concern. The client has an upcoming review meeting scheduled. The client has indicated an investment goal for a property purchase in the following year.

The assistant should combine these facts into one briefing that explains:

What caused the portfolio decline
Whether the development is isolated or market-wide
Why it matters for this client
Which risks or constraints require attention
Which actions the advisor could discuss during the call

The advisor should receive a useful conversation briefing rather than three separate data summaries.

Bonus Challenges

Ex-Custody Portfolio Import
Allow the advisor to upload a portfolio statement from another custodian as a PDF. The solution should:

Extract the portfolio positions
Identify weights and currencies
Assign positions to the appropriate asset classes
Create a virtual portfolio
Label it clearly as an ex-custody portfolio
Include it in the portfolio analysis and 60-second briefing

The virtual portfolio should behave like a portfolio already available in the system.

Interactive Follow-Up Assistant
Build a follow-up assistant that the advisor can query after receiving the initial briefing. The assistant should:

Accept natural language questions
Answer using the same client, portfolio and market data as the briefing
Provide specific, concise and grounded answers
Handle situations where the answer is not supported by the available data
Be useful during a live client conversation without disrupting the interaction

Creative Briefing Experience
Design an original format for presenting the 60-second briefing. The format should make the information faster or easier to understand and be appropriate for professional wealth management.

Judging Criteria
Problem–Solution Fit — 25% — Does the solution address the actual workflow of a wealth manager? Does it reduce preparation time? Does it improve the quality of the conversation?
Technical Implementation — 20% — Is the prototype functional and demonstrable? Are the data sources used correctly? Are the boundaries between mock components and potential production integrations clearly explained? Does the team demonstrate a credible path toward integration with URO Advisor Pro?
AI Quality, Relevance and Grounding — 20% — Is the briefing specific to the selected client and portfolio? Does it identify and prioritize the most important information? Does it connect portfolio data, client context, market news and the bank's investment view meaningfully? Are the explanations factually supported by the available inputs? Are facts, interpretations and recommended actions distinguishable? Are the next best actions specific and practically useful? Does the output avoid generic observations and unsupported conclusions?
User Experience — 20% — Is the interface usable under time pressure? Can the advisor navigate efficiently? Is the briefing format readable and professional? Does the workflow reflect how an advisor would prepare for a client interaction?
Bonus Features and Creativity — 15% — Up to 15% of the total score for meaningful extensions:
Ex-Custody Import: Can the solution read a PDF portfolio statement, extract positions, assign asset classes, and incorporate the imported portfolio into analysis and briefing?
Interactive Follow-Up: Can the advisor ask follow-up questions? Are answers based on the same context as the briefing? Are they specific, concise and grounded?
Creative Briefing Experience: Has the team developed an original, useful briefing format? Does it improve speed/ease of understanding? Is it appropriate for professional wealth management?
Prize

Golden Prize for the Gold Standard Solution — 1st place

Links

GitHub – Data: https://github.com/START-Hack/unriskomega-2026