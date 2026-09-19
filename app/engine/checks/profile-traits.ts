// profile.trait — likely traits of the client (how they decide, what they value, how they take losses), each with evidence.
// Only from the data files: note wording, proposal decisions and dates, holdings vs the risk profile, liquidity, ESG
// profile, tags, age and pension portfolios. Always phrased as a tendency ("wirkt eher …" / "tends to be …"), never as a
// diagnosis, and nothing about health or protected traits. A trait needs a note or a clear number behind it; weak signals yield nothing.
import type { Proposal } from '../data.ts'
import { categoryName, monthCh, pct, signedPct } from '../format.ts'
import { pick, sourceName, type Lang } from '../lang.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { findingId, srcOf } from './common.ts'
import { BAD_MONTH, gistOf, interestOf, noteEvidence, proposalEvidence, signalsOf, type ReadNote, type Signals } from './profile-signals.ts'

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
  adjective: string // fits "wirkt eher …" / "tends to be …" in the persona line
  title: string
  line?: string // how the trait reads inside the persona sentence when it is not an adjective (interests)
  detail: string
  evidence: Evidence[]
  numbers?: Record<string, number>
}

// Order = importance for the persona line and the tone.
export const TRAIT_ORDER: TraitKey[] = ['autonomy', 'loss-reacts', 'risk-careful', 'risk-braver', 'control', 'loss-calm', 'values', 'safety', 'family', 'delegating', 'engaged', 'steady', 'interests']

const TAG_DE: Record<string, string> = { 'Latin America': 'Lateinamerika', Global: 'globale Anlagen' }
const TAG_EN: Record<string, string> = { Global: 'global investments' }
const tagName = (name: string, lang?: Lang) => (lang === 'en' ? TAG_EN[name] : TAG_DE[name]) ?? categoryName(name, lang)
const sentence = (parts: string[]) => parts.filter(Boolean).join(' ')

function traitsFrom(s: Signals, lang?: Lang): Trait[] {
  const t = pick(lang)
  const SRC = srcOf(lang)
  const noteEv = (n: ReadNote) => noteEvidence(n, lang)
  const proposalEv = (p: Proposal) => proposalEvidence(p, lang)
  const noteWhy = (n: ReadNote) => t(`Notiz: ${n.gist}.`, `Note: ${gistOf(n, 'en')}.`)
  const out: Trait[] = []
  const { proposals: pr } = s
  const decided = pr.accepted.length + pr.rejected.length
  const rejectRate = decided >= MIN_DECIDED ? pr.rejected.length / decided : undefined
  const acceptRate = decided >= MIN_DECIDED ? pr.accepted.length / decided : undefined
  const decisionText = t(
    `${pr.rejected.length} von ${decided} entschiedenen Vorschlägen abgelehnt (${pct(rejectRate ?? 0, 0)})`,
    `${pr.rejected.length} of ${decided} decided proposals rejected (${pct(rejectRate ?? 0, 0)})`,
  )

  // ── how they decide ───────────────────────────────────────────────────────
  const autonomyNotes = s.has('autonomy')
  const rejects = rejectRate !== undefined && rejectRate >= MOSTLY_REJECTS
  const selfTrading = s.executionOnlyShare >= EXECUTION_ONLY
  if (autonomyNotes.length || rejects || selfTrading) {
    const ev: Evidence[] = autonomyNotes.map(noteEv)
    const why: string[] = autonomyNotes.map(noteWhy)
    const numbers: Record<string, number> = {}
    if (rejects) {
      why.push(`${decisionText}.`)
      ev.push(...pr.rejected.slice(0, 3).map(proposalEv))
      numbers.rejectRate = rejectRate!
      numbers.decided = decided
    }
    if (selfTrading) {
      why.push(t(
        `${pct(s.executionOnlyShare, 0)} des Vermögens in Execution-only-Depots (ohne Beratung).`,
        `${pct(s.executionOnlyShare, 0)} of the assets in execution-only portfolios (without advice).`,
      ))
      ev.push(...s.client.portfolios.filter((p) => /execution only/i.test(p.service ?? '')).map((p) => SRC.portfolio(p.nr)))
      numbers.executionOnlyShare = s.executionOnlyShare
    }
    out.push({
      key: 'autonomy', adjective: t('selbstbestimmt', 'self-directed'),
      title: t('Wirkt eher selbstbestimmt: trifft Entscheide gern selbst', 'Tends to be self-directed: likes to make decisions alone'),
      detail: sentence(why), evidence: ev, numbers,
    })
  } else if (acceptRate !== undefined && acceptRate >= MOSTLY_ACCEPTS && decided >= MIN_DECIDED + 1) {
    out.push({
      key: 'delegating', adjective: t('vertrauensvoll gegenüber der Beratung', 'trusting of the advice given'),
      title: t('Wirkt eher delegierend: folgt Vorschlägen meist', 'Tends to delegate: mostly follows proposals'),
      detail: t(
        `${pr.accepted.length} von ${decided} entschiedenen Vorschlägen angenommen (${pct(acceptRate, 0)}).`,
        `${pr.accepted.length} of ${decided} decided proposals accepted (${pct(acceptRate, 0)}).`,
      ),
      evidence: pr.accepted.slice(-3).map(proposalEv), numbers: { acceptRate, decided },
    })
  }

  const control = s.has('control')
  if (control.length) {
    out.push({
      key: 'control', adjective: t('auf Mitsprache bedacht', 'keen to have a say'),
      title: t('Wirkt eher auf Mitsprache bedacht: will vor Änderungen informiert sein', 'Seems keen to have a say: wants to be informed before changes'),
      detail: sentence(control.map(noteWhy)), evidence: control.map(noteEv),
    })
  }

  // ── how they take losses ──────────────────────────────────────────────────
  const averse = s.has('riskAverse'), calm = s.has('calm')
  if (averse.length || s.afterLoss.length >= REACTS_AFTER_LOSS) {
    const why = averse.map(noteWhy)
    const ev = averse.map(noteEv)
    if (s.afterLoss.length >= REACTS_AFTER_LOSS) {
      why.push(t(
        `${s.afterLoss.length} Vorschläge kurz nach einem Verlustmonat (Anlass z. B. Marktschwankungen, Risikobereitschaft, Anruf des Kunden).`,
        `${s.afterLoss.length} proposals shortly after a loss-making month (prompted e.g. by market volatility, risk tolerance, a call from the client).`,
      ))
      for (const a of s.afterLoss.slice(-3)) ev.push(proposalEv(a.proposal), SRC.history(s.client.portfolios.map((p) => p.nr).join(', '), a.month.date))
    }
    out.push({
      key: 'loss-reacts', adjective: t('empfindlich bei Verlusten', 'sensitive to losses'),
      title: t('Reagiert eher auf Verluste: schwache Monate beschäftigen spürbar', 'Tends to react to losses: weak months visibly weigh on the client'),
      detail: sentence(why), evidence: ev, numbers: { afterLoss: s.afterLoss.length, badMonths: s.badMonths.length },
    })
  } else if (calm.length || (s.badMonths.length >= 2 && s.proposals.dated.length >= CALM_MIN_PROPOSALS && s.afterLoss.length === 0)) {
    const why = calm.map(noteWhy)
    const ev = calm.map(noteEv)
    if (!calm.length) {
      why.push(t(
        `${s.badMonths.length} Monate mit ${signedPct(BAD_MONTH)} oder schlechter, danach kein Vorschlag aus Unruhe (${s.proposals.dated.length} datierte Vorschläge).`,
        `${s.badMonths.length} months at ${signedPct(BAD_MONTH)} or worse, and no proposal prompted by unease afterwards (${s.proposals.dated.length} dated proposals).`,
      ))
      ev.push(SRC.history(s.client.portfolios.map((p) => p.nr).join(', '), s.badMonths[s.badMonths.length - 1].date))
    }
    out.push({
      key: 'loss-calm', adjective: t('gelassen', 'calm'), title: t('Wirkt eher gelassen bei Schwankungen', 'Tends to stay calm when markets swing'),
      detail: sentence(why), evidence: ev, numbers: { badMonths: s.badMonths.length },
    })
  }

  // ── risk: stated profile vs what is held ──────────────────────────────────
  const tolerant = s.has('riskTolerant')
  const volaNumbers = s.volaRatio !== undefined ? { heldVola: s.heldVola!, maxVola: s.maxVola!, volaRatio: s.volaRatio } : undefined
  const volaText = volaNumbers ? t(
    `Portfolio schwankt mit ${pct(volaNumbers.heldVola)}, Maximum von ${s.riskProfileName ?? 'Risikoprofil'}: ${pct(volaNumbers.maxVola)}.`,
    `Portfolio volatility is ${pct(volaNumbers.heldVola)}, the maximum for ${s.riskProfileName ?? 'the risk profile'}: ${pct(volaNumbers.maxVola)}.`,
  ) : ''
  const volaEv = volaNumbers ? [...s.client.portfolios.filter((p) => (p.volatility ?? 0) > 0).map((p) => SRC.portfolio(p.nr)), SRC.riskProfile(s.riskProfileName)] : []
  const braverByData = s.volaRatio !== undefined && s.volaRatio > ABOVE_PROFILE
  const carefulByData = s.volaRatio !== undefined && s.volaRatio < BELOW_PROFILE
  // The profile name is the bank's own (often German, e.g. «Anlageprofil 3»): data, quoted and never translated.
  const profileEn = s.riskProfileName ? `the risk profile «${s.riskProfileName}»` : 'the risk profile'
  // Notes decide the direction; the numbers alone only when no note speaks to risk.
  if (tolerant.length || (braverByData && !averse.length)) {
    out.push({
      key: 'risk-braver', adjective: t('risikobereit', 'willing to take risk'),
      title: braverByData
        ? t(`Wirkt risikobereiter als das Profil ${s.riskProfileName ?? ''}`.trim(), `Seems more willing to take risk than ${profileEn}`)
        : t('Wirkt eher risikobereit', 'Tends to be willing to take risk'),
      detail: sentence([...tolerant.map(noteWhy), braverByData ? volaText : '']),
      evidence: [...tolerant.map(noteEv), ...(braverByData ? volaEv : [])], numbers: braverByData ? volaNumbers : undefined,
    })
  } else if (carefulByData && !tolerant.length) {
    out.push({
      key: 'risk-careful', adjective: t('vorsichtig', 'cautious'),
      title: t(`Wirkt vorsichtiger als das Profil ${s.riskProfileName ?? ''}`.trim(), `Seems more cautious than ${profileEn}`),
      detail: sentence([volaText, t('Das Portfolio nutzt weniger als die Hälfte der erlaubten Schwankung.', 'The portfolio uses less than half of the volatility allowed.')]),
      evidence: volaEv, numbers: volaNumbers,
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
      key: 'safety', adjective: t('sicherheitsbewusst', 'safety-minded'),
      title: t('Wirkt eher sicherheitsbewusst: hält gern ein Polster flüssig', 'Tends to be safety-minded: likes to keep a cushion in cash'),
      detail: sentence([...reserve.map(noteWhy), cushion ? t(
        `${pct(freeLiquidity!, 0)} der freien Depots (ohne Vorsorge) liegen flüssig.`,
        `${pct(freeLiquidity!, 0)} of the portfolios outside the pension assets is held in cash.`,
      ) : '']),
      evidence: [...reserve.map(noteEv), ...(cushion ? free.map((p) => SRC.portfolio(p.nr)) : [])],
      numbers: cushion ? { liquidityShare: freeLiquidity! } : undefined,
    })
  }

  // ── values and family ─────────────────────────────────────────────────────
  const values = s.has('values')
  if (values.length) {
    out.push({
      key: 'values', adjective: t('wertorientiert', 'values-driven'),
      title: t('Wirkt eher wertorientiert: Nachhaltigkeit ist ein Anliegen', 'Tends to be values-driven: sustainability matters to the client'),
      detail: sentence([...values.map(noteWhy), s.esg === 'Yes' ? t('ESG-Profil: ja.', 'ESG profile: yes.') : '']),
      evidence: [...values.map(noteEv), ...(s.esg === 'Yes' ? [{ source: sourceName('esg', lang), quote: 'Yes' }] : [])],
    })
  }
  const family = s.has('family')
  const estate = pr.all.filter((p) => p.reason === 'Estate planning discussion')
  if (family.length || estate.length >= 2) {
    out.push({
      key: 'family', adjective: t('familienorientiert', 'family-minded'),
      title: t('Deutet auf Denken über die eigene Person hinaus: Familie, Erbe, Nachlass', 'Appears to think beyond themselves: family, inheritance, estate'),
      detail: sentence([...family.map(noteWhy), estate.length ? t(
        `${estate.length} ${estate.length === 1 ? 'Vorschlag' : 'Vorschläge'} zur Nachlassplanung.`,
        `${estate.length} ${estate.length === 1 ? 'proposal' : 'proposals'} on estate planning.`,
      ) : '']),
      evidence: [...family.map(noteEv), ...estate.slice(-3).map(proposalEv)], numbers: estate.length ? { estateProposals: estate.length } : undefined,
    })
  }

  // ── how much contact they want ────────────────────────────────────────────
  const steady = s.has('simple')
  const perYear = pr.years ? pr.dated.length / pr.years : 0
  if (steady.length) {
    out.push({
      key: 'steady', adjective: t('beständig', 'steady'),
      title: t('Wirkt eher beständig: wenige Anpassungen statt häufiger Umschichtungen', 'Tends to be steady: few adjustments rather than frequent reshuffling'),
      detail: sentence(steady.map(noteWhy)), evidence: steady.map(noteEv),
    })
  } else if (pr.dated.length >= ENGAGED_MIN && perYear >= ENGAGED_PER_YEAR) {
    const since = pr.dated[0].proposed ?? pr.dated[0].finalized ?? pr.dated[0].submitted ?? ''
    out.push({
      key: 'engaged', adjective: t('engagiert', 'engaged'),
      title: t('Wirkt eher engagiert: regelmässiger Austausch über das Portfolio', 'Tends to be engaged: regular exchange about the portfolio'),
      detail: t(
        `${pr.dated.length} datierte Vorschläge seit ${monthCh(since)}, rund ${perYear.toFixed(1)} pro Jahr.`,
        `${pr.dated.length} dated proposals since ${monthCh(since, 'en')}, about ${perYear.toFixed(1)} a year.`,
      ),
      evidence: pr.dated.slice(-3).map(proposalEv), numbers: { proposals: pr.dated.length, perYear },
    })
  }

  // ── interests ─────────────────────────────────────────────────────────────
  // Stated interests come from notes; tags (Region/Industry) are the bank's labels, shown as focus areas.
  const interestNotes = s.has('interest').concat(s.has('values')).filter((n) => n.interest)
  const stated = [...new Set(interestNotes.map((n) => interestOf(n, lang)!))].slice(0, MAX_INTERESTS)
  const focus = [...new Set(s.tags.map((tag) => tagName(tag.name, lang)))].slice(0, MAX_INTERESTS)
  if (stated.length || focus.length) {
    const label = (interests: string, focusAreas: string) => [stated.length ? `${interests}: ${stated.join(', ')}` : '', focus.length ? `${focusAreas}: ${focus.join(', ')}` : ''].filter(Boolean).join('; ')
    out.push({
      key: 'interests', adjective: '', title: t(label('Interessen', 'Schwerpunkte'), label('Interests', 'Focus areas')),
      line: t(label('Interessen', 'Schwerpunkte'), label('interests', 'focus areas')),
      detail: sentence([...interestNotes.map(noteWhy), s.tags.length ? t(
        `Kundenmerkmale (Region/Branche): ${s.tags.map((tag) => tagName(tag.name)).join(', ')}.`,
        `Client attributes (region/industry): ${s.tags.map((tag) => tagName(tag.name, 'en')).join(', ')}.`,
      ) : '']),
      evidence: [...interestNotes.map(noteEv), ...s.tags.map((tag) => ({ source: sourceName('clientTrait', lang), ref: tag.type, quote: tag.name }))],
    })
  }

  return out.sort((a, b) => TRAIT_ORDER.indexOf(a.key) - TRAIT_ORDER.indexOf(b.key))
}

// Traits carry text, so they are cached per signals and language.
const traitCache = new WeakMap<Signals, Partial<Record<Lang, Trait[]>>>()
export const traitsOf = (s: Signals, lang?: Lang): Trait[] => {
  const key: Lang = lang === 'en' ? 'en' : 'de'
  let byLang = traitCache.get(s)
  if (!byLang) traitCache.set(s, byLang = {})
  return byLang[key] ?? (byLang[key] = traitsFrom(s, key))
}

export const traits: Check = (raw, ctx) => {
  const s = signalsOf(raw, ctx)
  return traitsOf(s, ctx.lang).filter((t) => t.evidence.length).map((t): Finding => ({
    id: findingId(CHECK, s.client.ref, t.key), check: CHECK, kind: 'interpretation', severity: 'info', topic: TOPIC,
    title: t.title, detail: t.detail || undefined, numbers: t.numbers && Object.keys(t.numbers).length ? t.numbers : undefined, evidence: t.evidence,
  }))
}
