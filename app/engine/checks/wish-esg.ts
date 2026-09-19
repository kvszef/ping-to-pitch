// wish.esg — the ESG preference against the holdings (E2). The wish comes in data form (ESG profile "Yes") or
// from a note ("ESG-compliant only"). Each held security needs a SustainabilityScore of at least the profile's
// MinimumPositionLevel (5.714 for "Yes"). Below it: 'warn' with the weakest positions. Securities without a
// score are named, never counted as fine.
import { pct } from '../format.ts'
import { pick, prefix, sourceName } from '../lang.ts'
import type { Check, Evidence, Finding } from '../types.ts'
import { wishesOf, wishText } from '../wishes.ts'
import { clientOf, findingId, srcOf } from './common.ts'
import { esgFloor, hasEsgProfile, heldSecurities, noteEvidence, score } from './wish-common.ts'

const CHECK = 'wish.esg'
const WORST = 3

export const esg: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const { lang } = ctx
  const t = pick(lang)
  const SRC = srcOf(lang)
  const profile = hasEsgProfile(client, ctx.ref)
  const notes = wishesOf(client, ctx).wishes.filter((w) => w.wish.type === 'esg-only')
  if (!profile && !notes.length) return []

  const floor = esgFloor(client, ctx.ref)
  const { rows } = heldSecurities(client)
  const scored = rows.filter((r) => r.share > 0)
  const below = scored.filter((r) => r.security?.esgScore !== undefined && r.security.esgScore < floor).sort((a, b) => a.security!.esgScore! - b.security!.esgScore! || b.share - a.share)
  const unscored = scored.filter((r) => r.security?.esgScore === undefined)
  const belowShare = below.reduce((a, r) => a + r.share, 0)
  const unscoredShare = unscored.reduce((a, r) => a + r.share, 0)

  const source = profile ? t(`ESG-Profil «Yes»`, `ESG profile «Yes»`) : `${prefix('wish', lang)}«${wishText(notes[0], lang)}»`
  const evidence: Evidence[] = [
    ...(profile ? [{ source: sourceName('esg', lang), quote: t(`${client.esgProfileName ?? 'Yes'}: Mindestscore je Position ${floor}`, `${client.esgProfileName ?? 'Yes'}: minimum score per position ${floor}`) }] : []),
    ...notes.map((w) => noteEvidence(w, lang)),
  ]
  const worst = below.slice(0, WORST)
  const unscoredNames = unscored.slice(0, WORST).map((r) => `${r.name} ${pct(r.share)}`).join(', ')
  const unscoredText = unscored.length
    ? t(
      ` Ohne ESG-Score: ${unscoredNames}${unscored.length > WORST ? ` und ${unscored.length - WORST} weitere` : ''} (zusammen ${pct(unscoredShare)}), nicht prüfbar.`,
      ` Without an ESG score: ${unscoredNames}${unscored.length > WORST ? ` and ${unscored.length - WORST} more` : ''} (together ${pct(unscoredShare)}), cannot be checked.`,
    )
    : ''
  const finding: Finding = below.length
    ? {
      id: findingId(CHECK, client.ref, profile ? 'profile' : 'note'), check: CHECK, kind: 'fact', severity: 'warn', topic: 'esg',
      title: t(
        `${source}: ${below.length} ${below.length === 1 ? 'Position' : 'Positionen'} unter dem ESG-Mindestscore ${floor}, zusammen ${pct(belowShare)} des Vermögens`,
        `${source}: ${below.length} ${below.length === 1 ? 'position' : 'positions'} below the ESG minimum score ${floor}, together ${pct(belowShare)} of total assets`,
      ),
      detail: `${t('Schwächste', 'Weakest')}: ${worst.map((r) => `${r.name} (${t('Score', 'score')} ${score(r.security!.esgScore)}, ${pct(r.share)})`).join(', ')}.${unscoredText}`,
      numbers: { belowShare, belowCount: below.length, unscoredShare, worstShare: worst[0].share },
      evidence: [...evidence, ...worst.map((r) => ({ ...SRC.security(r.name), ref: r.securityId === undefined ? undefined : String(r.securityId), quote: `${r.name}: ${t('ESG-Score', 'ESG score')} ${score(r.security!.esgScore)}` }))],
    }
    : {
      id: findingId(CHECK, client.ref, profile ? 'profile' : 'note'), check: CHECK, kind: 'fact', severity: unscored.length ? 'info' : 'ok', topic: 'esg',
      title: t(`${source}: alle bewerteten Positionen erreichen den ESG-Mindestscore ${floor}`, `${source}: all scored positions reach the ESG minimum score ${floor}`),
      detail: unscoredText.trim() || undefined,
      numbers: { belowShare: 0, belowCount: 0, unscoredShare },
      evidence,
    }
  return [finding]
}
