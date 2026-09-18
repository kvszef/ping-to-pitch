import { ArrowRight, Check, FileText, TrendingUp, UserRound, X } from 'lucide-react'
import type { CardOf } from '../types'
import { Panel } from './ui'

const POS = '#3f7fd9', NEG = '#c8662b'
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`

// Beitrag je Position zur Wertentwicklung: Richtung und Farbe zeigen das Vorzeichen, die Zahl steht daneben.
export function Drivers({ card }: { card: CardOf<'drivers'> }) {
  const scale = Math.max(...card.items.map((d) => Math.abs(d.contribution)), 0.1)
  return (
    <Panel title={card.title} icon={TrendingUp}>
      <div className="mb-2 flex items-baseline justify-between text-[11px] text-muted"><span>{card.period}</span><span>Portfolio <span className="text-[13px] text-ink">{card.total}</span></span></div>
      <div className="space-y-1.5">
        {card.items.map((d) => (
          <div key={d.name} className="grid grid-cols-[minmax(0,1fr)_96px_52px] items-center gap-2 text-xs" title={`${d.name}: Gewicht ${d.weight}%, Rendite ${signed(d.ret)}%, Beitrag ${signed(d.contribution, 2)} Prozentpunkte`}>
            <span className="truncate">{d.name} <span className="text-[11px] text-muted">{d.weight}%</span></span>
            <div className="relative h-2.5">
              <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
              <span className="absolute inset-y-[1px]" style={{ width: `${(Math.abs(d.contribution) / scale) * 50}%`, background: d.contribution < 0 ? NEG : POS, ...(d.contribution < 0 ? { right: '50%', borderRadius: '4px 0 0 4px' } : { left: '50%', borderRadius: '0 4px 4px 0' }) }} />
            </div>
            <span className="text-right tabular-nums">{signed(d.contribution, 2)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-muted"><span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: NEG }} /> belastet</span><span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: POS }} /> stützt</span><span className="ml-auto">Beitrag in Prozentpunkten</span></div>
      <p className="mt-2 text-[11px] leading-snug text-muted">{card.note}</p>
    </Panel>
  )
}

export function Context({ card }: { card: CardOf<'context'> }) {
  return (
    <Panel title={card.title} icon={UserRound}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        {card.facts.map((f) => <div key={f.label} className="min-w-0"><dt className="text-[10px] uppercase tracking-wide text-muted">{f.label}</dt><dd className="truncate text-xs">{f.value}</dd></div>)}
      </dl>
      {card.changes.length > 0 && (
        <div className="mt-3 border-l-2 border-brand bg-brand-soft/25 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted">Neu seit dem letzten Kontakt</div>
          <ul className="mt-0.5 space-y-0.5 text-xs leading-snug">{card.changes.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      <ul className="mt-2">
        {card.notes.map((n, i) => <li key={n.text} className={`flex gap-2 px-2 py-1.5 text-xs leading-snug ${i % 2 ? '' : 'bg-stripe'}`}><span className="shrink-0 tabular-nums text-[11px] text-muted">{n.date}</span>{n.text}</li>)}
      </ul>
    </Panel>
  )
}

const sideStyle = { Kauf: 'bg-brand text-white', Verkauf: 'bg-ink text-white', Absicherung: 'bg-teal/60 text-ink' }

export function Proposal({ card }: { card: CardOf<'proposal'> }) {
  return (
    <Panel title={card.title} icon={FileText} aside={<span title={[card.summary, card.open].filter(Boolean).join(' ')} className="rounded-sm bg-pill px-1.5 py-px text-[10px]">{card.status}</span>}>
      <p className="mb-2 text-xs leading-snug [.compact_&]:hidden">{card.summary}</p>
      <ul className="text-xs">
        {card.trades.map((t, i) => (
          <li key={t.name} className={`flex items-start gap-2 px-2 py-1.5 ${i % 2 ? '' : 'bg-stripe'}`}>
            <span className={`mt-px w-[74px] shrink-0 rounded-sm py-px text-center text-[10px] ${sideStyle[t.side]}`}>{t.side}</span>
            <span title={t.name} className="min-w-0 flex-1 leading-snug [.compact_&]:line-clamp-2">{t.name}</span>
            <span className="shrink-0 whitespace-nowrap text-right tabular-nums leading-snug">{t.amount}<span className="block text-[11px] text-muted [.compact_&]:hidden">{t.share}</span></span>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-[10px] uppercase tracking-wide text-muted">Wirkung</div>
      <ul className="mt-1 space-y-1 text-xs">
        {card.effects.map((e) => (
          <li key={e.label} className="flex items-center gap-2">
            <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-white ${e.ok ? 'bg-ok' : 'bg-risk'}`}>{e.ok ? <Check size={9} strokeWidth={3} /> : <X size={9} strokeWidth={3} />}</span>
            <span className="min-w-0 flex-1 truncate">{e.label}</span>
            <span className="flex items-center gap-1 whitespace-nowrap tabular-nums"><span className="text-muted">{e.before}</span><ArrowRight size={10} className="text-muted" />{e.after}</span>
          </li>
        ))}
      </ul>
      {card.open && <p className="mt-3 border-t border-line pt-2 text-[11px] leading-snug text-muted [.compact_&]:hidden">{card.open}</p>}
    </Panel>
  )
}
