// profile.trait — likely traits of the client (how they decide, what they value, how they take losses), each with evidence.
// Only from the data files: note wording, proposal decisions and dates, holdings vs the risk profile, liquidity, ESG
// profile, tags, age and pension portfolios. Always phrased as a tendency ("wirkt eher …"), never as a diagnosis, and
// nothing about health or protected traits. A trait needs a note or a clear number behind it; weak signals yield nothing.
import { categoryDe, monthCh, pct, signedPct } from '../format.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { findingId, SRC } from './common.ts'
import { BAD_MONTH, noteEvidence, proposalEvidence, signalsOf, type Signals } from './profile-signals.ts'

const CHECK = 'profile.trait'
const TOPIC = 'profile'

// Thresholds are our judgement, not bank rules.
const MIN_DECIDED = 4 // decided proposals before an acceptance or rejection rate says anything
const MOSTLY_REJECTS = 0.5
const MOSTLY_ACCEPTS = 0.8
const EXECUTION_ONLY = 0.5 // share of assets the client manages without advice
const ABOVE_PROFILE = 1.1 // held volatility / profile maximum, when no note speaks to risk: clearly above, not at the edge
const BELOW_PROFILE = 0.5
const CUSHION = 0.2 // liquidity share outside pension portfolios
const REACTS_AFTER_LOSS = 2 // reactive proposals shortly after bad months
const CALM_MIN_PROPOSALS = 5
const ENGAGED_PER_YEAR = 3
const ENGAGED_MIN = 6
const MAX_INTERESTS = 3

export type TraitKey = 'autonomy' | 'delegating' | 'control' | 'loss-reacts' | 'loss-calm' | 'risk-braver' | 'risk-careful' | 'safety' | 'values' | 'family' | 'engaged' | 'steady' | 'interests'

export type Trait = {
  key: TraitKey
  adjective: string // fits "wirkt eher …" in the persona line
  title: string
  detail: string
  evidence: Evidence[]
  numbers?: Record<string, number>
}

// Order = importance for the persona line and the tone.
export const TRAIT_ORDER: TraitKey[] = ['autonomy', 'loss-reacts', 'risk-careful', 'risk-braver', 'control', 'loss-calm', 'values', 'safety', 'family', 'delegating', 'engaged', 'steady', 'interests']

const TAG_DE: Record<string, string> = { 'Latin America': 'Lateinamerika', Global: 'globale Anlagen' }
const tagDe = (name: string) => TAG_DE[name] ?? categoryDe(name)
const sentence = (parts: string[]) => parts.filter(Boolean).join(' ')

function traitsFrom(s: Signals): Trait[] {
  const out: Trait[] = []
  const { proposals: pr } = s
  const decided = pr.accepted.length + pr.rejected.length
  const rejectRate = decided >= MIN_DECIDED ? pr.rejected.length / decided : undefined
  const acceptRate = decided >= MIN_DECIDED ? pr.accepted.length / decided : undefined
  const decisionText = `${pr.rejected.length} von ${decided} entschiedenen Vorschlägen abgelehnt (${pct(rejectRate ?? 0, 0)})`

  // ── how they decide ───────────────────────────────────────────────────────
  const autonomyNotes = s.has('autonomy')
  const rejects = rejectRate !== undefined && rejectRate >= MOSTLY_REJECTS
  const selfTrading = s.executionOnlyShare >= EXECUTION_ONLY
  if (autonomyNotes.length || rejects || selfTrading) {
    const ev: Evidence[] = autonomyNotes.map(noteEvidence)
    const why: string[] = autonomyNotes.map((n) => `Notiz: ${n.gist}.`)
    const numbers: Record<string, number> = {}
    if (rejects) {
      why.push(`${decisionText}.`)
      ev.push(...pr.rejected.slice(0, 3).map(proposalEvidence))
      numbers.rejectRate = rejectRate!
      numbers.decided = decided
    }
    if (selfTrading) {
      why.push(`${pct(s.executionOnlyShare, 0)} des Vermögens in Execution-only-Depots (ohne Beratung).`)
      ev.push(...s.client.portfolios.filter((p) => /execution only/i.test(p.service ?? '')).map((p) => SRC.portfolio(p.nr)))
      numbers.executionOnlyShare = s.executionOnlyShare
    }
    out.push({ key: 'autonomy', adjective: 'selbstbestimmt', title: 'Wirkt eher selbstbestimmt: trifft Entscheide gern selbst', detail: sentence(why), evidence: ev, numbers })
  } else if (acceptRate !== undefined && acceptRate >= MOSTLY_ACCEPTS && decided >= MIN_DECIDED + 1) {
    out.push({
      key: 'delegating', adjective: 'vertrauensvoll gegenüber der Beratung', title: 'Wirkt eher delegierend: folgt Vorschlägen meist',
      detail: `${pr.accepted.length} von ${decided} entschiedenen Vorschlägen angenommen (${pct(acceptRate, 0)}).`,
      evidence: pr.accepted.slice(-3).map(proposalEvidence), numbers: { acceptRate, decided },
    })
  }

  const control = s.has('control')
  if (control.length) {
    out.push({
      key: 'control', adjective: 'auf Mitsprache bedacht', title: 'Wirkt eher auf Mitsprache bedacht: will vor Änderungen informiert sein',
      detail: sentence(control.map((n) => `Notiz: ${n.gist}.`)), evidence: control.map(noteEvidence),
    })
  }

  // ── how they take losses ──────────────────────────────────────────────────
  const averse = s.has('riskAverse'), calm = s.has('calm')
  if (averse.length || s.afterLoss.length >= REACTS_AFTER_LOSS) {
    const why = averse.map((n) => `Notiz: ${n.gist}.`)
    const ev = averse.map(noteEvidence)
    if (s.afterLoss.length >= REACTS_AFTER_LOSS) {
      why.push(`${s.afterLoss.length} Vorschläge kurz nach einem Verlustmonat (Anlass z. B. Marktschwankungen, Risikobereitschaft, Anruf des Kunden).`)
      for (const a of s.afterLoss.slice(-3)) ev.push(proposalEvidence(a.proposal), SRC.history(s.client.portfolios.map((p) => p.nr).join(', '), a.month.date))
    }
    out.push({
      key: 'loss-reacts', adjective: 'empfindlich bei Verlusten', title: 'Reagiert eher auf Verluste: schwache Monate beschäftigen spürbar',
      detail: sentence(why), evidence: ev, numbers: { afterLoss: s.afterLoss.length, badMonths: s.badMonths.length },
    })
  } else if (calm.length || (s.badMonths.length >= 2 && s.proposals.dated.length >= CALM_MIN_PROPOSALS && s.afterLoss.length === 0)) {
    const why = calm.map((n) => `Notiz: ${n.gist}.`)
    const ev = calm.map(noteEvidence)
    if (!calm.length) {
      why.push(`${s.badMonths.length} Monate mit ${signedPct(BAD_MONTH)} oder schlechter, danach kein Vorschlag aus Unruhe (${s.proposals.dated.length} datierte Vorschläge).`)
      ev.push(SRC.history(s.client.portfolios.map((p) => p.nr).join(', '), s.badMonths[s.badMonths.length - 1].date))
    }
    out.push({
      key: 'loss-calm', adjective: 'gelassen', title: 'Wirkt eher gelassen bei Schwankungen',
      detail: sentence(why), evidence: ev, numbers: { badMonths: s.badMonths.length },
    })
  }

  // ── risk: stated profile vs what is held ──────────────────────────────────
  const tolerant = s.has('riskTolerant')
  const volaNumbers = s.volaRatio !== undefined ? { heldVola: s.heldVola!, maxVola: s.maxVola!, volaRatio: s.volaRatio } : undefined
  const volaText = volaNumbers ? `Portfolio schwankt mit ${pct(volaNumbers.heldVola)}, Maximum von ${s.riskProfileName ?? 'Risikoprofil'}: ${pct(volaNumbers.maxVola)}.` : ''
  const volaEv = volaNumbers ? [...s.client.portfolios.filter((p) => (p.volatility ?? 0) > 0).map((p) => SRC.portfolio(p.nr)), SRC.riskProfile(s.riskProfileName)] : []
  const braverByData = s.volaRatio !== undefined && s.volaRatio > ABOVE_PROFILE
  const carefulByData = s.volaRatio !== undefined && s.volaRatio < BELOW_PROFILE
  // Notes decide the direction; the numbers alone only when no note speaks to risk.
  if (tolerant.length || (braverByData && !averse.length)) {
    out.push({
      key: 'risk-braver', adjective: 'risikobereit',
      title: braverByData ? `Wirkt risikobereiter als das Profil ${s.riskProfileName ?? ''}`.trim() : 'Wirkt eher risikobereit',
      detail: sentence([...tolerant.map((n) => `Notiz: ${n.gist}.`), braverByData ? volaText : '']),
      evidence: [...tolerant.map(noteEvidence), ...(braverByData ? volaEv : [])], numbers: braverByData ? volaNumbers : undefined,
    })
  } else if (carefulByData && !tolerant.length) {
    out.push({
      key: 'risk-careful', adjective: 'vorsichtig', title: `Wirkt vorsichtiger als das Profil ${s.riskProfileName ?? ''}`.trim(),
      detail: sentence([volaText, 'Das Portfolio nutzt weniger als die Hälfte der erlaubten Schwankung.']), evidence: volaEv, numbers: volaNumbers,
    })
  }

  // ── safety cushion ────────────────────────────────────────────────────────
  // Pension portfolios often sit in cash by design, so the cushion is measured outside them.
  const free = s.client.portfolios.filter((p) => !/vorsorge|pension/i.test(`${p.service ?? ''} ${p.name ?? ''}`) && p.value > 0 && p.liquidity !== undefined)
  const freeValue = free.reduce((a, p) => a + p.value, 0)
  const freeLiquidity = freeValue > 0 ? free.reduce((a, p) => a + Math.max(0, p.liquidity ?? 0), 0) / freeValue : undefined
  const reserve = s.has('reserve')
  const cushion = freeLiquidity !== undefined && freeLiquidity >= CUSHION
  if (reserve.length || cushion) {
    out.push({
      key: 'safety', adjective: 'sicherheitsbewusst', title: 'Wirkt eher sicherheitsbewusst: hält gern ein Polster flüssig',
      detail: sentence([...reserve.map((n) => `Notiz: ${n.gist}.`), cushion ? `${pct(freeLiquidity!, 0)} der freien Depots (ohne Vorsorge) liegen flüssig.` : '']),
      evidence: [...reserve.map(noteEvidence), ...(cushion ? free.map((p) => SRC.portfolio(p.nr)) : [])],
      numbers: cushion ? { liquidityShare: freeLiquidity! } : undefined,
    })
  }

  // ── values and family ─────────────────────────────────────────────────────
  const values = s.has('values')
  if (values.length) {
    out.push({
      key: 'values', adjective: 'wertorientiert', title: 'Wirkt eher wertorientiert: Nachhaltigkeit ist ein Anliegen',
      detail: sentence([...values.map((n) => `Notiz: ${n.gist}.`), s.esg === 'Yes' ? 'ESG-Profil: ja.' : '']),
      evidence: [...values.map(noteEvidence), ...(s.esg === 'Yes' ? [{ source: 'ESG-Profil', quote: 'Yes' }] : [])],
    })
  }
  const family = s.has('family')
  const estate = pr.all.filter((p) => p.reason === 'Estate planning discussion')
  if (family.length || estate.length >= 2) {
    out.push({
      key: 'family', adjective: 'familienorientiert', title: 'Deutet auf Denken über die eigene Person hinaus: Familie, Erbe, Nachlass',
      detail: sentence([...family.map((n) => `Notiz: ${n.gist}.`), estate.length ? `${estate.length} ${estate.length === 1 ? 'Vorschlag' : 'Vorschläge'} zur Nachlassplanung.` : '']),
      evidence: [...family.map(noteEvidence), ...estate.slice(-3).map(proposalEvidence)], numbers: estate.length ? { estateProposals: estate.length } : undefined,
    })
  }

  // ── how much contact they want ────────────────────────────────────────────
  const steady = s.has('simple')
  const perYear = pr.years ? pr.dated.length / pr.years : 0
  if (steady.length) {
    out.push({
      key: 'steady', adjective: 'beständig', title: 'Wirkt eher beständig: wenige Anpassungen statt häufiger Umschichtungen',
      detail: sentence(steady.map((n) => `Notiz: ${n.gist}.`)), evidence: steady.map(noteEvidence),
    })
  } else if (pr.dated.length >= ENGAGED_MIN && perYear >= ENGAGED_PER_YEAR) {
    out.push({
      key: 'engaged', adjective: 'engagiert', title: 'Wirkt eher engagiert: regelmässiger Austausch über das Portfolio',
      detail: `${pr.dated.length} datierte Vorschläge seit ${monthCh(pr.dated[0].proposed ?? pr.dated[0].finalized ?? pr.dated[0].submitted ?? '')}, rund ${perYear.toFixed(1)} pro Jahr.`,
      evidence: pr.dated.slice(-3).map(proposalEvidence), numbers: { proposals: pr.dated.length, perYear },
    })
  }

  // ── interests ─────────────────────────────────────────────────────────────
  // Stated interests come from notes; tags (Region/Industry) are the bank's labels, shown as focus areas.
  const interestNotes = s.has('interest').concat(s.has('values')).filter((n) => n.interest)
  const stated = [...new Set(interestNotes.map((n) => n.interest!))].slice(0, MAX_INTERESTS)
  const focus = [...new Set(s.tags.map((t) => tagDe(t.name)))].slice(0, MAX_INTERESTS)
  if (stated.length || focus.length) {
    out.push({
      key: 'interests', adjective: '', title: [stated.length ? `Interessen: ${stated.join(', ')}` : '', focus.length ? `Schwerpunkte: ${focus.join(', ')}` : ''].filter(Boolean).join('; '),
      detail: sentence([...interestNotes.map((n) => `Notiz: ${n.gist}.`), s.tags.length ? `Kundenmerkmale (Region/Branche): ${s.tags.map((t) => tagDe(t.name)).join(', ')}.` : '']),
      evidence: [...interestNotes.map(noteEvidence), ...s.tags.map((t) => ({ source: 'Kundenmerkmal', ref: t.type, quote: t.name }))],
    })
  }

  return out.sort((a, b) => TRAIT_ORDER.indexOf(a.key) - TRAIT_ORDER.indexOf(b.key))
}

const traitCache = new WeakMap<Signals, Trait[]>()
export const traitsOf = (s: Signals): Trait[] => {
  const hit = traitCache.get(s)
  if (hit) return hit
  const t = traitsFrom(s)
  traitCache.set(s, t)
  return t
}

export const traits: Check = (raw, ctx) => {
  const s = signalsOf(raw, ctx)
  return traitsOf(s).filter((t) => t.evidence.length).map((t): Finding => ({
    id: findingId(CHECK, s.client.ref, t.key), check: CHECK, kind: 'interpretation', severity: 'info', topic: TOPIC,
    title: t.title, detail: t.detail || undefined, numbers: t.numbers && Object.keys(t.numbers).length ? t.numbers : undefined, evidence: t.evidence,
  }))
}
