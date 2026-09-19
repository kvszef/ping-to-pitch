// What the advisor does with a finding: one short line, "so what → ask or do this".
// A finding states a number; this says what it means for the call. Deterministic: it reads only the finding's
// check, id, severity, numbers and rule code, never its phrased title, so it works the same in both languages.
// It asks and points, it never recommends a product: trades stay with the checked `fix` of a finding.
import { signedPct } from './format.ts'
import { pick, type Lang } from './lang.ts'
import type { Finding } from './types.ts'

const OK = ['Kein Handlungsbedarf.', 'Nothing to do.'] as const

export function nextStep(f: Finding, lang?: Lang): string | undefined {
  const t = pick(lang)
  const say = (pair: readonly [string, string] | undefined) => (pair ? t(pair[0], pair[1]) : undefined)
  return say(stepOf(f))
}

// The subject part of `${check}:${clientRef}:${subject}`.
const subjectOf = (f: Finding) => f.id.split(':').slice(2).join(':')

const INVEST = ['Das Geld liegt nicht angelegt da. Fragen, ob der Kunde investieren will oder es für etwas Bestimmtes bereithält.', 'The money is not invested. Ask whether the client wants to invest it or is keeping it ready for something specific.'] as const
const TOO_RISKY = ['Risiko senken: schwankungsstarke Positionen reduzieren. Oder mit dem Kunden prüfen, ob sein Risikoprofil noch stimmt.', 'Bring the risk down: reduce the positions that swing most. Or check with the client whether the risk profile still fits.'] as const
const TOO_CAUTIOUS = ['Fragen, ob der Kunde bewusst vorsichtiger anlegt. Wenn ja, Strategie anpassen; wenn nein, Aktienanteil erhöhen.', 'Ask whether the client invests more cautiously on purpose. If yes, change the strategy; if no, raise the equity share.'] as const
const CLUSTER = ['Viel hängt an diesem einen Titel. Fragen, ob der Kunde bewusst daran festhält, und eine schrittweise Reduktion anbieten.', 'A lot depends on this one security. Ask whether the client holds on to it on purpose, and offer to reduce it step by step.'] as const
const CURRENCY = ['Wechselkurse bewegen diesen Teil direkt. Fragen, ob das Währungsrisiko gewollt ist, sonst CHF-abgesicherte Varianten anbieten.', 'Exchange rates move this part directly. Ask whether the currency risk is wanted, otherwise offer CHF-hedged alternatives.'] as const
const OVERWEIGHT = ['Fragen, ob das Übergewicht eine bewusste Überzeugung ist. Sonst Richtung Zielgewicht umschichten.', 'Ask whether the overweight is a deliberate conviction. Otherwise shift towards the target weight.'] as const
const UNDERWEIGHT = ['Fragen, ob der Kunde diesen Bereich bewusst meidet. Sonst aufstocken, damit das Portfolio breiter abgestützt ist.', 'Ask whether the client avoids this area on purpose. Otherwise build it up so the portfolio stands on a broader base.'] as const
const CASH_SHORT = ['Das Geld reicht nicht. Besprechen, welche Position dafür verkauft wird, und zwar rechtzeitig vor dem Termin.', 'The cash does not cover it. Discuss which position is sold for it, in good time before the date.'] as const
const WISH_MET = ['Wunsch ist erfüllt: kurz bestätigen, das schafft Vertrauen.', 'The wish is met: confirm it briefly, it builds trust.'] as const
const build = (shares: boolean) => [`Fragen, ob der Kunde ${shares ? 'Aktien' : 'Obligationen'} aufbauen will. Wenn nicht, passt die gewählte Strategie nicht mehr zu ihm.`, `Ask whether the client wants to build up ${shares ? 'shares' : 'bonds'}. If not, the chosen strategy no longer fits.`] as const

function violationStep(f: Finding): readonly [string, string] {
  if (subjectOf(f).startsWith('override:')) return ['Nur zur Kenntnis: diese Regel wird bei diesem Kunden bewusst nicht geprüft.', 'For information only: this rule is deliberately not checked for this client.']
  const rule = f.evidence[0]?.quote ?? ''
  const n = f.numbers ?? {}
  if (/volatility/i.test(rule) && n.portfolioVolatility !== undefined) return ['Die zwei Zahlen widersprechen sich. Meldung zuerst bei der Bank neu rechnen lassen, bevor sie beim Kunden zum Thema wird.', 'The two figures contradict each other. Have the bank rerun the check before raising it with the client.']
  if (/maximum volatility|range exceeded/i.test(rule)) return TOO_RISKY
  if (/range undershot/i.test(rule)) return (n.actual ?? 1) < 0.005 ? INVEST : TOO_CAUTIOUS
  const min = /^Minimum limit (shares|fixed income)/i.exec(rule)
  if (min) return build(min[1].toLowerCase() === 'shares')
  if (/^Maximum limit liquidity/i.test(rule)) return INVEST
  if (/^Cluster risk of a single/i.test(rule)) return CLUSTER
  if (/^Foreign currency/i.test(rule)) return CURRENCY
  if (/overweight in the equity/i.test(rule)) return OVERWEIGHT
  if (/underweight in the equity/i.test(rule)) return UNDERWEIGHT
  if (/not part of the investment universe/i.test(rule)) return ['Die Bank überwacht diesen Titel nicht. Dem Kunden sagen, dass er ihn ohne unsere Einschätzung hält.', 'The bank does not monitor this security. Tell the client that they hold it without our assessment.']
  if (/^Knowledge of/i.test(rule)) return ['Die Produktkenntnisse sind nicht dokumentiert. Produkt erklären und bestätigen lassen, sonst die Position abbauen.', 'The product knowledge is not on file. Explain the product and have it confirmed, otherwise reduce the position.']
  return ['Vor dem Gespräch mit Compliance klären, was diese Meldung auslöst.', 'Before the call, clarify with compliance what triggers this violation.']
}

function allocationStep(f: Finding): readonly [string, string] | undefined {
  const s = subjectOf(f)
  const n = f.numbers ?? {}
  if (s.endsWith(':no-target')) return ['Execution only: der Kunde entscheidet selbst. Nur informieren, keine Empfehlung nötig.', 'Execution only: the client decides alone. Inform only, no recommendation needed.']
  if (s.endsWith(':mix')) return (n['AssetClass.Liquidity'] ?? 0) >= 0.3 ? INVEST : ['Überblick über die Aufteilung, kein Handlungsbedarf.', 'Overview of the split, nothing to do.']
  if (s.includes(':CurrencyGroup')) return CURRENCY
  if (s.endsWith(':AssetClass')) {
    const over = (n.actual ?? 0) > (n.limit ?? 0)
    const cls = ['Liquidity', 'Shares', 'Bonds'].find((c) => n[`${c}.actual`] === n.actual && (n[`${c}.max`] === n.limit || n[`${c}.min`] === n.limit))
    if (cls === 'Liquidity' && over) return INVEST
    if (!over && (cls === 'Shares' || cls === 'Bonds')) return build(cls === 'Shares')
    return over
      ? ['Der Anteil liegt über dem, was die Strategie erlaubt. Reduktion vorschlagen oder prüfen, ob die Strategie noch passt.', 'The share is above what the strategy allows. Suggest reducing it or check whether the strategy still fits.']
      : ['Der Anteil liegt unter dem, was die Strategie verlangt. Aufbau vorschlagen oder prüfen, ob die Strategie noch passt.', 'The share is below what the strategy requires. Suggest building it up or check whether the strategy still fits.']
  }
  return (n.deviation ?? 0) >= 0 ? OVERWEIGHT : UNDERWEIGHT
}

function riskStep(f: Finding): readonly [string, string] | undefined {
  const s = subjectOf(f)
  const n = f.numbers ?? {}
  if (s.endsWith(':prc')) return ['Diese Position ist riskanter, als das Profil des Kunden vorsieht. Ersatz vorschlagen oder die Risikoaufklärung dokumentieren.', "This position is riskier than the client's profile provides for. Suggest a replacement or put the risk disclosure on file."]
  if (s.endsWith(':band')) return (n.volatility ?? 0) > (n.volaMax ?? Infinity) ? TOO_RISKY : TOO_CAUTIOUS
  if (s.endsWith(':profile')) return f.kind === 'interpretation'
    ? ['Execution only: der Kunde entscheidet selbst. Trotzdem sagen, dass das Portfolio stärker schwankt, als sein Profil vorsieht.', "Execution only: the client decides alone. Still tell them the portfolio swings more than their profile provides for."]
    : TOO_RISKY
  if (f.severity === 'ok') return ['Das Risiko passt zum Profil. Kein Handlungsbedarf.', 'The risk fits the profile. Nothing to do.']
  return ['Im Risikoprofil fehlt ein Maximum. Bei Gelegenheit das Profil vervollständigen.', 'The risk profile has no maximum. Complete the profile when there is a chance.']
}

function proposalStep(f: Finding): readonly [string, string] | undefined {
  const s = subjectOf(f)
  const n = f.numbers ?? {}
  if (s.startsWith('draft:')) return ['Der Vorschlag wartet auf eine Antwort. Fragen, ob der Kunde entschieden hat oder noch etwas braucht.', 'The proposal is waiting for an answer. Ask whether the client has decided or still needs something.']
  if (s.startsWith('repeat:')) return ['Entwurf vor dem Gespräch anpassen, sonst droht dieselbe Ablehnung noch einmal.', 'Change the draft before the call, otherwise the same rejection is likely again.']
  if (s === 'acceptance') return (n.acceptanceRate ?? 1) < 0.5
    ? ['Der Kunde lehnt häufiger ab, als er annimmt. Zwei Optionen zeigen statt einer Empfehlung und nach den Gründen fragen.', 'The client rejects more often than they accept. Show two options instead of one recommendation and ask for the reasons.']
    : ['Der Kunde folgt Vorschlägen meist. Eine klare Empfehlung genügt.', 'The client usually follows proposals. One clear recommendation is enough.']
  return ['Nicht erneut vorschlagen, ohne zu fragen, was damals gestört hat.', 'Do not propose it again without asking what the objection was.']
}

function stepOf(f: Finding): readonly [string, string] | undefined {
  const n = f.numbers ?? {}
  const s = subjectOf(f)
  switch (f.check) {
    case 'portfolio.violations': return violationStep(f)
    case 'portfolio.allocation': return allocationStep(f)
    case 'portfolio.risk': return riskStep(f)
    case 'portfolio.proposals': return proposalStep(f)
    case 'portfolio.performance': {
      if (f.severity === 'warn') return [`Den Rückgang von sich aus ansprechen und einordnen: über 12 Monate steht das Portfolio bei ${signedPct(n.twelveMonths ?? 0)}.`, `Raise the drop yourself and put it in context: over 12 months the portfolio stands at ${signedPct(n.twelveMonths ?? 0)}.`]
      return (n.lastMonth ?? 0) < 0
        ? ['Kleiner Rückgang, kein Anlass zur Sorge. Bei Nachfrage auf die Entwicklung über 12 Monate verweisen.', 'A small drop, no cause for concern. If asked, point to the 12-month development.']
        : ['Gute Entwicklung: eignet sich als Einstieg ins Gespräch.', 'Good development: a natural way to open the call.']
    }
    case 'portfolio.concentration':
      if (s.endsWith(':currency')) return CURRENCY
      if (s.endsWith(':top')) return (n.top1 ?? 0) >= 0.2 ? CLUSTER : ['Keine einzelne Position dominiert. Kein Handlungsbedarf.', 'No single position dominates. Nothing to do.']
      return f.kind === 'interpretation'
        ? ['Dieser Titel treibt das Risiko viel stärker, als sein Gewicht vermuten lässt. Fragen, ob das dem Kunden bewusst ist, und eine Reduktion anbieten.', 'This security drives the risk far more than its weight suggests. Ask whether the client is aware of it, and offer to reduce it.']
        : CLUSTER
    case 'portfolio.liquidity':
      if (f.severity === 'warn') return CASH_SHORT
      if ((n.share ?? 0) >= 0.3) return INVEST
      if ((n.share ?? 1) < 0.02) return ['Kaum Bargeld auf den Konten. Fragen, ob in nächster Zeit Auszahlungen anstehen.', 'Hardly any cash in the accounts. Ask whether withdrawals are coming up soon.']
      return ['Übliche Bargeldreserve. Kein Handlungsbedarf.', 'A normal cash reserve. Nothing to do.']
    case 'portfolio.maturities':
      return ['Dieses Geld wird bald frei. Fragen, ob es wieder angelegt wird oder ob der Kunde es braucht.', 'This money is freed up soon. Ask whether it is reinvested or whether the client needs it.']
    case 'portfolio.ex-custody':
      return ['Das Depot bei der anderen Bank gehört zum Gesamtbild. Risiken über beide Depots zusammen besprechen.', 'The account at the other bank is part of the full picture. Discuss the risks across both accounts together.']
    case 'context.history':
      return n.monthsToRecover !== undefined
        ? ['Hilft bei Verlustsorgen: frühere Rückgänge hat dieses Portfolio wieder aufgeholt.', 'Useful when the client worries about losses: this portfolio recovered from earlier drops.']
        : ['Der Rückgang ist noch nicht aufgeholt. Geduld und Anlagehorizont ansprechen.', 'The drop has not been recovered yet. Talk about patience and the investment horizon.']
    case 'context.plan':
      return n.amount !== undefined || n.liquidityShare !== undefined
        ? ['Die Frage stellen und prüfen, ob die Liquidität dafür reicht. Antwort in der Notiz festhalten.', 'Ask the question and check whether the cash covers it. Record the answer in the note.']
        : ['Die Frage stellen und die Antwort in der Notiz festhalten.', 'Ask the question and record the answer in the note.']
    case 'context.stale-note':
      return ['Die Notiz ist alt. Nachfragen, dann die Notiz aktualisieren oder schliessen.', 'The note is old. Ask, then update or close the note.']
    case 'context.peers':
    case 'context.peer-behaviour':
      return ['Nur zur Einordnung: zeigt, wie Kunden mit demselben Profil dastehen. Nie einzelne Kunden nennen.', 'For context only: shows where clients with the same profile stand. Never name individual clients.']
    case 'contradiction.fossil-fuel':
    case 'contradiction.region':
      return f.severity === 'ok' ? WISH_MET : ['Das Portfolio widerspricht dem Wunsch des Kunden. Offen ansprechen und den Verkauf des grössten Treibers vorschlagen.', "The portfolio goes against the client's wish. Say so openly and suggest selling the largest driver."]
    case 'contradiction.unverifiable':
      return ['Die Daten können den Wunsch nicht prüfen. Titel gemeinsam durchgehen und den Wunsch genauer fassen.', 'The data cannot check this wish. Go through the holdings together and pin the wish down.']
    case 'wish.cash':
      if (f.severity === 'warn') return CASH_SHORT
      if (f.severity === 'ok') return ['Die Reserve ist vorhanden. Kein Handlungsbedarf.', 'The reserve is there. Nothing to do.']
      return ['Fragen, wie viel Reserve gemeint ist. Was darüber liegt, könnte angelegt werden.', 'Ask how much reserve is meant. Anything above it could be invested.']
    case 'wish.esg':
      if (f.severity === 'warn') return ['Diese Titel passen nicht zum Nachhaltigkeitswunsch. Ersatz für die schwächsten vorschlagen.', 'These holdings do not fit the sustainability wish. Suggest replacements for the weakest.']
      return (n.unscoredShare ?? 0) > 0.0005
        ? ['Die bewerteten Titel passen. Offen sagen, dass ein Teil ohne Bewertung ist und sich nicht prüfen lässt.', 'The rated holdings fit. Say openly that part of the portfolio has no rating and cannot be checked.']
        : WISH_MET
    case 'wish.currency':
      return f.severity === 'ok' ? WISH_MET : ['Der Wunsch ist nicht erfüllt. CHF-abgesicherte Tranchen für die grössten Fonds vorschlagen.', 'The wish is not met. Suggest CHF-hedged share classes for the largest funds.']
    case 'wish.interest':
      return (n.options ?? 0) > 0
        ? ['Die Optionen zeigen und fragen, wie viel der Kunde dafür umschichten will.', 'Show the options and ask how much the client wants to shift into them.']
        : ['Die Daten können das nicht messen. Nachfragen, was der Kunde genau meint.', 'The data cannot measure this. Ask what exactly the client means.']
    case 'wish.unreviewed':
      return ['Diese Notiz wurde nicht automatisch geprüft. Vor dem Gespräch selbst lesen.', 'This note was not checked automatically. Read it yourself before the call.']
    case 'memory.call-promise':
      return ['Im letzten Gespräch zugesagt. Einlösen oder dem Kunden den Stand nennen.', 'Promised in the last call. Deliver it or tell the client where it stands.']
    case 'profile.call-reason':
      return ['Wahrscheinlicher Grund des Anrufs. Die Antwort dazu bereithalten.', 'The likely reason for the call. Have the answer ready.']
    case 'profile.trait':
    case 'profile.persona':
      return ['Eine Tendenz aus den Daten, kein Urteil. Im Gespräch überprüfen.', 'A tendency from the data, not a verdict. Test it in the call.']
    case 'profile.tone':
    case 'profile.signals':
      return undefined // already an instruction to the advisor
  }
  if (f.check.startsWith('cio.')) {
    if (f.fix) return ['Tausch vorschlagen: er ist bereits gegen Profil und Wünsche des Kunden geprüft.', "Suggest the switch: it is already checked against the client's profile and wishes."]
    return f.severity === 'ok' || s === 'summary'
      ? ['Portfolio und Hausmeinung der Bank passen zusammen. Kein Handlungsbedarf.', "The portfolio and the bank's house view agree. Nothing to do."]
      : ['Das Portfolio weicht von der Hausmeinung der Bank ab. Als Gesprächsanlass nutzen und die Sicht der Bank erklären.', "The portfolio differs from the bank's house view. Use it as a reason to talk and explain the bank's view."]
  }
  return f.severity === 'ok' ? OK : undefined
}
