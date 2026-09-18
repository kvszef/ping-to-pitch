import { ClipboardList, Flag, GitCompareArrows, ListChecks, MessageCircleQuestion, PieChart } from 'lucide-react'
import type { CardOf } from '../types'
import { KindTag, Panel, SeverityIcon, Source, toneText } from './ui'

export function Headline({ card }: { card: CardOf<'headline'> }) {
  return (
    <Panel title="Briefing" icon={ClipboardList}>
      <p className="text-[17px] leading-snug">{card.text}</p>
      {card.sub && <p className="mt-3 text-muted"><span className="font-medium text-ink">Beratertipp:</span> {card.sub}</p>}
    </Panel>
  )
}

// Erscheint in der Seitenspalte als quadratische Kacheln, analog zum Kachelraster der Analyse.
export function Metrics({ card }: { card: CardOf<'metrics'> }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {card.items.map((m, i) => (
        <div key={m.label} className={`flex aspect-[4/3] flex-col p-3 shadow-card ${i === 0 && m.tone === 'risk' ? 'bg-risk text-white' : 'bg-white'}`}>
          <div className="text-[11px] font-medium">{m.label}</div>
          <div className={`mt-auto text-[22px] font-light ${i === 0 && m.tone === 'risk' ? '' : m.tone ? toneText[m.tone] : ''}`}>{m.value}</div>
          <div className="h-4 text-[11px] opacity-70">{m.delta}</div>
        </div>
      ))}
    </div>
  )
}

export function Split({ card }: { card: CardOf<'split'> }) {
  return (
    <Panel title={card.title} icon={GitCompareArrows}>
      <div className="grid gap-5 md:grid-cols-2">
        {[card.left, card.right].map((col, i) => (
          <div key={col.title} className={i ? 'md:border-l md:border-ink md:pl-5' : ''}>
            <div className="mb-2 font-medium">{col.title}</div>
            <ul className="space-y-2">
              {col.points.map((p) => (
                <li key={p.text} className="leading-snug">
                  <KindTag kind={p.kind} />{p.text} {p.source && <Source>{p.source}</Source>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  )
}

const pct = (n: number) => `${n.toFixed(1)}%`

const barColors = ['#5997ed', '#5aa5ee', '#5fc0ea', '#69d4d6', '#6fe0b5']

export function Allocation({ card }: { card: CardOf<'allocation'> }) {
  const scale = Math.max(...card.rows.map((r) => r.actual), 1)
  return (
    <Panel title={card.title} icon={PieChart}>
      <table className="w-full max-w-xl">
        <thead>
          <tr className="text-right font-normal">
            <th />
            {['Min.', 'Soll', 'Max.', 'Portfolio', 'Aktion'].map((h) => <th key={h} className="pb-1 font-normal">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {card.rows.map((r, i) => {
            const out = r.actual < r.min || r.actual > r.max
            return [
              <tr key={r.label} className="text-right">
                <td className="pt-2 text-left">{r.label}</td>
                <td>{pct(r.min)}</td><td>{pct(r.target)}</td><td>{pct(r.max)}</td>
                <td className={out ? 'font-medium text-risk' : ''}>{pct(r.actual)}</td>
                <td>{pct(r.target - r.actual)}</td>
              </tr>,
              <tr key={`${r.label}-bar`}>
                <td colSpan={6} className="pb-2 pt-1">
                  <div className="h-[5px] bg-track">
                    <div className="h-full" style={{ width: `${(r.actual / scale) * 100}%`, background: barColors[i % barColors.length] }} />
                  </div>
                </td>
              </tr>,
            ]
          })}
        </tbody>
      </table>
    </Panel>
  )
}

export function Flags({ card }: { card: CardOf<'flags'> }) {
  return (
    <Panel title={card.title} icon={Flag}>
      <ul>
        {card.items.map((f, i) => (
          <li key={f.text} className={`flex items-center gap-3 px-2 py-2 ${i % 2 ? 'bg-stripe' : ''}`}>
            <SeverityIcon severity={f.severity} />
            <span className="leading-snug">{f.text} <Source>{f.source}</Source></span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function Actions({ card }: { card: CardOf<'actions'> }) {
  return (
    <Panel title={card.title} icon={ListChecks}>
      <ol>
        {card.items.map((a, i) => (
          <li key={a.text} className={`flex items-center gap-3 px-2 py-2 ${i % 2 ? 'bg-stripe' : ''}`}>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center bg-brand text-[11px] text-white">{i + 1}</span>
            <div>
              <div className="leading-snug">{a.text}</div>
              <div className="text-[11px] text-muted">{a.why}</div>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

export function Questions({ card }: { card: CardOf<'questions'> }) {
  return (
    <Panel title={card.title} icon={MessageCircleQuestion}>
      {card.items.map((x, i) => (
        <details key={x.q} className={`px-2 py-2 ${i % 2 ? 'bg-stripe' : ''}`}>
          <summary className="cursor-pointer text-brand">{x.q}</summary>
          <p className="mt-1 pl-4 text-muted">{x.a}</p>
        </details>
      ))}
    </Panel>
  )
}
