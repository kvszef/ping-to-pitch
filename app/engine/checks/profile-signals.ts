// Shared reading for the profile.* checks (E4): what the client said (notes), did (proposals) and holds, as signals.
// Not a check itself. Pure: the date comes from ctx.now. Cached per raw client, like clientOf.
//
// Notes in the case data are a fixed set of English sentences; each known one is mapped to signals and a neutral German
// gist. Gists never mention health: a note that does is reduced to its financial part. Unknown notes carry no signal.
import { ageInYears, combinedHistory, daysBetween, type Client, type Note, type Proposal } from '../data.ts'
import type { CheckContext, Evidence, RawClient } from '../types.ts'
import { clientOf, SRC } from './common.ts'

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

type NoteRule = { re: RegExp; signals: Signal[]; gist: string; interest?: string }

const NOTE_RULES: NoteRule[] = [
  { re: /follow-up call before any changes|vor (jeder|allen) Änderung/i, signals: ['control', 'ask'], gist: 'Wünscht vor jeder Änderung am Dauerauftrag einen Rückruf' },
  { re: /detailed written summary/i, signals: ['control', 'written'], gist: 'Wünscht nach jedem Gespräch eine ausführliche schriftliche Zusammenfassung' },
  { re: /declines most proposals|carry the decisions on (his|her|their) own/i, signals: ['autonomy'], gist: 'Trifft die Entscheide lieber selbst, lehnt die meisten Vorschläge höflich ab' },
  { re: /self-directed/i, signals: ['autonomy'], gist: 'Langjährig und selbstbestimmt, kam nach mehreren Banken hierher' },
  { re: /simple, disciplined strategy/i, signals: ['simple', 'calm'], gist: 'Will eine einfache, disziplinierte Strategie statt häufiger Anpassungen' },
  { re: /annual review meeting held, no change/i, signals: ['simple'], gist: 'Jahresgespräch geführt, keine Strategieänderung gewünscht' },
  { re: /no direct positions in fossil/i, signals: ['values'], gist: 'Keine direkten Positionen in fossilen Energien' },
  { re: /avoid any exposure to fossil/i, signals: ['values'], gist: 'Kein Engagement in fossilen Energien' },
  { re: /ESG-compliant/i, signals: ['values'], gist: 'ESG-konform, keine Rüstung und kein Tabak' },
  { re: /human-rights controvers/i, signals: ['values'], gist: 'Keine Firmen mit Menschenrechts-Kontroversen' },
  { re: /weighting of sustainable funds/i, signals: ['values', 'ask'], gist: 'Beim nächsten Rebalancing möglichst viele nachhaltige Fonds', interest: 'nachhaltige Fonds' },
  { re: /power of attorney/i, signals: ['family'], gist: 'Verwaltet mit Vollmacht auch das Portfolio eines Familienmitglieds' },
  { re: /expects an inheritance/i, signals: ['family', 'ask'], gist: 'Erwartet ein Erbe, Strategie dann überprüfen' },
  { re: /estate and succession planning/i, signals: ['family', 'ask'], gist: 'Nachlass- und Nachfolgeplanung wird überprüft' },
  { re: /extremely patient investor/i, signals: ['calm'], gist: 'Sehr geduldig, kurzfristige Schwankungen sind kein Thema' },
  { re: /philosophical answers/i, signals: ['calm'], gist: 'Antwortet bei Risikofragen überlegt, fast philosophisch' },
  { re: /much to learn, the markets still have/i, signals: ['calm'], gist: 'Nimmt Marktschwankungen gelassen und mit Humor' },
  { re: /client keeps current classification/i, signals: ['calm'], gist: 'Risikoprofil nach dem Einbruch besprochen, Einstufung bleibt' },
  { re: /very risk-averse since the last market downturn/i, signals: ['riskAverse'], gist: 'Seit dem letzten Einbruch sehr risikoscheu, bevorzugt defensive Anlagen' },
  { re: /comfortable with higher volatility/i, signals: ['riskTolerant', 'calm'], gist: 'Akzeptiert höhere Schwankungen dank langem Anlagehorizont' },
  { re: /comfortable with high concentration risk/i, signals: ['riskTolerant'], gist: 'Akzeptiert hohe Klumpenrisiken und starke Schwankungen' },
  { re: /forward-looking, high-conviction/i, signals: ['riskTolerant'], gist: 'Bevorzugt Überzeugungspositionen statt defensiver Anlagen' },
  { re: /not concerned by short-term volatility in thematic/i, signals: ['riskTolerant', 'calm'], gist: 'Langer Horizont, Schwankungen bei Themenanlagen sind kein Thema' },
  { re: /open to increasing the equity allocation/i, signals: ['riskTolerant', 'ask'], gist: 'Offen für mehr Aktien, wenn die Märkte stabil bleiben', interest: 'mehr Aktien' },
  // The case note names medical costs as the reason: only the cushion itself is used.
  { re: /cash reserve on hand/i, signals: ['reserve'], gist: 'Will eine Barreserve für Unvorhergesehenes halten' },
  { re: /small reserve on hand at all times/i, signals: ['reserve'], gist: 'Will stets eine kleine Reserve halten, «für alle Fälle»' },
  { re: /prefers email communication/i, signals: ['brief'], gist: 'Bevorzugt E-Mail, telefonisch schwer erreichbar' },
  { re: /best contacted after 6pm/i, signals: ['brief'], gist: 'Tagsüber schwer erreichbar, am besten nach 18 Uhr' },
  { re: /not to be contacted during business hours/i, signals: ['brief'], gist: 'Werktags während der Bürozeiten nicht kontaktieren' },
  { re: /semi-annual phone contact/i, signals: ['brief'], gist: 'Telefonkontakt halbjährlich, keine unangemeldeten Besuche' },
  { re: /minimal written correspondence/i, signals: ['discreet'], gist: 'Diskret: möglichst wenig Schriftliches zu Portfoliodetails' },
  { re: /high-dividend stocks/i, signals: ['interest', 'ask'], gist: 'Wünscht Fokus auf Dividendentitel für laufendes Einkommen', interest: 'Dividendentitel' },
  { re: /swiss small caps/i, signals: ['interest', 'ask'], gist: 'Will stärker in Schweizer Nebenwerte investieren', interest: 'Schweizer Nebenwerte' },
  { re: /chf-hedged/i, signals: ['interest'], gist: 'Fremdwährungen bevorzugt CHF-abgesichert', interest: 'CHF-abgesicherte Anlagen' },
  { re: /technology stocks in the portfolio closely/i, signals: ['interest', 'ask'], gist: 'Beobachtet die Technologietitel genau, möchte ausbauen', interest: 'Technologie' },
  { re: /space travel|spaceflight/i, signals: ['interest', 'ask'], gist: 'Fragt nach mehr Engagement in Luft- und Raumfahrt', interest: 'Raumfahrt' },
  { re: /interested in structured products/i, signals: ['interest', 'ask'], gist: 'Interessiert an strukturierten Produkten, Erstgespräch geführt', interest: 'strukturierte Produkte' },
  { re: /diversification across currencies/i, signals: ['interest', 'ask'], gist: 'Wünscht breitere Streuung über Währungen', interest: 'Währungsstreuung' },
  { re: /consolidating multiple accounts/i, signals: ['ask'], gist: 'Möchte mehrere Konten zusammenlegen' },
  { re: /chemistry and the pharmaceutical/i, signals: ['interest'], gist: 'Interessiert sich für Chemie und Pharma', interest: 'Chemie und Pharma' },
  { re: /buy a property/i, signals: ['ask'], gist: 'Plant einen Immobilienkauf, Liquiditätsbedarf innert 12 Monaten' },
  { re: /retire in the next two years/i, signals: ['ask'], gist: 'Pensionierung in den nächsten zwei Jahren, steigender Liquiditätsbedarf' },
  { re: /Q1 tax payment/i, signals: ['ask'], gist: 'Braucht Liquidität für die Steuerzahlung im ersten Quartal' },
  { re: /change of address/i, signals: ['ask'], gist: 'Möglicher Adresswechsel, Kontoangaben dann bestätigen' },
  { re: /charitable donation/i, signals: ['ask'], gist: 'Erwägt eine Spende aus dem Portfolio' },
  { re: /comparison against the benchmark/i, signals: ['ask'], gist: 'Wünscht einen Vergleich mit der Benchmark' },
  { re: /detail on transaction fees/i, signals: ['ask'], gist: 'Wünscht Details zu den Transaktionsgebühren' },
  { re: /informed of the risks of structured products/i, signals: [], gist: 'Über Risiken strukturierter Produkte informiert und akzeptiert sie' },
  { re: /succession planning within the company/i, signals: ['ask'], gist: 'Nachfolgeregelung im Unternehmen, Ansprechperson kann wechseln' },
]

export type ReadNote = Note & { signals: Signal[]; gist?: string; interest?: string; known: boolean }

export const readNote = (n: Note): ReadNote => {
  const rule = NOTE_RULES.find((r) => r.re.test(n.text))
  return rule ? { ...n, signals: rule.signals, gist: rule.gist, interest: rule.interest, known: true } : { ...n, signals: [], known: false }
}

// Evidence for a note: the German gist, never the original text (it can carry names or health details).
export const noteEvidence = (n: ReadNote): Evidence => ({ source: 'Kundennotiz', date: n.date, quote: n.gist ?? 'Kundennotiz' })

// ProposalStatusName values (see portfolio-proposals.ts).
export const ACCEPTED = 'Final', REJECTED = 'Abgelehnt', DRAFT = 'Entwurf'
export const proposalDate = (p: Proposal) => p.proposed ?? p.finalized ?? p.submitted
export const proposalEvidence = (p: Proposal) => SRC.proposal(p.id, proposalDate(p))

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
