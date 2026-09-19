import { ArrowDown, ArrowUp, Landmark, Minus } from 'lucide-react'
import type { CardOf } from '../types'
import { KindTag, Panel, SeverityIcon, useLanguage } from './ui'
import { pick } from '../../engine/lang.ts'

// The bank's investment view and what it means for this client: the view's stances at a glance, then the
// client's own points (opportunities within the mandate, deviations to talk about), each with its figures.

const Arrow = ({ rating }: { rating: number }) => {
  const tone = rating > 0 ? 'text-ok' : rating < 0 ? 'text-risk' : 'text-muted'
  const Icon = rating > 0 ? ArrowUp : rating < 0 ? ArrowDown : Minus
  return <span className={`flex shrink-0 items-center ${tone}`} aria-label={rating > 0 ? 'übergewichten' : rating < 0 ? 'untergewichten' : 'neutral'}>{Math.abs(rating) === 2 ? <><Icon size={12} className="-mr-1.5" /><Icon size={12} /></> : <Icon size={12} />}</span>
}

// The engine's detail contract (engine/checks/cio-house-view.ts): 'reason. Vorschlag: step. Danach: effects. Gemessen mit …',
// in English 'reason. Proposal: step. After that: effects. Measured with …'. Split on both marker sets.
const STEP = / (?:Vorschlag|Proposal): /, AFTER = / (?:Danach|After that): /, MEASURED = / (?:Gemessen mit|Measured with).*$/

export function HouseViewCard({ card }: { card: CardOf<'houseview'> }) {
  const t = pick(useLanguage())
  return (
    <Panel title={card.title} icon={Landmark} aside={
      <span className="flex items-center gap-1.5 text-[11px] font-normal text-muted">
        {card.example && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink">{t('Beispiel', 'Example')}</span>}
        {t('Stand', 'As of')} {card.date}
      </span>
    }>
      <p className="mb-3 text-[13px] leading-snug text-ink/80">{card.summary}</p>

      {card.hits.length > 0 && (
        <ul className="mb-3 space-y-2">
          {card.hits.map((h) => (
            <li key={h.text} className="flex items-start gap-2 text-[13px] leading-snug">
              <span className="mt-[3px]"><SeverityIcon severity={h.kind === 'chance' ? 'ok' : 'warn'} size={12} /></span>
              <span className="min-w-0 flex-1">
                <KindTag kind={h.kind === 'chance' ? 'action' : 'interpretation'} />{h.text}
                {h.detail && (() => {
                  // Show the step apart from the reason.
                  const [why, rest] = h.detail.split(STEP)
                  const [step, after] = (rest ?? '').split(AFTER)
                  return (
                    <>
                      <span className="block text-[11px] text-muted">{why.replace(MEASURED, '')}</span>
                      {rest && <span className="mt-1 block rounded-lg bg-ok/10 px-2 py-1 text-[12px] text-ink"><span className="mr-1 text-[10px] uppercase tracking-wide text-muted">{t('Vorschlag', 'Proposal')}</span>{step.replace(/\.$/, '')}{after && <span className="block text-[11px] text-muted">{t('Danach:', 'After that:')} {after.replace(MEASURED, '')}</span>}</span>}
                    </>
                  )
                })()}
              </span>
            </li>
          ))}
        </ul>
      )}
      {card.inLine !== undefined && card.measured !== undefined && (
        <p className="mb-2 text-[11px] text-muted">{t(`Portfolio in ${card.inLine} von ${card.measured} messbaren Punkten auf Linie mit der Hausmeinung.`, `Portfolio in line with the house view on ${card.inLine} of ${card.measured} measurable points.`)}</p>
      )}

      <ul className="flex flex-wrap gap-1.5">
        {card.stances.map((s) => (
          <li key={s.label} title={s.why} className="flex items-center gap-1 rounded-full bg-pill/70 px-2 py-0.5 text-[11px]">
            <Arrow rating={s.rating} /> {s.label}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
