import { ArrowDown, ArrowUp, Landmark, Minus } from 'lucide-react'
import type { CardOf } from '../types'
import { KindTag, Panel, SeverityIcon } from './ui'

// The bank's investment view and what it means for this client: the view's stances at a glance, then the
// client's own points (opportunities within the mandate, deviations to talk about), each with its figures.

const Arrow = ({ rating }: { rating: number }) => {
  const tone = rating > 0 ? 'text-ok' : rating < 0 ? 'text-risk' : 'text-muted'
  const Icon = rating > 0 ? ArrowUp : rating < 0 ? ArrowDown : Minus
  return <span className={`flex shrink-0 items-center ${tone}`} aria-label={rating > 0 ? 'übergewichten' : rating < 0 ? 'untergewichten' : 'neutral'}>{Math.abs(rating) === 2 ? <><Icon size={12} className="-mr-1.5" /><Icon size={12} /></> : <Icon size={12} />}</span>
}

export function HouseViewCard({ card }: { card: CardOf<'houseview'> }) {
  return (
    <Panel title={card.title} icon={Landmark} aside={
      <span className="flex items-center gap-1.5 text-[11px] font-normal text-muted">
        {card.example && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink">Beispiel</span>}
        Stand {card.date}
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
                {h.detail && <span className="block text-[11px] text-muted">{h.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {card.inLine !== undefined && card.measured !== undefined && (
        <p className="mb-2 text-[11px] text-muted">Portfolio in {card.inLine} von {card.measured} messbaren Punkten auf Linie mit der Hausmeinung.</p>
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
