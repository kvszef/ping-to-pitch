import { ArrowRight, ClipboardCheck, LoaderCircle, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { KindTag, SeverityIcon } from '../cards/ui'
import type { CallNote } from '../types'
import { confirmNote, draftNote, isEmptyNote, type SpokenLine } from './callNote'

// After a call: the transcript becomes a draft note (server/calls.ts). The advisor removes what is
// wrong, confirms with one click, and only then it is stored as memory for the next briefing.
// Nothing here is written by the UI: an empty or failed draft is shown as such.
export type EndedCall = { ref: string; name: string; lines: SpokenLine[] }

const reactionOrder = ['accepted', 'rejected', 'open'] as const
const reactionStyle = { accepted: ['angenommen', 'bg-ok text-white'], rejected: ['abgelehnt', 'bg-risk text-white'], open: ['offen', 'bg-pill text-ink'] } as const
const statusStyle = { confirmed: ['bestätigt', 'bg-ok text-white'], outdated: ['veraltet', 'bg-pill text-ink'], changed: ['geändert', 'bg-brand text-white'] } as const
const chip = 'w-[74px] shrink-0 rounded-full py-px text-center text-[10px]'
const dateCh = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }) }

function Section({ kind, title, count, children }: { kind: 'fact' | 'action'; title: string; count: number; children: ReactNode }) {
  if (!count) return null
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted"><KindTag kind={kind} />{title}</div>
      <ul className="overflow-hidden rounded-xl bg-white/60 text-xs ring-1 ring-white/70">{children}</ul>
    </div>
  )
}

function Row({ children, onRemove, locked }: { children: ReactNode; onRemove: () => void; locked: boolean }) {
  return (
    <li className="flex items-start gap-2 border-b border-line/50 px-2.5 py-2 last:border-b-0">
      {children}
      {!locked && <button type="button" onClick={onRemove} aria-label="Eintrag entfernen" title="Eintrag entfernen" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted hover:bg-pill hover:text-ink"><X size={12} /></button>}
    </li>
  )
}

export function AfterCall({ call, onClose }: { call: EndedCall; onClose: () => void }) {
  const [note, setNote] = useState<CallNote | null>(null)
  const [phase, setPhase] = useState<'loading' | 'draft' | 'saving' | 'saved'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    draftNote(call.ref, call.lines, call.name)
      .then((n) => { if (!stale) { setNote(n); setPhase('draft') } })
      .catch((e: unknown) => { if (!stale) { setError(e instanceof Error ? e.message : 'Unbekannter Fehler'); setPhase('draft') } })
    return () => { stale = true }
  }, [call])

  // A saved note closes by itself; the confirmation stays long enough to be read.
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  useEffect(() => {
    if (phase !== 'saved') return
    const timer = setTimeout(() => close.current(), 2600)
    return () => clearTimeout(timer)
  }, [phase])

  const save = async () => {
    if (!note) return
    setPhase('saving'); setError(null)
    try { await confirmNote(call.ref, note); setNote({ ...note, confirmed: true }); setPhase('saved') }
    catch (e) { setError(e instanceof Error ? e.message : 'Unbekannter Fehler'); setPhase('draft') }
  }

  const locked = phase !== 'draft'
  const empty = !note || isEmptyNote(note)
  const drop = <K extends 'proposed' | 'promises' | 'factUpdates'>(key: K, i: number) => setNote((n) => (n ? { ...n, [key]: n[key].filter((_, j) => j !== i) } : n))
  const cycle = (i: number) => setNote((n) => (n ? { ...n, proposed: n.proposed.map((p, j) => (j === i ? { ...p, reaction: reactionOrder[(reactionOrder.indexOf(p.reaction) + 1) % 3] } : p)) } : n))

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Gesprächsnotiz">
      <div className="anim-rise flex max-h-[86vh] w-[560px] max-w-full flex-col rounded-2xl bg-white/80 shadow-[0_12px_48px_rgba(31,56,88,0.22)] ring-1 ring-white/70 backdrop-blur-xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-line/60 px-5 py-3.5">
          <ClipboardCheck size={17} strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px]">Gesprächsnotiz</div>
            <div className="truncate text-[11px] text-muted">{call.name} · Quelle: Transkript, {call.lines.length} Zeilen{note ? ` · ${dateCh(note.date)}` : ''}</div>
          </div>
          {phase === 'saved'
            ? <span className="rounded-full bg-ok px-2 py-px text-[10px] text-white">Bestätigt</span>
            : phase !== 'loading' && !empty && <span className="rounded-full bg-warn px-2 py-px text-[10px] text-ink" title="Von der KI aus dem Gespräch entworfen. Gilt erst nach Bestätigung als Fakt.">KI-Entwurf</span>}
        </header>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          {phase === 'loading' ? (
            <p className="flex items-center gap-2 py-6 text-[13px] text-muted"><LoaderCircle size={15} className="animate-spin" /> Gesprächsnotiz wird erstellt …</p>
          ) : empty ? (
            <div className="py-4 text-[13px]">
              <p>Aus dem Gespräch liess sich keine Notiz ableiten.</p>
              <p className="mt-1 text-[11px] text-muted">{error && !note ? `Grund: ${error}. ` : ''}Es wird nichts gespeichert. Das Transkript bleibt sichtbar, bis Sie den Kunden wechseln.</p>
            </div>
          ) : (
            <>
              <Section kind="action" title="Zusagen und Aufträge" count={note.promises.length}>
                {note.promises.map((p, i) => (
                  <Row key={`${i}-${p.text}`} onRemove={() => drop('promises', i)} locked={locked}>
                    <span className="min-w-0 flex-1 leading-snug">{p.text}</span>
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-muted tabular-nums">{p.due ? `bis ${dateCh(p.due)}` : 'ohne Termin'}</span>
                  </Row>
                ))}
              </Section>
              <Section kind="action" title="Vorgeschlagen und Reaktion des Kunden" count={note.proposed.length}>
                {note.proposed.map((p, i) => (
                  <Row key={`${i}-${p.text}`} onRemove={() => drop('proposed', i)} locked={locked}>
                    <button type="button" disabled={locked} onClick={() => cycle(i)} title={locked ? undefined : 'Klicken zum Ändern'} className={`${chip} ${reactionStyle[p.reaction][1]}`}>{reactionStyle[p.reaction][0]}</button>
                    <span className="min-w-0 flex-1 leading-snug">{p.text}{p.why && <span className="block text-[11px] text-muted">Im Gespräch: {p.why}</span>}</span>
                  </Row>
                ))}
              </Section>
              <Section kind="fact" title="Aktualisierte Fakten" count={note.factUpdates.length}>
                {note.factUpdates.map((f, i) => (
                  <Row key={`${i}-${f.note}`} onRemove={() => drop('factUpdates', i)} locked={locked}>
                    <span className={`${chip} ${statusStyle[f.status][1]}`}>{statusStyle[f.status][0]}</span>
                    <span className="min-w-0 flex-1 leading-snug"><span className={f.status === 'confirmed' ? '' : 'text-muted line-through'}>{f.note}</span>{f.newValue && <span className="flex items-center gap-1"><ArrowRight size={10} className="shrink-0 text-muted" />{f.newValue}</span>}</span>
                  </Row>
                ))}
              </Section>
            </>
          )}
          {error && note && <p className="text-[11px] text-risk">Speichern fehlgeschlagen: {error}</p>}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line/60 px-5 py-3">
          {phase === 'saved' ? (
            <span className="flex items-center gap-1.5 text-xs"><SeverityIcon severity="ok" /> Gespeichert – fliesst ins nächste Briefing ein</span>
          ) : phase === 'loading' || empty ? (
            <button type="button" onClick={onClose} className="ml-auto rounded-full bg-pill px-3 py-1.5 text-xs hover:bg-track">Schliessen</button>
          ) : (
            <>
              <button type="button" onClick={save} disabled={locked} className="rounded-full bg-brand px-3.5 py-1.5 text-xs text-white hover:bg-brand-dark disabled:opacity-60">{phase === 'saving' ? 'Wird gespeichert …' : 'Bestätigen und speichern'}</button>
              <button type="button" onClick={onClose} disabled={locked} className="rounded-full bg-pill px-3 py-1.5 text-xs hover:bg-track disabled:opacity-60">Verwerfen</button>
              <span className="ml-auto text-[11px] text-muted">Nichts wird ohne Bestätigung gespeichert</span>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
