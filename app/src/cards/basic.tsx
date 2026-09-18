import type { CardOf } from '../types'
import { KindTag, Shell, Source, toneDot, toneText } from './ui'

export function Headline({ card }: { card: CardOf<'headline'> }) {
  return (
    <section className="rounded-lg bg-ink p-5 text-white">
      <p className="text-lg font-semibold leading-snug">{card.text}</p>
      {card.sub && <p className="mt-2 text-sm text-slate-300">{card.sub}</p>}
    </section>
  )
}

export function Metrics({ card }: { card: CardOf<'metrics'> }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {card.items.map((m) => (
        <Shell key={m.label} className="!p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted">{m.label}</div>
          <div className={`text-xl font-semibold ${m.tone ? toneText[m.tone] : ''}`}>{m.value}</div>
          {m.delta && <div className="text-xs text-muted">{m.delta}</div>}
        </Shell>
      ))}
    </div>
  )
}

export function Split({ card }: { card: CardOf<'split'> }) {
  return (
    <Shell title={card.title}>
      <div className="grid gap-4 md:grid-cols-2 md:divide-x md:divide-line">
        {[card.left, card.right].map((col, i) => (
          <div key={col.title} className={i ? 'md:pl-4' : 'md:pr-4'}>
            <div className="mb-2 text-sm font-semibold">{col.title}</div>
            <ul className="space-y-2">
              {col.points.map((p) => (
                <li key={p.text} className="leading-snug">
                  <KindTag kind={p.kind} /> {p.text} {p.source && <Source>{p.source}</Source>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Shell>
  )
}

export function Flags({ card }: { card: CardOf<'flags'> }) {
  return (
    <Shell title={card.title}>
      <ul className="space-y-2">
        {card.items.map((f) => (
          <li key={f.text} className="flex items-start gap-2 leading-snug">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${toneDot[f.severity]}`} />
            <span>{f.text} <Source>{f.source}</Source></span>
          </li>
        ))}
      </ul>
    </Shell>
  )
}

export function Actions({ card }: { card: CardOf<'actions'> }) {
  return (
    <Shell title={card.title}>
      <ol className="space-y-3">
        {card.items.map((a, i) => (
          <li key={a.text} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{i + 1}</span>
            <div>
              <div className="font-medium leading-snug">{a.text}</div>
              <div className="text-xs text-muted">{a.why}</div>
            </div>
          </li>
        ))}
      </ol>
    </Shell>
  )
}

export function Questions({ card }: { card: CardOf<'questions'> }) {
  return (
    <Shell title={card.title}>
      <div className="space-y-2">
        {card.items.map((x) => (
          <details key={x.q} className="rounded border border-line px-3 py-2">
            <summary className="cursor-pointer font-medium">{x.q}</summary>
            <p className="mt-1 text-muted">{x.a}</p>
          </details>
        ))}
      </div>
    </Shell>
  )
}
