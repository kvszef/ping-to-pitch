import type { Client } from '../types'
import type { Detail, ModuleSpec, Topic } from './types'

// English for the example mode (no model, or the model failed): what brain.ts says when the advisor's
// language is English. The German topics (derive.ts for real client files, data/workspace.ts for the
// sample clients) stay the source of ids, keywords, severity and figures; this file only rewords them,
// by hand. Figures are formatted exactly as in the German text, and anything quoted from the data
// (notes, rule names, «…») stays as it is. A topic without English wording comes back unchanged.

// English keywords per topic id, matched next to the German ones whatever the display language is: a call
// can be held in English while the screen is German. Prefix match like the German keywords; a trailing $
// means whole word, for short English words that start German ones («note» in «Notenbank», «fund» in «fundiert»).
export const KEYWORDS_EN: Record<string, string[]> = {
  // sample clients (data/workspace.ts)
  technologie: ['technology', 'loss', 'losing', 'lost$', 'fell$', 'fallen', 'dropped', 'drop$', 'decline', 'price', 'why$'],
  dollar: ['currenc', 'franc$', 'francs$', 'hedg', 'exchange', 'fx$'],
  nachhaltig: ['sustainab', 'green$', 'climate'],
  klumpen: ['cluster', 'concentrat', 'reduc', 'sell$', 'selling', 'trim$', 'largest', 'biggest'],
  rueckstand: ['behind', 'lagging', 'lagged', 'underperform', 'return', 'worse', 'compar', 'benchmark', 'why$'],
  europa: ['europe', 'rebalanc', 'reallocat', 'view$'],
  fonds: ['fund$', 'funds$', 'bond$', 'bonds$', 'rated$', 'reclassif', 'letter', 'flagged', 'sell$', 'selling'],
  immobilie: ['property', 'estate', 'house$', 'home$', 'flat$', 'apartment', 'purchase', 'buying', 'deposit', 'liquidity', 'cash$', 'safe$'],
  // derived topics (derive.ts)
  wertentwicklung: ['return', 'loss', 'losing', 'lost$', 'fell$', 'fallen', 'dropped', 'drop$', 'decline', 'gain', 'worth$', 'value$'],
  konzentration: ['holding', 'stock$', 'stocks$', 'equit', 'cluster', 'concentrat', 'largest', 'biggest', 'risk$', 'risky'],
  waehrungen: ['currenc', 'franc$', 'francs$', 'exchange', 'foreign', 'hedg', 'fx$'],
  regeln: ['rule$', 'rules$', 'violat', 'breach', 'suitab', 'warning', 'overweight', 'underweight'],
  vorschlaege: ['propos', 'reject', 'accept', 'recommend', 'suggest'],
  notizen: ['note$', 'notes$', 'noted$', 'wish', 'goal', 'said$', 'mention'],
}

export const keywordHit = (word: string, keyword: string) => (keyword.endsWith('$') ? word === keyword.slice(0, -1) : word.startsWith(keyword))

type Wording = Pick<Topic, 'label' | 'say' | 'why' | 'next' | 'insight'> & { sources?: string[]; title?: string; note?: string }

// Source names, chart labels and month names as the German topics write them.
const SOURCES_EN: Record<string, string> = {
  Positionen: 'Positions', Performancebeitrag: 'Performance contribution', 'Marktnachrichten (Beispiel)': 'Market news (example)', 'CIO-Sicht (Beispiel)': 'CIO view (example)',
  'SAA-Währungsband': 'SAA currency band', Kundennotiz: 'Client note', 'ESG-Profil': 'ESG profile', Empfehlungsliste: 'Recommendation list', Regelverletzungen: 'Rule violations',
  Performanceverlauf: 'Performance history', 'SAA-Länderband': 'SAA country band', Wertschriftenstamm: 'Security master data', Konten: 'Accounts', Risikoprofil: 'Risk profile',
  'Wertverlauf des Portfolios': 'Portfolio value history', 'Positionen des Portfolios': 'Portfolio positions', 'Positionen und Konten des Portfolios': 'Portfolio positions and accounts',
  'Eignungsprüfung (Regelverletzungen)': 'Suitability check (rule violations)', 'Vorschläge des Kunden': 'Client proposals', Kundennotizen: 'Client notes',
}
const LABELS_EN: Record<string, string> = {
  Übrige: 'Other', Schweiz: 'Switzerland', Nordamerika: 'North America', 'Übriges Europa': 'Rest of Europe', 'Asien/Pazifik': 'Asia/Pacific',
  Liquidität: 'Liquidity', Obligationen: 'Bonds', Aktien: 'Equities', Immobilien: 'Real estate',
}
const MONTHS_EN: Record<string, string> = {
  Januar: 'January', 'Jan.': 'Jan', Februar: 'February', 'Feb.': 'Feb', März: 'March', Mär: 'Mar', 'Apr.': 'Apr', Mai: 'May', Juni: 'June', Juli: 'July',
  'Aug.': 'Aug', 'Sept.': 'Sep', Oktober: 'October', 'Okt.': 'Oct', Okt: 'Oct', 'Nov.': 'Nov', Dezember: 'December', 'Dez.': 'Dec', Dez: 'Dec',
}
// «Juli 2025» → «July 2025»; anything else (an English label, a position name) stays.
const label = (text: string) => {
  if (LABELS_EN[text]) return LABELS_EN[text]
  const [first, ...rest] = text.split(' ')
  return MONTHS_EN[first] ? [MONTHS_EN[first], ...rest].join(' ') : text
}

function specEn(spec: ModuleSpec, title?: string, note?: string): ModuleSpec {
  const head = { title: title ?? spec.title, note: note ?? spec.note }
  return spec.type === 'balken' ? { ...spec, ...head, bars: spec.bars.map((b) => ({ ...b, label: label(b.label) })) } : { ...spec, ...head, points: spec.points.map((p) => ({ ...p, label: label(p.label) })) }
}

// ---- derived topics: the same sentences as derive.ts, in English, from the same computed figures ----

const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
const share = (v: number) => `${v.toFixed(1)}%`
const levels = (kurz: string, standard: string, detailliert: string): Record<Detail, string> => ({ kurz, standard: `${kurz} ${standard}`.trim(), detailliert: `${kurz} ${standard} ${detailliert}`.trim() })
const NOTES_EN: Record<string, string> = { 'Wertveränderung aus Monatsendwerten, nicht um Ein- und Auszahlungen bereinigt.': 'Change in value from month-end values, not adjusted for deposits and withdrawals.' }

function derivedEn(client: Client, id: string): Wording | undefined {
  const f = client.facts
  if (!f) return undefined
  const p = f.performance
  if (id === 'wertentwicklung' && p) {
    const note = NOTES_EN[p.note] ?? p.note
    return {
      label: 'Performance',
      say: `Your assets changed by ${signed(p.month)} last month and stand at ${signed(p.ytd)} since the start of the year.`,
      why: `As of ${f.asOf ?? 'unknown'}. Weakest month since ${label(p.startLabel)}: ${label(p.worst.label)} at ${signed(p.worst.value)}.`,
      next: `Put the month (${signed(p.month)}) next to the weakest month, ${label(p.worst.label)} (${signed(p.worst.value)}), and ask whether the swings still fit the goal.`,
      insight: levels(
        `Last month ${signed(p.month)}, since the start of the year ${signed(p.ytd)}, since ${label(p.startLabel)} ${signed(p.sinceStart)}.`,
        `The weakest month was ${label(p.worst.label)} at ${signed(p.worst.value)}.${f.risk ? ` Volatility ${share(f.risk.volatility)}, value at risk ${share(f.risk.valueAtRisk)}.` : ''}`,
        note,
      ),
      title: 'Value history, 12 months', note: `Indexed to 100. ${note}`,
    }
  }
  const top = f.positions[0]
  if (id === 'konzentration' && top) {
    const three = f.positions.slice(0, 3)
    const threeSum = three.reduce((n, x) => n + x.share, 0)
    return {
      label: 'Largest positions',
      say: `${top.name} makes up ${share(top.share)} of your assets${top.riskShare ? ` and contributes ${share(top.riskShare)} of the risk` : ''}. Would you like to keep this weight?`,
      why: `The three largest of ${f.positionCount} positions add up to ${share(threeSum)}.`,
      next: `Ask whether ${top.name} (${share(top.share)}) is deliberately this large, and agree an upper limit per security.`,
      insight: levels(
        `${top.name} is the largest of ${f.positionCount} positions at ${share(top.share)}.`,
        `The three largest: ${three.map((x) => `${x.name} ${share(x.share)}`).join(', ')}, together ${share(threeSum)}.`,
        three.some((x) => x.riskShare) ? `Share of portfolio risk: ${three.filter((x) => x.riskShare).map((x) => `${x.name} ${share(x.riskShare!)}`).join(', ')}.` : '',
      ),
      title: 'Largest positions', note: "Share of the client's total assets.",
    }
  }
  const foreign = f.currencies.filter((c) => c.label !== 'CHF')
  if (id === 'waehrungen' && foreign[0]) {
    const home = f.currencies.find((c) => c.label === 'CHF')
    const all = f.currencies.map((c) => `${c.label} ${share(c.share)}`).join(', ')
    return {
      label: 'Currencies',
      say: `${home ? `${share(home.share)} of your assets are in Swiss francs, ` : ''}${share(foreign[0].share)} in ${foreign[0].label}. Exchange rates therefore move ${home ? share(100 - home.share) : 'part'} of your assets.`,
      why: all,
      next: `Clarify whether the ${foreign[0].label} share of ${share(foreign[0].share)} is intended or should be hedged.`,
      insight: levels(`Currencies by position and account: ${all}.`, 'Without look-through into funds: the currency of the fund counts, not what it holds.', ''),
      title: 'Currencies', note: 'By position and account currency, without look-through into funds.',
    }
  }
  // The flag texts and the note are data (engine wording or the advisor's own words): quoted, not reworded.
  const flags = client.briefing.flatMap((c) => (c.type === 'flags' ? c.items : [])).filter((i) => i.severity === 'risk' || i.severity === 'warn')
  if (id === 'regeln' && flags[0]) {
    return {
      label: 'Rule violations',
      say: `One requirement in your portfolio is not met: ${flags[0].text}. I would like to discuss with you how we fix that.`,
      why: `${client.errors} errors and ${client.warnings} warnings from the suitability check.`,
      next: `For «${flags[0].text.replace(/[«»]/g, '')}», propose the smallest reallocation that meets the requirement again.`,
      insight: levels(`${client.errors} errors, ${client.warnings} warnings. Most important: ${flags[0].text}.`, flags.length > 1 ? `Others: ${flags.slice(1, 4).map((x) => x.text).join('; ')}.` : '', ''),
    }
  }
  const pr = f.proposals
  if (id === 'vorschlaege' && pr.total > 0) {
    const status = (s: string) => (s === 'Final' ? 'implemented' : s === 'Abgelehnt' ? 'rejected' : s === 'Entwurf' ? 'draft' : s === 'ohne Status' ? 'no status' : s)
    return {
      label: 'Earlier proposals',
      say: pr.last ? `Our last proposal of ${pr.last.date} ${pr.last.status === 'Final' ? 'has been implemented' : pr.last.status === 'Abgelehnt' ? 'was rejected by you' : 'is still open'}. I will pick up from there today.` : `We have made you ${pr.total} proposals so far.`,
      why: `${pr.accepted} of ${pr.total} proposals implemented, ${pr.rejected} rejected${pr.draft ? `, ${pr.draft} in draft` : ''}.`,
      next: pr.rejected > pr.accepted ? `The client rejected ${pr.rejected} of ${pr.total} proposals: offer two options to choose from instead of one recommendation.` : `Pick up from the proposal of ${pr.last?.date ?? 'last time'} and have the implementation confirmed.`,
      insight: levels(`${pr.accepted} of ${pr.total} proposals implemented, ${pr.rejected} rejected.`, pr.last ? `Last proposal ${pr.last.date}: ${status(pr.last.status)}${pr.last.reason ? `, reason «${pr.last.reason}»` : ''}.` : '', ''),
    }
  }
  const notes = client.briefing.flatMap((c) => (c.type === 'context' ? c.notes : []))
  if (id === 'notizen' && notes[0]) {
    return {
      label: 'Latest note',
      say: `Last time we noted: «${notes[0].text}». Does that still hold?`,
      why: `Note of ${notes[0].date}.`,
      next: `Have the note of ${notes[0].date} confirmed or updated.`,
      insight: levels(`Note of ${notes[0].date}: «${notes[0].text}».`, notes.slice(1, 3).map((n) => `${n.date}: «${n.text}»`).join(' '), ''),
    }
  }
  return undefined
}

// ---- sample clients: data/workspace.ts, reworded. Key = client ref + topic id. ----

const SAMPLE_EN: Record<string, Wording> = {
  'CASE-A:technologie': {
    label: 'Technology decline',
    say: 'The decline comes almost entirely from the technology sector and affects the whole market, not individual securities in your portfolio.',
    why: '3.1 of the 4.2 percentage points come from three US technology stocks; all major indices are affected.',
    next: 'Raise the cluster risk: bring the largest position back from 13.4% to around 8%.',
    insight: {
      kurz: 'Down 4.2% this month, 3.1 points of it from US technology (34% of the portfolio). Market-wide move.',
      standard: 'The portfolio is down 4.2% in the current month. US technology makes up 34% and explains 3.1 percentage points of the decline. Volatility has risen across the sector; there is no cause specific to a single security. Since the start of the year the portfolio still stands at +6.1%.',
      detailliert: 'The portfolio is down 4.2% in the current month and stands at +6.1% since the start of the year. US technology makes up 34% of the portfolio (5 positions); the three biggest losers all belong to this sector and explain 3.1 of the 4.2 percentage points. Volatility has risen in all major indices, so the move is market-wide. The house view on US technology is neutral and recommends quality stocks. The equity share of 88% is within the mandate band (65–95%), so the mandate does not require a sale. Action is needed only on the cluster risk of a single security above 10%.',
    },
    title: 'Portfolio value, last 12 months', note: 'Decline in September after eleven months of gains; still above the level at the start of the year.',
  },
  'CASE-A:dollar': {
    label: 'USD overweight',
    say: 'Your dollar share is above what we agreed in the mandate. I suggest hedging the US equity share into Swiss francs, without selling anything.',
    why: 'USD share 61% against a mandate band of up to 50%; the dollar has been weakening for three days.',
    next: 'Prepare a hedging proposal and obtain consent for around 11 percentage points of the US equity share.',
    insight: {
      kurz: 'USD 61%, band 30–50%: 11 points above. Hedging brings the share back into the band.',
      standard: 'The USD share is 61%, 11 percentage points above the upper mandate band of 50%. The dollar has weakened against the franc three days in a row. A CHF hedge of the US equity share brings the share back into the band without any sales.',
      detailliert: 'The USD share is 61% against a mandate band of 30–50% (target 40%), so 11 percentage points above the maximum. CHF at 24% is below its band of 35–60%, EUR at 12% is within its band. The dollar has weakened against the franc three days in a row (market signal S-3). A CHF hedge on around 11 percentage points of the US equity share brings the share back into the band without sales and without tax consequences. The violation is recorded under the SAA currency band rule.',
    },
    title: 'Currency shares against the mandate band', note: 'USD is 11 points above the band, CHF correspondingly below.',
  },
  'CASE-A:nachhaltig': {
    label: 'Sustainable investments',
    say: 'You had asked about sustainable investments. I have prepared two global equity funds from our recommendation list that fit your mandate.',
    why: 'Interest recorded in the client note; ESG profile «Ja».',
    next: 'Send the two funds from the recommendation list as an investment proposal and agree a follow-up meeting.',
    insight: {
      kurz: 'ESG profile «Ja», interest noted. Two suitable funds on the recommendation list.',
      standard: 'The client has an ESG profile «Ja» and has expressed interest in sustainable investments (client note). The recommendation list holds two global equity funds that meet the minimum rating and would lower the US technology concentration at the same time.',
      detailliert: 'The client has an ESG profile «Ja» (minimum rating 5.7) and has expressed interest in sustainable investments (client note). The recommendation list holds two global equity funds that meet the minimum rating. Swapping them for the largest technology position would also fix the cluster risk and slightly lower the USD share. The sample data holds no sustainability ratings for the positions held today.',
    },
  },
  'CASE-A:klumpen': {
    label: 'Cluster risk',
    say: 'A single position has grown to more than 10%. I recommend bringing it back to around 8%. That is a rule, not a judgement on the security.',
    why: 'Suitability rule «Klumpenrisiko Einzelinstrument» violated.',
    next: 'Address the proceeds: suggest a sustainable global equity fund as a replacement.',
    insight: {
      kurz: 'Largest position 13.4%, limit 10%. Reducing it to 8% fixes the violation.',
      standard: 'The largest single position makes up 13.4% of the portfolio; the limit is 10%. Reducing it to around 8% fixes the rule violation and lowers the technology concentration at the same time.',
      detailliert: 'The largest single position makes up 13.4% of the portfolio; the limit of the suitability rule is 10%. The five largest positions hold 41% of the assets, four of them in US technology. Reducing the largest position to around 8% fixes the rule violation, lowers the technology concentration and reduces the USD share by about 5 percentage points.',
    },
    title: 'Largest positions, share of the portfolio', note: 'Only the largest position exceeds the limit of 10%.',
  },
  'CASE-B:rueckstand': {
    label: 'Lag behind the target allocation',
    say: 'The lag comes from the allocation, not from the choice of securities: too little Europe and rather a lot of liquidity in a rising market.',
    why: 'European equities 7 points below target, liquidity 9% instead of 5%.',
    next: 'Move on to the solution: close the Europe underweight with the liquidity at hand.',
    insight: {
      kurz: '+0.6% in the quarter against +2.0% for the target allocation. Cause: Europe underweight and 9% liquidity.',
      standard: 'The portfolio returned +0.6% in the current quarter, the target allocation +2.0%. The lag of 1.4 percentage points comes from the underweight in European equities (7 points below target) and the liquidity of 9%. Security selection was neutral.',
      detailliert: 'The portfolio returned +0.6% in the current quarter, the target allocation +2.0%. The lag of 1.4 percentage points comes from the underweight in European equities (6% instead of 13%) and the liquidity of 9% against a target of 5%. Security selection was neutral. The data holds no benchmark; the comparison is against the strategic target allocation of the mandate. The house view on Europe has turned positive, which supports a reallocation.',
    },
    title: 'Portfolio value, last 12 months', note: 'Sideways since June while the target allocation gained.',
  },
  'CASE-B:europa': {
    label: 'European equities',
    say: 'Our investment strategists now see Europe positively. You are underweight there, and we can close that gap with the liquidity at hand.',
    why: 'House view raised from neutral to overweight; rule «Untergewicht Übriges Europa» active.',
    next: 'Fix the amount: 5 percentage points of liquidity, trigger the investment proposal during the call.',
    insight: {
      kurz: 'Europe 6% instead of 13%. House view newly positive. Reallocate 5 points of liquidity.',
      standard: 'European equities make up 6%; the target is 13%. The CIO has raised Europe from neutral to overweight. 5 percentage points from liquidity close most of the underweight.',
      detailliert: 'European equities make up 6% of the portfolio; the target is 13% (band 8–18%). The suitability rule «Untergewicht in der Aktienregion Übriges Europa» is active as a warning. The CIO has raised Europe from neutral to overweight (market signal S-2). With 5 percentage points from liquidity (9% today, target 5%) Europe rises to 11% and is within the band; the equity share rises from 44% to 49% and stays within the band of 35–55%.',
    },
    title: 'Equity regions against the mandate band', note: 'Only «Rest of Europe» is outside the band.',
  },
  'CASE-B:nachhaltig': {
    label: 'Sustainable investments',
    say: 'For the reallocation into Europe I can offer you a sustainable option, which combines both.',
    why: 'Earlier enquiry in the client note.',
    next: 'Include a sustainable European equity fund in the investment proposal and send the comparison.',
    insight: {
      kurz: 'Earlier enquiry noted. Sustainable European equity fund on the recommendation list.',
      standard: 'The client asked earlier about sustainable investment options (client note). The recommendation list holds a sustainable European equity fund that suits the reallocation.',
      detailliert: 'The client asked earlier about sustainable investment options (client note). No ESG profile is on file, so there is no requirement, only an expressed interest. The recommendation list holds a sustainable European equity fund that suits the reallocation. The sample data holds no cost comparison with the conventional option.',
    },
  },
  'CASE-C:fonds': {
    label: 'Flagged bond fund',
    say: 'A fund in your portfolio has been reclassified and no longer fits your profile. I recommend selling it and will show you a calmer alternative.',
    why: 'Product risk class above the maximum of the investment profile; 12% weight.',
    next: 'Clarify the use of the proceeds: park them in the money market until the property purchase.',
    insight: {
      kurz: 'Fund with 12% weight, risk class above the profile maximum. A sale fixes the violation.',
      standard: 'The bond fund makes up 12% of the portfolio. Its product risk class was raised and is now above the maximum of the conservative profile. The violation is recorded as an error; a sale fixes it.',
      detailliert: "The bond fund makes up 12% of the portfolio (around CHF 50'400). Its product risk class was raised in the security master data (market signal S-4) and is now above the maximum of the conservative profile. The violation is recorded as an error, not as a warning. A sale fixes it; the bond share falls from 71% to 59% and stays within the band of 50–80%. The proceeds also cover part of the liquidity needed for the property purchase.",
    },
    title: 'Allocation against the mandate band', note: 'All asset classes are within the band; liquidity is at the lower end.',
  },
  'CASE-C:immobilie': {
    label: 'Property purchase',
    say: 'For your property purchase we should set the money aside now. I suggest parking the proceeds from the fund in the money market until the purchase.',
    why: 'Liquidity need within 12 months noted; liquidity only 6%.',
    next: 'Ask for the amount and timing of the purchase and record them as a client note.',
    insight: {
      kurz: "Liquidity 6% (around CHF 25'000). Needed within 12 months, amount still open.",
      standard: "Liquidity is 6% of assets, around CHF 25'000. According to the client note a property purchase is planned within 12 months. Amount and timing are not recorded and must be clarified in the call.",
      detailliert: "Liquidity is 6% of assets, around CHF 25'000. According to the client note a property purchase is planned within 12 months. Amount and timing are not recorded and must be clarified in the call. With the sale of the flagged fund, liquidity rises to 18% (around CHF 75'600) and stays within the band of up to 25%. The money market suits a horizon of 12 months; at 4.1% the portfolio volatility is below the maximum of 5.5%.",
    },
    title: 'Portfolio value, last 12 months', note: 'Calm path, in line with the conservative profile.',
  },
}

// Conversation openers of the sample market signals (data/mock.ts), by signal id.
export const OPENERS_EN: Record<string, { title: string; opener: string }> = {
  'S-1': { title: 'Technology sector: volatility up sharply', opener: 'Your portfolio is affected by the decline in the technology sector. I would like to put it into context with you briefly.' },
  'S-2': { title: 'House view: European equities now positive', opener: 'Our investment strategists now see Europe positively. You are underweight there, and we could close that gap with the liquidity at hand.' },
  'S-3': { title: 'USD/CHF: the dollar keeps weakening', opener: 'The weaker dollar hits your portfolio more than most. I have a hedging proposal for you.' },
  'S-4': { title: 'Bond fund: product risk class raised', opener: 'A fund in your portfolio has been reclassified and no longer fits your profile. I will show you an alternative.' },
}

/** The topic in English: same id, keywords, severity and figures. Unchanged when there is no English wording for it. */
export function englishTopic(client: Client, topic: Topic): Topic {
  const en = SAMPLE_EN[`${client.ref}:${topic.id}`] ?? derivedEn(client, topic.id)
  if (!en) return topic
  const { title, note, sources, ...wording } = en
  return {
    ...topic, ...wording,
    sources: sources ?? topic.sources.map((s) => SOURCES_EN[s] ?? s),
    ...(topic.module ? { module: { ...topic.module, spec: specEn(topic.module.spec, title, note) } } : {}),
  }
}
