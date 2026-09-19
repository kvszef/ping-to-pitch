// Shared reading for the profile.* checks (E4): what the client said (notes), did (proposals) and holds, as signals.
// Not a check itself. Pure: the date comes from ctx.now. Cached per raw client, like clientOf.
//
// Notes in the case data are a fixed set of English sentences; each known one is mapped to signals and a neutral gist
// of our own wording (German and English; never the note's text). Gists never mention health: a note that does is
// reduced to its financial part. Unknown notes carry no signal. Signals hold both languages, so the cache ignores ctx.lang.
import { ageInYears, combinedHistory, daysBetween, type Client, type Note, type Proposal } from '../data.ts'
import { sourceName, type Lang } from '../lang.ts'
import type { CheckContext, Evidence, RawClient } from '../types.ts'
import { clientOf, srcOf } from './common.ts'

export type Signal =
  | 'control' // wants to be asked / informed before changes
  | 'autonomy' // decides alone, declines proposals
  | 'simple' // prefers few changes
  | 'values' // sustainability or exclusion wishes
  | 'family' // manages or plans for family members
  | 'calm' // stays calm in downturns
  | 'riskAverse'
  | 'riskTolerant'
  | 'reserve' // wants a cash cushion
  | 'brief' // hard to reach, short contact
  | 'written' // wants things in writing
  | 'discreet' // wants little in writing
  | 'interest' // a stated investment interest
  | 'ask' // an open wish or plan: a plausible reason to call

type NoteRule = { re: RegExp; signals: Signal[]; gist: string; gistEn: string; interest?: string; interestEn?: string }

const NOTE_RULES: NoteRule[] = [
  { re: /follow-up call before any changes|vor (jeder|allen) Änderung/i, signals: ['control', 'ask'], gist: 'Wünscht vor jeder Änderung am Dauerauftrag einen Rückruf', gistEn: 'Wants a call back before any change to the standing order' },
  { re: /detailed written summary/i, signals: ['control', 'written'], gist: 'Wünscht nach jedem Gespräch eine ausführliche schriftliche Zusammenfassung', gistEn: 'Wants a detailed written summary after every conversation' },
  { re: /declines most proposals|carry the decisions on (his|her|their) own/i, signals: ['autonomy'], gist: 'Trifft die Entscheide lieber selbst, lehnt die meisten Vorschläge höflich ab', gistEn: 'Prefers to make the decisions alone, politely declines most proposals' },
  { re: /self-directed/i, signals: ['autonomy'], gist: 'Langjährig und selbstbestimmt, kam nach mehreren Banken hierher', gistEn: 'Long-standing and self-directed, came here after several other banks' },
  { re: /simple, disciplined strategy/i, signals: ['simple', 'calm'], gist: 'Will eine einfache, disziplinierte Strategie statt häufiger Anpassungen', gistEn: 'Wants a simple, disciplined strategy rather than frequent adjustments' },
  { re: /annual review meeting held, no change/i, signals: ['simple'], gist: 'Jahresgespräch geführt, keine Strategieänderung gewünscht', gistEn: 'Annual review held, no change of strategy wanted' },
  { re: /no direct positions in fossil/i, signals: ['values'], gist: 'Keine direkten Positionen in fossilen Energien', gistEn: 'No direct positions in fossil fuels' },
  { re: /avoid any exposure to fossil/i, signals: ['values'], gist: 'Kein Engagement in fossilen Energien', gistEn: 'No exposure to fossil fuels' },
  { re: /ESG-compliant/i, signals: ['values'], gist: 'ESG-konform, keine Rüstung und kein Tabak', gistEn: 'ESG-compliant, no weapons and no tobacco' },
  { re: /human-rights controvers/i, signals: ['values'], gist: 'Keine Firmen mit Menschenrechts-Kontroversen', gistEn: 'No companies with human-rights controversies' },
  { re: /weighting of sustainable funds/i, signals: ['values', 'ask'], gist: 'Beim nächsten Rebalancing möglichst viele nachhaltige Fonds', gistEn: 'As many sustainable funds as possible at the next rebalancing', interest: 'nachhaltige Fonds', interestEn: 'sustainable funds' },
  { re: /power of attorney/i, signals: ['family'], gist: 'Verwaltet mit Vollmacht auch das Portfolio eines Familienmitglieds', gistEn: 'Also manages the portfolio of a family member under a power of attorney' },
  { re: /expects an inheritance/i, signals: ['family', 'ask'], gist: 'Erwartet ein Erbe, Strategie dann überprüfen', gistEn: 'Expects an inheritance, review the strategy then' },
  { re: /estate and succession planning/i, signals: ['family', 'ask'], gist: 'Nachlass- und Nachfolgeplanung wird überprüft', gistEn: 'Estate and succession planning is under review' },
  { re: /extremely patient investor/i, signals: ['calm'], gist: 'Sehr geduldig, kurzfristige Schwankungen sind kein Thema', gistEn: 'Very patient, short-term swings are not a concern' },
  { re: /philosophical answers/i, signals: ['calm'], gist: 'Antwortet bei Risikofragen überlegt, fast philosophisch', gistEn: 'Answers risk questions thoughtfully, almost philosophically' },
  { re: /much to learn, the markets still have/i, signals: ['calm'], gist: 'Nimmt Marktschwankungen gelassen und mit Humor', gistEn: 'Takes market swings calmly and with humour' },
  { re: /client keeps current classification/i, signals: ['calm'], gist: 'Risikoprofil nach dem Einbruch besprochen, Einstufung bleibt', gistEn: 'Risk profile discussed after the downturn, classification stays' },
  { re: /very risk-averse since the last market downturn/i, signals: ['riskAverse'], gist: 'Seit dem letzten Einbruch sehr risikoscheu, bevorzugt defensive Anlagen', gistEn: 'Very risk-averse since the last downturn, prefers defensive investments' },
  { re: /comfortable with higher volatility/i, signals: ['riskTolerant', 'calm'], gist: 'Akzeptiert höhere Schwankungen dank langem Anlagehorizont', gistEn: 'Accepts higher volatility thanks to a long investment horizon' },
  { re: /comfortable with high concentration risk/i, signals: ['riskTolerant'], gist: 'Akzeptiert hohe Klumpenrisiken und starke Schwankungen', gistEn: 'Accepts high cluster risks and strong swings' },
  { re: /forward-looking, high-conviction/i, signals: ['riskTolerant'], gist: 'Bevorzugt Überzeugungspositionen statt defensiver Anlagen', gistEn: 'Prefers high-conviction positions to defensive investments' },
  { re: /not concerned by short-term volatility in thematic/i, signals: ['riskTolerant', 'calm'], gist: 'Langer Horizont, Schwankungen bei Themenanlagen sind kein Thema', gistEn: 'Long horizon, swings in thematic investments are not a concern' },
  { re: /open to increasing the equity allocation/i, signals: ['riskTolerant', 'ask'], gist: 'Offen für mehr Aktien, wenn die Märkte stabil bleiben', gistEn: 'Open to more equities if markets stay stable', interest: 'mehr Aktien', interestEn: 'more equities' },
  // The case note names medical costs as the reason: only the cushion itself is used.
  { re: /cash reserve on hand/i, signals: ['reserve'], gist: 'Will eine Barreserve für Unvorhergesehenes halten', gistEn: 'Wants to keep a cash reserve for the unexpected' },
  { re: /small reserve on hand at all times/i, signals: ['reserve'], gist: 'Will stets eine kleine Reserve halten, «für alle Fälle»', gistEn: 'Wants to keep a small reserve at all times, «just in case»' },
  { re: /prefers email communication/i, signals: ['brief'], gist: 'Bevorzugt E-Mail, telefonisch schwer erreichbar', gistEn: 'Prefers email, hard to reach by phone' },
  { re: /best contacted after 6pm/i, signals: ['brief'], gist: 'Tagsüber schwer erreichbar, am besten nach 18 Uhr', gistEn: 'Hard to reach during the day, best after 6 pm' },
  { re: /not to be contacted during business hours/i, signals: ['brief'], gist: 'Werktags während der Bürozeiten nicht kontaktieren', gistEn: 'Do not contact during business hours on weekdays' },
  { re: /semi-annual phone contact/i, signals: ['brief'], gist: 'Telefonkontakt halbjährlich, keine unangemeldeten Besuche', gistEn: 'Phone contact every six months, no unannounced visits' },
  { re: /minimal written correspondence/i, signals: ['discreet'], gist: 'Diskret: möglichst wenig Schriftliches zu Portfoliodetails', gistEn: 'Discreet: as little as possible in writing about portfolio details' },
  { re: /high-dividend stocks/i, signals: ['interest', 'ask'], gist: 'Wünscht Fokus auf Dividendentitel für laufendes Einkommen', gistEn: 'Wants a focus on dividend stocks for regular income', interest: 'Dividendentitel', interestEn: 'dividend stocks' },
  { re: /swiss small caps/i, signals: ['interest', 'ask'], gist: 'Will stärker in Schweizer Nebenwerte investieren', gistEn: 'Wants to invest more in Swiss small caps', interest: 'Schweizer Nebenwerte', interestEn: 'Swiss small caps' },
  { re: /chf-hedged/i, signals: ['interest'], gist: 'Fremdwährungen bevorzugt CHF-abgesichert', gistEn: 'Prefers foreign currencies hedged into CHF', interest: 'CHF-abgesicherte Anlagen', interestEn: 'CHF-hedged investments' },
  { re: /technology stocks in the portfolio closely/i, signals: ['interest', 'ask'], gist: 'Beobachtet die Technologietitel genau, möchte ausbauen', gistEn: 'Watches the technology stocks closely, would like to add', interest: 'Technologie', interestEn: 'technology' },
  { re: /space travel|spaceflight/i, signals: ['interest', 'ask'], gist: 'Fragt nach mehr Engagement in Luft- und Raumfahrt', gistEn: 'Asks about more exposure to aerospace', interest: 'Raumfahrt', interestEn: 'space' },
  { re: /interested in structured products/i, signals: ['interest', 'ask'], gist: 'Interessiert an strukturierten Produkten, Erstgespräch geführt', gistEn: 'Interested in structured products, first conversation held', interest: 'strukturierte Produkte', interestEn: 'structured products' },
  { re: /diversification across currencies/i, signals: ['interest', 'ask'], gist: 'Wünscht breitere Streuung über Währungen', gistEn: 'Wants broader diversification across currencies', interest: 'Währungsstreuung', interestEn: 'currency diversification' },
  { re: /consolidating multiple accounts/i, signals: ['ask'], gist: 'Möchte mehrere Konten zusammenlegen', gistEn: 'Would like to consolidate several accounts' },
  { re: /chemistry and the pharmaceutical/i, signals: ['interest'], gist: 'Interessiert sich für Chemie und Pharma', gistEn: 'Interested in chemicals and pharma', interest: 'Chemie und Pharma', interestEn: 'chemicals and pharma' },
  { re: /buy a property/i, signals: ['ask'], gist: 'Plant einen Immobilienkauf, Liquiditätsbedarf innert 12 Monaten', gistEn: 'Plans to buy a property, needs liquidity within 12 months' },
  { re: /retire in the next two years/i, signals: ['ask'], gist: 'Pensionierung in den nächsten zwei Jahren, steigender Liquiditätsbedarf', gistEn: 'Retirement within the next two years, rising need for liquidity' },
  { re: /Q1 tax payment/i, signals: ['ask'], gist: 'Braucht Liquidität für die Steuerzahlung im ersten Quartal', gistEn: 'Needs liquidity for the tax payment in the first quarter' },
  { re: /change of address/i, signals: ['ask'], gist: 'Möglicher Adresswechsel, Kontoangaben dann bestätigen', gistEn: 'Possible change of address, confirm the account details then' },
  { re: /charitable donation/i, signals: ['ask'], gist: 'Erwägt eine Spende aus dem Portfolio', gistEn: 'Is considering a donation from the portfolio' },
  { re: /comparison against the benchmark/i, signals: ['ask'], gist: 'Wünscht einen Vergleich mit der Benchmark', gistEn: 'Wants a comparison with the benchmark' },
  { re: /detail on transaction fees/i, signals: ['ask'], gist: 'Wünscht Details zu den Transaktionsgebühren', gistEn: 'Wants details on the transaction fees' },
  { re: /informed of the risks of structured products/i, signals: [], gist: 'Über Risiken strukturierter Produkte informiert und akzeptiert sie', gistEn: 'Informed about the risks of structured products and accepts them' },
  { re: /succession planning within the company/i, signals: ['ask'], gist: 'Nachfolgeregelung im Unternehmen, Ansprechperson kann wechseln', gistEn: 'Succession being arranged in the company, the contact person may change' },
]

export type ReadNote = Note & { signals: Signal[]; gist?: string; gistEn?: string; interest?: string; interestEn?: string; known: boolean }

export const readNote = (n: Note): ReadNote => {
  const rule = NOTE_RULES.find((r) => r.re.test(n.text))
  return rule ? { ...n, signals: rule.signals, gist: rule.gist, gistEn: rule.gistEn, interest: rule.interest, interestEn: rule.interestEn, known: true } : { ...n, signals: [], known: false }
}

// The gist and the interest label in the advisor's language. `gist` (German) stays the key notes are deduplicated on.
export const gistOf = (n: ReadNote, lang?: Lang) => (lang === 'en' ? n.gistEn ?? n.gist : n.gist)
export const interestOf = (n: ReadNote, lang?: Lang) => (lang === 'en' ? n.interestEn ?? n.interest : n.interest)

// Evidence for a note: our gist, never the original text (it can carry names or health details).
export const noteEvidence = (n: ReadNote, lang?: Lang): Evidence => ({ source: sourceName('note', lang), date: n.date, quote: gistOf(n, lang) ?? sourceName('note', lang) })

// ProposalStatusName values (see portfolio-proposals.ts).
export const ACCEPTED = 'Final', REJECTED = 'Abgelehnt', DRAFT = 'Entwurf'
export const proposalDate = (p: Proposal) => p.proposed ?? p.finalized ?? p.submitted
export const proposalEvidence = (p: Proposal, lang?: Lang) => srcOf(lang).proposal(p.id, proposalDate(p))

// Reasons that follow a client's reaction rather than a routine review.
const REACTIVE = new Set(['Market volatility follow-up', 'Change of risk tolerance', 'Risk profile update', 'Client called', 'Withdrawal request'])
// A month this bad is one a client feels. Same bar as portfolio.performance (our judgement).
export const BAD_MONTH = -0.03
// A proposal "follows" a bad month when it is dated within this many days after the month's end value.
const FOLLOWS_DAYS = 62

export type LifeStage = 'company' | 'minor' | 'early' | 'mid' | 'pre-retirement' | 'retired'

export type Signals = {
  client: Client
  age?: number
  stage?: LifeStage
  pension: boolean // holds a pension (Vorsorge) portfolio
  executionOnlyShare: number // share of AUM in execution-only portfolios (client trades without advice)
  notes: ReadNote[] // newest first
  has: (s: Signal) => ReadNote[]
  maxVola?: number; riskProfileName?: string
  heldVola?: number // value-weighted volatility of the portfolios that report one
  volaRatio?: number // heldVola / maxVola
  liquidityShare?: number
  esg?: 'Yes' | 'No'
  proposals: { all: Proposal[]; dated: Proposal[]; accepted: Proposal[]; rejected: Proposal[]; drafts: Proposal[]; years?: number }
  badMonths: { date: string; value: number }[] // monthly returns ≤ BAD_MONTH, date = end of the month's value
  afterLoss: { proposal: Proposal; month: { date: string; value: number } }[] // reactive proposals shortly after a bad month
  tags: { name: string; type?: string }[]
}

const cache = new WeakMap<RawClient, { ctx: CheckContext; signals: Signals }>()

export function signalsOf(raw: RawClient, ctx: CheckContext): Signals {
  const hit = cache.get(raw)
  if (hit && hit.ctx.ref === ctx.ref && hit.ctx.now.getTime() === ctx.now.getTime()) return hit.signals
  const signals = read(clientOf(raw, ctx.ref), ctx)
  cache.set(raw, { ctx, signals })
  return signals
}

function read(client: Client, ctx: CheckContext): Signals {
  const rawAge = ageInYears(client.birthday, ctx.now)
  const age = rawAge !== undefined && rawAge >= 0 && rawAge < 130 ? rawAge : undefined
  const stage: LifeStage | undefined = client.isCompany ? 'company'
    : age === undefined ? undefined : age < 18 ? 'minor' : age < 35 ? 'early' : age < 55 ? 'mid' : age < 65 ? 'pre-retirement' : 'retired'

  const aum = client.portfolios.reduce((a, p) => a + Math.max(0, p.value), 0)
  const pension = client.portfolios.some((p) => /vorsorge|pension/i.test(`${p.service ?? ''} ${p.name ?? ''}`))
  const exec = client.portfolios.filter((p) => /execution only/i.test(p.service ?? '')).reduce((a, p) => a + Math.max(0, p.value), 0)

  const notes = client.notes.map(readNote).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  // One note per gist: the case data repeats sentences with the same meaning.
  const has = (s: Signal) => notes.filter((n, i) => n.signals.includes(s) && notes.findIndex((m) => m.gist === n.gist && m.signals.includes(s)) === i)

  const profile = ctx.ref.riskProfile(client.riskProfileId)
  const withVola = client.portfolios.filter((p) => (p.volatility ?? 0) > 0 && p.value > 0)
  const volaBase = withVola.reduce((a, p) => a + p.value, 0)
  const heldVola = volaBase > 0 ? withVola.reduce((a, p) => a + p.value * (p.volatility ?? 0), 0) / volaBase : undefined
  const maxVola = profile?.maxVola && profile.maxVola > 0 ? profile.maxVola : undefined

  const totalAum = client.aum > 0 ? client.aum : aum
  const liquidityShare = client.liquidity !== undefined && totalAum > 0 ? Math.min(1, Math.max(0, client.liquidity / totalAum)) : undefined

  const all = client.proposals
  const dated = all.filter((p) => proposalDate(p)).sort((a, b) => proposalDate(a)!.localeCompare(proposalDate(b)!))
  const first = dated[0] && proposalDate(dated[0])
  const years = first ? Math.max(1, daysBetween(first, ctx.now) / 365.25) : undefined

  const history = combinedHistory(client.portfolios)
  const months: { date: string; value: number }[] = []
  for (let i = 1; i < history.length; i++) months.push({ date: history[i].date, value: history[i].value / history[i - 1].value - 1 })
  const badMonths = months.filter((m) => m.value <= BAD_MONTH)
  const afterLoss: Signals['afterLoss'] = []
  for (const p of dated) {
    if (!p.reason || !REACTIVE.has(p.reason)) continue
    const d = proposalDate(p)!
    const month = badMonths.find((m) => { const days = daysBetween(m.date, d); return days >= 0 && days <= FOLLOWS_DAYS })
    if (month) afterLoss.push({ proposal: p, month })
  }

  const esg = client.esgProfileName === 'Yes' || client.esgProfileName === 'No' ? client.esgProfileName : undefined
  return {
    client, age, stage, pension, executionOnlyShare: aum > 0 ? exec / aum : 0, notes, has,
    maxVola, riskProfileName: profile?.name ?? client.riskProfileName, heldVola,
    volaRatio: heldVola !== undefined && maxVola ? heldVola / maxVola : undefined,
    liquidityShare, esg,
    proposals: {
      all, dated, years,
      accepted: all.filter((p) => p.status === ACCEPTED), rejected: all.filter((p) => p.status === REJECTED), drafts: all.filter((p) => p.status === DRAFT),
    },
    badMonths, afterLoss, tags: client.tags,
  }
}
