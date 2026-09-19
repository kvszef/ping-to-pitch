import { useState, type ReactNode } from 'react'
import { ArrowRight, Check, CircleHelp, ClipboardCheck, Layers, ListTodo, ShieldAlert, UserRoundSearch, UsersRound, X } from 'lucide-react'
import type { CallNote, CardOf, Effect, Trade } from '../types'
import { KindTag, Panel, SeverityIcon, Source, useLanguage } from './ui'
import { useTranslated } from '../data/useTranslate'
import { confirmNote } from '../workspace/callNote'

const DIRECT = '#3f7fd9', FUNDS = '#69d4d6'
const pct = (n: number, digits = 1) => `${n.toFixed(digits)}%`

const Label = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={`text-[10px] uppercase tracking-wide text-muted ${className}`}>{children}</div>

// A dated client note, always shown as a quote with its source.
function Quote({ quote, date, source, muted = false }: { quote: string; date: string; source: string; muted?: boolean }) {
  return (
    <blockquote className={`border-l-2 px-2.5 py-1.5 text-xs leading-snug ${muted ? 'border-pill bg-stripe text-muted' : 'border-brand bg-brand-soft/25'}`}>
      «{quote}» <Source>{source}, {date}</Source>
    </blockquote>
  )
}

const sideStyle = { Kauf: 'bg-brand text-white', Verkauf: 'bg-ink text-white', Absicherung: 'bg-teal/60 text-ink' }

function Trades({ trades }: { trades: Trade[] }) {
  return (
    <ul className="text-xs">
      {trades.map((t, i) => (
        <li key={t.name} className={`flex items-start gap-2 px-2 py-1.5 ${i % 2 ? '' : 'bg-stripe'}`}>
          <span className={`mt-px w-[74px] shrink-0 rounded-sm py-px text-center text-[10px] ${sideStyle[t.side]}`}>{t.side}</span>
          <span title={t.name} className="min-w-0 flex-1 leading-snug">{t.name}</span>
          <span className="shrink-0 whitespace-nowrap text-right tabular-nums leading-snug">{t.amount} <span className="text-[11px] text-muted">{t.share}</span></span>
        </li>
      ))}
    </ul>
  )
}

const Mark = ({ ok }: { ok: boolean }) => <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-white ${ok ? 'bg-ok' : 'bg-risk'}`}>{ok ? <Check size={9} strokeWidth={3} /> : <X size={9} strokeWidth={3} />}</span>

function Effects({ effects }: { effects: Effect[] }) {
  return (
    <ul className="space-y-1 text-xs">
      {effects.map((e) => (
        <li key={e.label} className="flex items-center gap-2">
          <Mark ok={e.ok} />
          <span className="min-w-0 flex-1 truncate">{e.label}</span>
          <span className="flex items-center gap-1 whitespace-nowrap tabular-nums"><span className="text-muted">{e.before}</span><ArrowRight size={10} className="text-muted" />{e.after}</span>
        </li>
      ))}
    </ul>
  )
}

// Client wish vs holdings, plus the smallest fix with its re-check (before → after).
export function Contradiction({ card }: { card: CardOf<'contradiction'> }) {
  const language = useLanguage()
  const [widerspruch, wunschDesKunden, wasDagegenSteht, direkt, ueberFonds, gewicht, desPortfoliosDavon, viaFonds, kleinsteKorrektur, wirkungVorherNachher] = useTranslated(
    ['Widerspruch', 'Wunsch des Kunden', 'Was dagegen steht', 'direkt', 'über Fonds', 'Gewicht', 'des Portfolios, davon', 'via Fonds', 'Kleinste Korrektur', 'Wirkung · vorher → nachher'],
    language,
  )
  const x = card.exposure
  return (
    <Panel title={card.title} icon={ShieldAlert} aside={<span className="rounded-sm bg-risk px-1.5 py-px text-[10px] text-white">{widerspruch}</span>}>
      <div className="@container"><div className="grid gap-4 @xl:grid-cols-2">
        <div>
          <Label className="mb-1"><KindTag kind="fact" />{wunschDesKunden}</Label>
          <Quote {...card.wish} />
          <Label className="mb-1 mt-3"><KindTag kind="fact" />{wasDagegenSteht}</Label>
          <div className="flex flex-wrap items-baseline gap-x-2 px-2 pb-1">
            <span className="text-[22px] font-light text-risk tabular-nums">{pct(x.total)}</span>
            <span className="whitespace-nowrap text-xs">{x.label}</span>
            <span className="ml-auto whitespace-nowrap text-[11px] text-muted tabular-nums">{direkt} {pct(x.direct)} · {ueberFonds} {pct(x.viaFunds)}</span>
          </div>
          <ul className="text-xs">
            {card.holdings.map((h, i) => (
              <li key={h.name} className={`flex items-center gap-2 px-2 py-1.5 ${i % 2 ? '' : 'bg-stripe'}`} title={`${h.name}: ${gewicht} ${pct(h.weight)} ${desPortfoliosDavon} ${pct(h.exposure)} ${x.label}`}>
                <span className={`w-[58px] shrink-0 rounded-sm py-px text-center text-[10px] ${h.via === 'Fonds' ? 'bg-teal/60 text-ink' : 'bg-ink text-white'}`}>{h.via === 'Fonds' ? viaFonds : direkt}</span>
                <span className="min-w-0 flex-1 truncate">{h.name} <span className="text-[11px] text-muted">{pct(h.weight)}</span></span>
                <span className="shrink-0 tabular-nums">{pct(h.exposure)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-snug"><KindTag kind="interpretation" />{card.verdict} <Source>{card.source}</Source></p>
        </div>
        <div className="@xl:border-l @xl:border-line @xl:pl-4">
          <Label className="mb-1"><KindTag kind="action" />{kleinsteKorrektur}</Label>
          <p className="mb-1.5 text-xs leading-snug">{card.fix.summary}</p>
          <Trades trades={card.fix.trades} />
          <Label className="mb-1 mt-3">{wirkungVorherNachher}</Label>
          <Effects effects={card.fix.effects} />
          <p className="mt-2 text-right"><Source>{card.fix.source}</Source></p>
        </div>
      </div></div>
    </Panel>
  )
}

const Swatch = ({ color }: { color: string }) => <span className="mr-1 inline-block h-2 w-2.5 rounded-[1px] align-baseline" style={{ background: color }} />

// Exposure per bucket, split into direct holdings and holdings inside funds.
export function LookThrough({ card }: { card: CardOf<'lookthrough'> }) {
  const language = useLanguage()
  const [inPctPortfolio, direkt, fonds, total, ueberFonds] = useTranslated(['in % des Portfolios', 'direkt', 'Fonds', 'Total', 'über Fonds'], language)
  const scale = Math.max(...card.rows.map((r) => r.direct + r.viaFunds), 0.1)
  const cols = 'grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_44px_44px_44px] items-center gap-2'
  return (
    <Panel title={card.title} icon={Layers} aside={<span className="rounded-sm bg-pill px-1.5 py-px text-[10px]">{card.dimension}</span>}>
      <div className={`${cols} mb-1 text-right text-[10px] text-muted`}>
        <span className="text-left">{inPctPortfolio}</span><span />
        <span className="whitespace-nowrap"><Swatch color={DIRECT} />{direkt}</span>
        <span className="whitespace-nowrap"><Swatch color={FUNDS} />{fonds}</span>
        <span>{total}</span>
      </div>
      <div>
        {card.rows.map((r, i) => (
          <div key={r.label} className={`${cols} px-0 py-1 text-xs ${i % 2 ? '' : 'bg-stripe'}`} title={`${r.label}: ${direkt} ${pct(r.direct)}, ${ueberFonds} ${pct(r.viaFunds)}, ${total} ${pct(r.direct + r.viaFunds)}${r.flag ? ` – ${r.flag}` : ''}`}>
            <span className="flex min-w-0 items-center gap-1 pl-2">{r.flag && <SeverityIcon severity="warn" size={13} />}<span className="truncate">{r.label}</span></span>
            <div className="flex h-2 gap-px">
              {r.direct > 0 && <span className="h-full rounded-[1px]" style={{ width: `${(r.direct / scale) * 100}%`, background: DIRECT }} />}
              {r.viaFunds > 0 && <span className="h-full rounded-[1px]" style={{ width: `${(r.viaFunds / scale) * 100}%`, background: FUNDS }} />}
            </div>
            <span className="text-right tabular-nums">{r.direct.toFixed(1)}</span>
            <span className="text-right tabular-nums">{r.viaFunds.toFixed(1)}</span>
            <span className="pr-2 text-right font-medium tabular-nums">{(r.direct + r.viaFunds).toFixed(1)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-snug">{card.note && <><KindTag kind="interpretation" />{card.note} </>}<Source>{card.source}</Source></p>
    </Panel>
  )
}

// An expired note is never stated as a fact: it becomes a question for the advisor.
export function StaleNote({ card }: { card: CardOf<'stalenote'> }) {
  const language = useLanguage()
  const [nichtBestaetigt, notizVom, alter, gueltigBis, imGespraechFragen] = useTranslated(
    ['Nicht bestätigt', 'Notiz vom', 'Alter', 'Gültig bis', 'Im Gespräch fragen'],
    language,
  )
  return (
    <Panel title={card.title} icon={CircleHelp} aside={<span className="rounded-sm bg-warn px-1.5 py-px text-[10px] text-ink">{nichtBestaetigt}</span>}>
      <Quote {...card.note} muted />
      <dl className="mt-2 grid grid-cols-3 gap-x-4">
        {[[notizVom, card.note.date], [alter, card.age], [gueltigBis, card.expired]].map(([l, v]) => <div key={l}><dt className="text-[10px] uppercase tracking-wide text-muted">{l}</dt><dd className="text-xs tabular-nums">{v}</dd></div>)}
      </dl>
      <p className="mt-2 flex items-start gap-1.5 text-xs leading-snug"><SeverityIcon severity="warn" /><span><KindTag kind="interpretation" />{card.reason}</span></p>
      <div className="mt-3 border-l-2 border-brand bg-brand-soft/25 px-2.5 py-2">
        <Label><KindTag kind="action" />{imGespraechFragen}</Label>
        <p className="mt-0.5 text-[15px] leading-snug">«{card.question}»</p>
        {card.followUps && card.followUps.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-muted">{card.followUps.map((f) => <li key={f}>– {f}</li>)}</ul>}
      </div>
    </Panel>
  )
}

// Behaviour, never a diagnosis: one advisor-facing line, always tagged as interpretation, with its evidence.
export function Profile({ card }: { card: CardOf<'profile'> }) {
  const language = useLanguage()
  const [gesagt, kundennotizen, getan, bankdaten, quelle, beschreibtVerhalten] = useTranslated(
    ['Gesagt', 'Kundennotizen', 'Getan', 'Bankdaten', 'Quelle:', 'Beschreibt Verhalten, keine Person'],
    language,
  )
  return (
    <Panel title={card.title} icon={UserRoundSearch}>
      <p className="border-l-2 border-brand bg-brand-soft/25 px-2.5 py-2 text-[15px] leading-snug"><KindTag kind="interpretation" />«{card.persona}»</p>
      <div className="@container mt-3"><div className="grid gap-x-5 gap-y-3 @md:grid-cols-2">
        <div>
          <Label className="mb-1"><KindTag kind="fact" />{gesagt} <Source>{kundennotizen}</Source></Label>
          <ul className="text-xs">{card.said.map((n, i) => <li key={n.text} className={`flex gap-2 px-2 py-1.5 leading-snug ${i % 2 ? '' : 'bg-stripe'}`}><span className="shrink-0 tabular-nums text-[11px] text-muted">{n.date}</span>{n.text}</li>)}</ul>
        </div>
        <div>
          <Label className="mb-1"><KindTag kind="fact" />{getan} <Source>{bankdaten}</Source></Label>
          <ul className="text-xs">{card.done.map((d, i) => <li key={d.label} title={`${quelle} ${d.source}`} className={`flex items-baseline gap-2 px-2 py-1.5 leading-snug ${i % 2 ? '' : 'bg-stripe'}`}><span className="min-w-0 flex-1">{d.label} <Source>{d.source}</Source></span><span className="shrink-0 whitespace-nowrap font-medium tabular-nums">{d.value}</span></li>)}</ul>
        </div>
      </div></div>
      <p className="mt-2 text-[11px] text-muted">{beschreibtVerhalten} <Source>{card.source}</Source></p>
    </Panel>
  )
}

// One strip per metric: peer min–max band, median tick, this client's marker.
export function Peers({ card }: { card: CardOf<'peers'> }) {
  const language = useLanguage()
  const [kunden, profilLabel, kunde, vergleichsgruppe, bis, median, ausserhalbVergleichsgruppe, dieserKunde, spanneVergleichsgruppe] = useTranslated(
    ['Kunden', 'Profil', 'Kunde', 'Vergleichsgruppe', 'bis', 'Median', 'ausserhalb der Vergleichsgruppe', 'dieser Kunde', 'Spanne der Vergleichsgruppe'],
    language,
  )
  const fmt = (n: number, m: { unit: string; signed?: boolean }) => `${m.signed && n > 0 ? '+' : ''}${n.toFixed(1)}${m.unit}`
  return (
    <Panel title={card.title} icon={UsersRound} aside={<span className="rounded-sm bg-pill px-1.5 py-px text-[10px]">{card.n} {kunden} · {profilLabel} {card.profile}</span>}>
      <div>
        {card.metrics.map((m, i) => {
          const lo = Math.min(m.min, m.value), hi = Math.max(m.max, m.value), span = hi - lo || 1
          const pad = span * 0.04, at = (v: number) => `${((v - lo + pad) / (span + 2 * pad)) * 100}%`
          const outside = m.value < m.min || m.value > m.max
          return (
            <div key={m.label} className={`grid grid-cols-[minmax(0,150px)_40px_minmax(0,1fr)_40px_56px] items-center gap-2 px-2 py-2 text-xs ${i % 2 ? '' : 'bg-stripe'}`} title={`${m.label}: ${kunde} ${fmt(m.value, m)}, ${vergleichsgruppe} ${fmt(m.min, m)} ${bis} ${fmt(m.max, m)}, ${median} ${fmt(m.median, m)}${outside ? ` – ${ausserhalbVergleichsgruppe}` : ''}`}>
              <span className="truncate">{m.label}</span>
              <span className="text-right text-[10px] text-muted tabular-nums">{fmt(m.min, m)}</span>
              <div className="relative h-3">
                <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
                <span className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-pill" style={{ left: at(m.min), right: `calc(100% - ${at(m.max)})` }} />
                <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-ink" style={{ left: at(m.median) }} />
                <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style={{ left: at(m.value), background: DIRECT }} />
              </div>
              <span className="text-[10px] text-muted tabular-nums">{fmt(m.max, m)}</span>
              <span className={`text-right font-medium tabular-nums ${outside ? 'text-risk' : ''}`}>{fmt(m.value, m)}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: DIRECT }} /> {dieserKunde}</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-4 bg-pill" /> {spanneVergleichsgruppe}</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-0.5 bg-ink" /> {median}</span>
        <span className="ml-auto"><Source>{card.source}</Source></span>
      </div>
      {card.note && <p className="mt-2 text-[11px] leading-snug"><KindTag kind="interpretation" />{card.note}</p>}
    </Panel>
  )
}

const Box = ({ checked }: { checked: boolean }) => <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${checked ? 'border-ok bg-ok text-white' : 'border-muted bg-white'}`}>{checked && <Check size={10} strokeWidth={3} />}</span>

export function Todos({ card }: { card: CardOf<'todos'> }) {
  const language = useLanguage()
  const [offen, quelle, erledigt, ueberfaellig, bisLabel, ohneTermin] = useTranslated(
    ['offen', 'Quelle:', 'erledigt', 'überfällig ', 'bis ', 'ohne Termin'],
    language,
  )
  const [done, setDone] = useState(() => card.items.map((t) => t.done))
  const open = done.filter((d) => !d).length
  return (
    <Panel title={card.title} icon={ListTodo} aside={<span className="rounded-sm bg-pill px-1.5 py-px text-[10px]">{open} {offen}</span>}>
      <ul className="text-xs">
        {card.items.map((t, i) => {
          const late = t.overdue && !done[i]
          return (
            <li key={t.text} className={i % 2 ? '' : 'bg-stripe'}>
              <button type="button" aria-pressed={done[i]} onClick={() => setDone((d) => d.map((v, j) => (j === i ? !v : v)))} className="flex w-full items-center gap-2 px-2 py-1.5 text-left" title={`${quelle} ${t.source}`}>
                <Box checked={done[i]} />
                <span className={`w-[52px] shrink-0 rounded-sm py-px text-center text-[10px] ${t.owner === 'Berater' ? 'bg-brand text-white' : 'bg-pill text-ink'}`}>{t.owner}</span>
                <span className="min-w-0 flex-1 leading-snug"><span className={done[i] ? 'text-muted line-through' : ''}>{t.text}</span> <Source>{t.source}</Source></span>
                {late && <SeverityIcon severity="warn" />}
                <span className={`w-[92px] shrink-0 whitespace-nowrap text-right tabular-nums ${late ? 'font-medium' : 'text-muted'}`}>{done[i] ? erledigt : t.due ? `${late ? ueberfaellig : bisLabel}${t.due}` : ohneTermin}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

const reactionOrder = ['accepted', 'rejected', 'open'] as const
const reactionStyleDe = { accepted: ['angenommen', 'bg-ok text-white'], rejected: ['abgelehnt', 'bg-risk text-white'], open: ['offen', 'bg-pill text-ink'] } as const
const statusStyleDe = { confirmed: ['bestätigt', 'bg-ok text-white'], outdated: ['veraltet', 'bg-pill text-ink'], changed: ['geändert', 'bg-brand text-white'] } as const
const Chip = ({ style }: { style: readonly [string, string] }) => <span className={`w-[74px] shrink-0 rounded-sm py-px text-center text-[10px] ${style[1]}`}>{style[0]}</span>

// Post-call confirmation. Confirming stores the note on the server (POST /api/calls/:ref/confirm).
export function CallNoteCard({ card }: { card: CardOf<'callnote'> }) {
  const language = useLanguage()
  const [
    bestaetigt, kiEntwurf, kiEntwurfTitle, gespraechVom, vorgeschlagen, klickenZumAendern, zusagen, bisLabel, ohneTermin, aktualisierteFakten,
    gespeichertHint, bestaetigenUndSpeichern, fertig, bearbeiten, speichernFehlgeschlagen, reaktionAnklickenHint, nichtsWirdGespeichertHint,
    angenommen, abgelehnt, offen, bestaetigtChip, veraltet, geaendert,
  ] = useTranslated(
    [
      'Bestätigt', 'KI-Entwurf', 'Von der KI aus dem Gespräch entworfen. Gilt erst nach Bestätigung als Fakt.', 'Gespräch vom', 'Vorgeschlagen', 'Klicken zum Ändern', 'Zusagen', 'bis ', 'ohne Termin', 'Aktualisierte Fakten',
      'Gespeichert. Fliesst ins nächste Briefing ein.', 'Bestätigen und speichern', 'Fertig', 'Bearbeiten', 'Speichern fehlgeschlagen:', 'Reaktion anklicken zum Ändern', 'Nichts wird ohne Bestätigung gespeichert',
      'angenommen', 'abgelehnt', 'offen', 'bestätigt', 'veraltet', 'geändert',
    ],
    language,
  )
  const reactionStyle = { accepted: [angenommen, reactionStyleDe.accepted[1]], rejected: [abgelehnt, reactionStyleDe.rejected[1]], open: [offen, reactionStyleDe.open[1]] } as const
  const statusStyle = { confirmed: [bestaetigtChip, statusStyleDe.confirmed[1]], outdated: [veraltet, statusStyleDe.outdated[1]], changed: [geaendert, statusStyleDe.changed[1]] } as const
  const [note, setNote] = useState<CallNote>(card.note)
  const [editing, setEditing] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const confirm = () => { setEditing(false); setFailed(null); confirmNote(note.clientRef, note).then(() => setNote((n) => ({ ...n, confirmed: true })), (e: unknown) => setFailed(e instanceof Error ? e.message : 'Unbekannter Fehler')) }
  const cycle = (i: number) => setNote((n) => ({ ...n, proposed: n.proposed.map((p, j) => (j === i ? { ...p, reaction: reactionOrder[(reactionOrder.indexOf(p.reaction) + 1) % 3] } : p)) }))
  const row = (i: number) => `flex items-start gap-2 px-2 py-1.5 ${i % 2 ? '' : 'bg-stripe'}`
  return (
    <Panel title={card.title} icon={ClipboardCheck} aside={note.confirmed
      ? <span className="flex items-center gap-1 rounded-sm bg-ok px-1.5 py-px text-[10px] text-white"><Check size={10} strokeWidth={3} /> {bestaetigt}</span>
      : <span className="rounded-sm bg-warn px-1.5 py-px text-[10px] text-ink" title={kiEntwurfTitle}>{kiEntwurf}</span>}>
      <div className="mb-2 text-[11px] text-muted">{gespraechVom} {note.date} <Source>{card.source}</Source></div>

      <Label className="mb-1"><KindTag kind="action" />{vorgeschlagen}</Label>
      <ul className="text-xs">
        {note.proposed.map((p, i) => (
          <li key={p.text} className={row(i)}>
            {editing ? <button type="button" onClick={() => cycle(i)} title={klickenZumAendern} className="flex outline-1 outline-offset-1 outline-brand"><Chip style={reactionStyle[p.reaction]} /></button> : <Chip style={reactionStyle[p.reaction]} />}
            <span className="min-w-0 flex-1 leading-snug">{p.text}{p.why && <span className="block text-[11px] text-muted">{p.why}</span>}</span>
          </li>
        ))}
      </ul>

      <Label className="mb-1 mt-3"><KindTag kind="action" />{zusagen}</Label>
      <ul className="text-xs">
        {note.promises.map((p, i) => (
          <li key={p.text} className={`${row(i)} items-center`}>
            <Box checked={p.done} />
            <span className={`min-w-0 flex-1 leading-snug ${p.done ? 'text-muted line-through' : ''}`}>{p.text}</span>
            <span className="shrink-0 whitespace-nowrap text-muted tabular-nums">{p.due ? `${bisLabel}${p.due}` : ohneTermin}</span>
          </li>
        ))}
      </ul>

      <Label className="mb-1 mt-3"><KindTag kind="fact" />{aktualisierteFakten}</Label>
      <ul className="text-xs">
        {note.factUpdates.map((f, i) => (
          <li key={f.note} className={row(i)}>
            <Chip style={statusStyle[f.status]} />
            <span className="min-w-0 flex-1 leading-snug"><span className={f.status === 'confirmed' ? '' : 'text-muted line-through'}>{f.note}</span>{f.newValue && <span className="flex items-center gap-1"><ArrowRight size={10} className="shrink-0 text-muted" />{f.newValue}</span>}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {note.confirmed ? (
          <span className="flex items-center gap-1.5 text-xs"><SeverityIcon severity="ok" /> {gespeichertHint}</span>
        ) : (
          <>
            <button type="button" onClick={confirm} className="bg-brand px-3 py-1.5 text-xs text-white hover:bg-brand-dark">{bestaetigenUndSpeichern}</button>
            <button type="button" onClick={() => setEditing((e) => !e)} className="border border-line px-3 py-1.5 text-xs hover:bg-stripe">{editing ? fertig : bearbeiten}</button>
            <span className={`ml-auto text-[11px] ${failed ? 'text-risk' : 'text-muted'}`}>{failed ? `${speichernFehlgeschlagen} ${failed}` : editing ? reaktionAnklickenHint : nichtsWirdGespeichertHint}</span>
          </>
        )}
      </div>
    </Panel>
  )
}
