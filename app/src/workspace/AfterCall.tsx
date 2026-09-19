import { ArrowRight, ClipboardCheck, LoaderCircle, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { KindTag, SeverityIcon } from '../cards/ui'
import { useLanguage } from '../data/useLanguage'
import { useTranslated, type Language } from '../data/useTranslate'
import type { CallNote } from '../types'
import { confirmNote, draftNote, isEmptyNote, type SpokenLine } from './callNote'

// After a call: the transcript becomes a draft note (server/calls.ts). The advisor removes what is
// wrong, confirms with one click, and only then it is stored as memory for the next briefing.
// Nothing here is written by the UI: an empty or failed draft is shown as such.
export type EndedCall = { ref: string; name: string; lines: SpokenLine[] }

const reactionOrder = ['accepted', 'rejected', 'open'] as const
const reactionStyle = { accepted: ['angenommen', 'bg-ok text-white'], rejected: ['abgelehnt', 'bg-risk text-white'], open: ['offen', 'bg-pill text-ink'] } as const
const statusStyle = { confirmed: ['bestätigt', 'bg-ok text-white'], outdated: ['veraltet', 'bg-pill text-ink'], changed: ['geändert', 'bg-brand text-white'] } as const
const statusOrder = ['confirmed', 'outdated', 'changed'] as const
const chip = 'w-[74px] shrink-0 rounded-full py-px text-center text-[10px]'
const dateCh = (iso: string, language: Language) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(language === 'en' ? 'en-GB' : 'de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }) }

// The panel's own German strings. They are the source text: shown as they are in German, translated for
// display in English (useTranslated). The note itself stays German, because the engine reads it.
const UI = {
  title: 'Gesprächsnotiz', source: 'Quelle: Transkript', lines: 'Zeilen', confirmed: 'Bestätigt', draft: 'KI-Entwurf',
  draftHint: 'Von der KI aus dem Gespräch entworfen. Gilt erst nach Bestätigung als Fakt.', loading: 'Gesprächsnotiz wird erstellt …',
  none: 'Aus dem Gespräch liess sich keine Notiz ableiten.', reason: 'Grund:',
  noneHint: 'Es wird nichts gespeichert. Das Transkript bleibt sichtbar, bis Sie den Kunden wechseln.',
  promises: 'Zusagen und Aufträge', until: 'bis', noDue: 'ohne Termin', proposed: 'Vorgeschlagen und Reaktion des Kunden',
  change: 'Klicken zum Ändern', inCall: 'Im Gespräch:', facts: 'Aktualisierte Fakten', saveFailed: 'Speichern fehlgeschlagen:',
  saved: 'Gespeichert – fliesst ins nächste Briefing ein', close: 'Schliessen', saving: 'Wird gespeichert …',
  save: 'Bestätigen und speichern', discard: 'Verwerfen', nothingStored: 'Nichts wird ohne Bestätigung gespeichert', remove: 'Eintrag entfernen',
} as const
const UI_KEYS = Object.keys(UI) as (keyof typeof UI)[]
const UI_TEXTS = UI_KEYS.map((k) => UI[k])
const CHIP_TEXTS = [...reactionOrder.map((r) => reactionStyle[r][0]), ...statusOrder.map((s) => statusStyle[s][0])]

function Section({ kind, title, count, children }: { kind: 'fact' | 'action'; title: string; count: number; children: ReactNode }) {
  if (!count) return null
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted"><KindTag kind={kind} />{title}</div>
      <ul className="overflow-hidden rounded-xl bg-white/60 text-xs ring-1 ring-white/70">{children}</ul>
    </div>
  )
}

function Row({ children, onRemove, locked, removeLabel }: { children: ReactNode; onRemove: () => void; locked: boolean; removeLabel: string }) {
  return (
    <li className="flex items-start gap-2 border-b border-line/50 px-2.5 py-2 last:border-b-0">
      {children}
      {!locked && <button type="button" onClick={onRemove} aria-label={removeLabel} title={removeLabel} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted hover:bg-pill hover:text-ink"><X size={12} /></button>}
    </li>
  )
}

export function AfterCall({ call, onClose }: { call: EndedCall; onClose: () => void }) {
  const [note, setNote] = useState<CallNote | null>(null)
  const [phase, setPhase] = useState<'loading' | 'draft' | 'saving' | 'saved'>('loading')
  const [error, setError] = useState<string | null>(null)

  // Display-time translation only: `note` keeps the German texts and is what gets stored.
  const language = useLanguage()
  const uiT = useTranslated(UI_TEXTS, language)
  const t = Object.fromEntries(UI_KEYS.map((k, i) => [k, uiT[i]])) as Record<keyof typeof UI, string>
  const chipT = useTranslated(CHIP_TEXTS, language)
  const reactionT = (r: (typeof reactionOrder)[number]) => chipT[reactionOrder.indexOf(r)]
  const statusT = (s: (typeof statusOrder)[number]) => chipT[reactionOrder.length + statusOrder.indexOf(s)]
  const promiseT = useTranslated(note?.promises.map((p) => p.text) ?? [], language)
  const proposedT = useTranslated(note?.proposed.flatMap((p) => [p.text, p.why ?? '']) ?? [], language)
  const factT = useTranslated(note?.factUpdates.flatMap((f) => [f.note, f.newValue ?? '']) ?? [], language)
  const [errorT] = useTranslated([error ?? ''], language)

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
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={t.title}>
      <div className="anim-rise flex max-h-[86vh] w-[560px] max-w-full flex-col rounded-2xl bg-white/80 shadow-[0_12px_48px_rgba(31,56,88,0.22)] ring-1 ring-white/70 backdrop-blur-xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-line/60 px-5 py-3.5">
          <ClipboardCheck size={17} strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px]">{t.title}</div>
            <div className="truncate text-[11px] text-muted">{call.name} · {t.source}, {call.lines.length} {t.lines}{note ? ` · ${dateCh(note.date, language)}` : ''}</div>
          </div>
          {phase === 'saved'
            ? <span className="rounded-full bg-ok px-2 py-px text-[10px] text-white">{t.confirmed}</span>
            : phase !== 'loading' && !empty && <span className="rounded-full bg-warn px-2 py-px text-[10px] text-ink" title={t.draftHint}>{t.draft}</span>}
        </header>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          {phase === 'loading' ? (
            <p className="flex items-center gap-2 py-6 text-[13px] text-muted"><LoaderCircle size={15} className="animate-spin" /> {t.loading}</p>
          ) : empty ? (
            <div className="py-4 text-[13px]">
              <p>{t.none}</p>
              <p className="mt-1 text-[11px] text-muted">{error && !note ? `${t.reason} ${errorT}. ` : ''}{t.noneHint}</p>
            </div>
          ) : (
            <>
              <Section kind="action" title={t.promises} count={note.promises.length}>
                {note.promises.map((p, i) => (
                  <Row key={`${i}-${p.text}`} onRemove={() => drop('promises', i)} locked={locked} removeLabel={t.remove}>
                    <span className="min-w-0 flex-1 leading-snug">{promiseT[i] ?? p.text}</span>
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-muted tabular-nums">{p.due ? `${t.until} ${dateCh(p.due, language)}` : t.noDue}</span>
                  </Row>
                ))}
              </Section>
              <Section kind="action" title={t.proposed} count={note.proposed.length}>
                {note.proposed.map((p, i) => (
                  <Row key={`${i}-${p.text}`} onRemove={() => drop('proposed', i)} locked={locked} removeLabel={t.remove}>
                    <button type="button" disabled={locked} onClick={() => cycle(i)} title={locked ? undefined : t.change} className={`${chip} ${reactionStyle[p.reaction][1]}`}>{reactionT(p.reaction)}</button>
                    <span className="min-w-0 flex-1 leading-snug">{proposedT[2 * i] ?? p.text}{p.why && <span className="block text-[11px] text-muted">{t.inCall} {proposedT[2 * i + 1] ?? p.why}</span>}</span>
                  </Row>
                ))}
              </Section>
              <Section kind="fact" title={t.facts} count={note.factUpdates.length}>
                {note.factUpdates.map((f, i) => (
                  <Row key={`${i}-${f.note}`} onRemove={() => drop('factUpdates', i)} locked={locked} removeLabel={t.remove}>
                    <span className={`${chip} ${statusStyle[f.status][1]}`}>{statusT(f.status)}</span>
                    <span className="min-w-0 flex-1 leading-snug"><span className={f.status === 'confirmed' ? '' : 'text-muted line-through'}>{factT[2 * i] ?? f.note}</span>{f.newValue && <span className="flex items-center gap-1"><ArrowRight size={10} className="shrink-0 text-muted" />{factT[2 * i + 1] ?? f.newValue}</span>}</span>
                  </Row>
                ))}
              </Section>
            </>
          )}
          {error && note && <p className="text-[11px] text-risk">{t.saveFailed} {errorT}</p>}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line/60 px-5 py-3">
          {phase === 'saved' ? (
            <span className="flex items-center gap-1.5 text-xs"><SeverityIcon severity="ok" /> {t.saved}</span>
          ) : phase === 'loading' || empty ? (
            <button type="button" onClick={onClose} className="ml-auto rounded-full bg-pill px-3 py-1.5 text-xs hover:bg-track">{t.close}</button>
          ) : (
            <>
              <button type="button" onClick={save} disabled={locked} className="rounded-full bg-brand px-3.5 py-1.5 text-xs text-white hover:bg-brand-dark disabled:opacity-60">{phase === 'saving' ? t.saving : t.save}</button>
              <button type="button" onClick={onClose} disabled={locked} className="rounded-full bg-pill px-3 py-1.5 text-xs hover:bg-track disabled:opacity-60">{t.discard}</button>
              <span className="ml-auto text-[11px] text-muted">{t.nothingStored}</span>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
