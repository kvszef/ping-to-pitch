import type { Client } from '../types'

// MOCK DATA — shaped like what the analytics + LLM layer will return.
export const clients: Client[] = [
  {
    ref: 'CASE-A',
    name: 'Client A',
    mandate: 'Aggressive · Global equities · CHF',
    aum: "CHF 1'240'000",
    context: 'Short-notice call',
    alerts: 2,
    briefing: [
      { type: 'headline', text: 'Portfolio fell 4.2% this month — driven by US tech, and the sell-off is market-wide.', sub: 'Lead with the tech drawdown, then the USD mismatch. Client has asked about sustainable options.' },
      { type: 'metrics', items: [
        { label: 'MTD', value: '-4.2%', tone: 'risk' },
        { label: 'YTD', value: '+6.1%', tone: 'ok' },
        { label: 'Equity', value: '88%', delta: 'target 85%' },
        { label: 'USD exposure', value: '61%', delta: '+11pt vs band', tone: 'risk' },
      ] },
      { type: 'split', title: 'What happened', left: { title: 'Portfolio', points: [
        { text: 'US technology is 34% of the portfolio across 5 positions.', kind: 'fact', source: 'Positions' },
        { text: 'Top 3 detractors are all US tech and explain 3.1pt of the 4.2% decline.', kind: 'fact', source: 'Contribution' },
        { text: 'The decline is concentration-driven, not stock-specific.', kind: 'interpretation' },
      ] }, right: { title: 'Market', points: [
        { text: 'Tech sector volatility spiked across all major indices this month.', kind: 'fact', source: 'News (mock)' },
        { text: 'CIO view: neutral on US tech, overweight quality.', kind: 'fact', source: 'CIO view (mock)' },
        { text: 'The move is global, so peers are affected similarly.', kind: 'interpretation' },
      ] } },
      { type: 'flags', title: 'Needs attention', items: [
        { severity: 'risk', text: 'USD exposure 11pt above the mandate band.', source: 'SAA currency band' },
        { severity: 'warn', text: 'Cluster risk: single instrument above 10%.', source: 'Suitability rule' },
        { severity: 'info', text: 'Client expressed interest in sustainable investments.', source: 'Client note' },
      ] },
      { type: 'actions', title: 'Next best actions', items: [
        { text: 'Propose a CHF hedge on the USD equity sleeve.', why: 'Brings currency exposure back inside the band without selling.' },
        { text: 'Trim the largest tech position toward 8%.', why: 'Clears the cluster-risk violation.' },
        { text: 'Present 2 sustainable global equity funds from the recommendation list.', why: 'Follows up on the stated interest.' },
      ] },
      { type: 'questions', title: 'Likely questions', items: [
        { q: 'Should I sell my tech stocks?', a: 'Drawdown is sector-wide; mandate tolerates it. Trim only where cluster limits are breached.' },
        { q: 'Is my portfolio sustainable?', a: 'Partially — show the ESG split and the two fund alternatives.' },
      ] },
    ],
  },
  {
    ref: 'CASE-B',
    name: 'Client B',
    mandate: 'Balanced · CHF',
    aum: "CHF 680'000",
    context: 'Quarterly call',
    alerts: 1,
    briefing: [
      { type: 'headline', text: 'Underperformed by 1.4pt last quarter — an underweight in European equities is the main cause.', sub: 'The CIO just turned positive on Europe, so there is a clean story and a clean fix.' },
      { type: 'metrics', items: [
        { label: 'QTD', value: '+0.6%', delta: 'target mix +2.0%', tone: 'warn' },
        { label: 'Equity', value: '44%', delta: 'target 45%' },
        { label: 'Europe eq.', value: '6%', delta: '-7pt vs target', tone: 'warn' },
        { label: 'Cash', value: '9%' },
      ] },
      { type: 'split', title: 'What happened', left: { title: 'Portfolio', points: [
        { text: 'European equities sit 7pt below the SAA target.', kind: 'fact', source: 'SAA country band' },
        { text: 'Cash at 9% dragged in a rising market.', kind: 'fact', source: 'Positions' },
      ] }, right: { title: 'Market', points: [
        { text: 'CIO issued a positive outlook for European equities.', kind: 'fact', source: 'CIO view (mock)' },
        { text: 'The gap is allocation-driven and fixable within mandate.', kind: 'interpretation' },
      ] } },
      { type: 'flags', title: 'Needs attention', items: [
        { severity: 'warn', text: 'Underweight in equity region "Rest of Europe".', source: 'Suitability rule' },
        { severity: 'info', text: 'Asked about sustainable investment options previously.', source: 'Client note' },
      ] },
      { type: 'actions', title: 'Next best actions', items: [
        { text: 'Deploy 5pt of cash into a European equity fund.', why: 'Closes most of the underweight, aligned with the CIO view.' },
        { text: 'Offer a sustainable European equity option.', why: 'Combines the rebalance with the client\'s stated interest.' },
        { text: 'Send the benchmark comparison after the call.', why: 'Pre-empts the performance question in writing.' },
      ] },
      { type: 'questions', title: 'Likely questions', items: [
        { q: 'Why am I behind?', a: 'Allocation, not selection: too little Europe, too much cash.' },
      ] },
    ],
  },
  {
    ref: 'CASE-C',
    name: 'Client C',
    mandate: 'Conservative · Capital preservation · CHF',
    aum: "CHF 420'000",
    context: 'Review meeting',
    alerts: 2,
    briefing: [
      { type: 'headline', text: 'A bond fund is flagged for suitability, and the client needs cash for a property purchase within 12 months.', sub: 'Both point the same way: reduce risk and build liquidity.' },
      { type: 'metrics', items: [
        { label: 'YTD', value: '+1.9%', tone: 'ok' },
        { label: 'Volatility', value: '4.1%', delta: 'max 5.5%' },
        { label: 'Cash', value: '6%', tone: 'warn' },
        { label: 'Flagged', value: '1 pos.', tone: 'risk' },
      ] },
      { type: 'split', title: 'What happened', left: { title: 'Portfolio', points: [
        { text: 'Bond fund (12% weight) has a product risk class above the profile ceiling.', kind: 'fact', source: 'Suitability violation' },
        { text: 'Liquidity is 6% of assets.', kind: 'fact', source: 'Accounts' },
      ] }, right: { title: 'Client', points: [
        { text: 'Planning to buy a property, liquidity need within 12 months.', kind: 'fact', source: 'Client note' },
        { text: 'Current liquidity will not cover a down payment.', kind: 'interpretation' },
      ] } },
      { type: 'flags', title: 'Needs attention', items: [
        { severity: 'risk', text: 'Product risk class exceeds the client\'s maximum.', source: 'Suitability rule' },
        { severity: 'warn', text: 'Liquidity need is not reflected in the allocation.', source: 'Client note + accounts' },
      ] },
      { type: 'actions', title: 'Next best actions', items: [
        { text: 'Sell the flagged bond fund.', why: 'Resolves the suitability error.' },
        { text: 'Park proceeds in money market until the purchase.', why: 'Matches the 12-month horizon and preserves capital.' },
        { text: 'Confirm the amount and date of the purchase.', why: 'Sizes the liquidity reserve correctly.' },
      ] },
      { type: 'questions', title: 'Likely questions', items: [
        { q: 'Is my money safe for the purchase?', a: 'Not fully yet — the plan above earmarks it.' },
      ] },
    ],
  },
]
