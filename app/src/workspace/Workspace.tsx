import { ArrowRight, BarChart3, MessageSquare, PanelLeftClose, PanelRightClose, Mic, MicOff, Phone, PhoneCall, PhoneOff, Settings as SettingsIcon, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SeverityIcon } from '../cards/ui'
import { CardView } from '../cards/registry'
import { newsFeed } from '../data/mock'
import { transcripts } from '../data/workspace'
import type { Client, Signal } from '../types'
import { activeProvider, answer, fetchStatus, openingHints, question, think, topicsFor, type Segment, type Status } from './brain'
import { LiveIsland } from './CallIsland'
import { ModuleView } from './modules'
import { NewsFeed } from './NewsFeed'
import { SettingsPanel } from './SettingsPanel'
import { useSettings } from './settings'
import type { ChatEntry, Hint, Origin, Slot, TranscriptLine } from './types'
import { canListen, useCallAudio } from './useCallAudio'

type Props = {
  clients: Client[]
  signals: Signal[]
  initialRef?: string
  initialCall?: boolean
  onSimulateCall: () => void
  onOpenBriefing: (ref: string) => void
}

const originLabel: Record<Origin, string> = { gespraech: 'Aus dem Gespräch', chat: 'Aus dem Berater-Chat', kundendaten: 'Aus den Kundendaten' }
const rank = { risk: 0, warn: 1, info: 2, ok: 3 }
const MID_WIDTH = 340
const providerLabel = { openai: 'OpenAI', apertus: 'Apertus', beispiel: 'Beispielmodus' }

export function Workspace({ clients, signals, initialRef, initialCall, onSimulateCall, onOpenBriefing }: Props) {
  const [settings, update] = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ref, setRef] = useState(initialRef ?? clients[0].ref)
  const [inCall, setInCall] = useState(!!initialCall)
  const [mic, setMic] = useState(false)
  const [status, setStatus] = useState<Status>({ openai: false, apertus: false, elevenlabs: false })
  const [note, setNote] = useState<string | null>(null)
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [hints, setHints] = useState<Hint[]>([])
  const [activeHint, setActiveHint] = useState<string | null>(null)
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [busy, setBusy] = useState(false)
  // Answers that arrive while the chat is folded show as a dot on the strip.
  const [seen, setSeen] = useState(0)
  useEffect(() => { if (settings.chatOpen) setSeen(chat.length) }, [settings.chatOpen, chat.length])
  const unseen = settings.chatOpen ? 0 : chat.slice(seen).filter((e) => e.role === 'ki').length
  const client = clients.find((c) => c.ref === ref) ?? clients[0]
  const [customerSlot, setCustomerSlot] = useState<Slot | null>(null)
  const [advisorSlot, setAdvisorSlot] = useState<Slot | null>(null)

  // New hints take the lead; the tabs keep their order so nothing jumps under the pointer.
  const addHints = (found: Hint[]) => {
    setHints((h) => [...found, ...h.filter((x) => !found.some((f) => f.topicId === x.topicId))])
    if (found[0]) setActiveHint(found[0].id)
  }

  // Gesprochenes fliesst in beide Module: Hinweis für den Kunden, Einblick für den Berater.
  // Auswertungen laufen nacheinander, damit das Transkript in der gesprochenen Reihenfolge bleibt.
  const linesRef = useRef<TranscriptLine[]>([])
  const queue = useRef(Promise.resolve())
  const hear = (segments: Segment[]) => {
    queue.current = queue.current.then(async () => {
      const thought = await think(client, linesRef.current, segments, settings, status)
      linesRef.current = [...linesRef.current, ...thought.lines]
      setLines(linesRef.current)
      // Zwei getrennte Spuren: Aussagen des Kunden führen zu einer Antwort, Aussagen des Beraters zum nächsten Schritt.
      if (thought.customer) setCustomerSlot(thought.customer)
      if (thought.advisor) setAdvisorSlot(thought.advisor)
      if (thought.hints.length) addHints(thought.hints)
      const insight = thought.insight
      if (insight) setChat((c) => (c.some((e) => e.role === 'ki' && e.text === (insight as { text: string }).text) ? c : [...c, insight]))
    })
  }
  const hearRef = useRef(hear)
  hearRef.current = hear

  useEffect(() => { fetchStatus().then(setStatus) }, [])

  useEffect(() => {
    linesRef.current = []; queue.current = Promise.resolve()
    setLines([]); setChat([]); setHints(openingHints(client)); setActiveHint(null); setMic(false); setNote(null); setCustomerSlot(null); setAdvisorSlot(null)
  }, [client.ref]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ohne Mikrofon läuft ein Beispielgespräch ab.
  useEffect(() => {
    if (!inCall || !settings.record || mic) return
    const script = transcripts[client.ref] ?? []
    let i = 0
    const timer = setInterval(() => {
      if (i >= script.length) return clearInterval(timer)
      hearRef.current([script[i++]])
    }, 4500)
    return () => clearInterval(timer)
  }, [inCall, settings.record, mic, client.ref])

  useCallAudio(mic && inCall && settings.record, status.elevenlabs, (segments) => hearRef.current(segments), (error) => { setMic(false); if (error) setNote(error) })

  async function ask(text: string) {
    if (!text.trim() || busy) return
    setChat((c) => [...c, question(text)])
    setBusy(true)
    const reply = await answer(client, text, settings, status, chat)
    setChat((c) => [...c, reply.entry])
    addHints(reply.hints)
    if (reply.next && !(inCall && settings.record)) setAdvisorSlot(reply.next)
    setBusy(false)
  }

  const select = (r: string) => { setRef(r); setInCall(false) }
  const topSignal = (r: string) => signals.flatMap((s) => s.affected.filter((a) => a.ref === r).map((a) => ({ ...a, title: s.title }))).sort((a, b) => rank[a.severity] - rank[b.severity])[0]
  const open = useMemo(() => topicsFor(client).filter((t) => !chat.some((e) => e.role === 'ki' && e.text === t.insight[settings.detail])), [client, chat, settings.detail])

  // Real client files have no proposal yet (engine track): their rule violations fill the panel instead.
  const proposal = client.briefing.find((c) => c.type === 'proposal') ?? client.briefing.find((c) => c.type === 'flags')
  const shown = hints.find((h) => h.id === activeHint) ?? hints[0]

  // Flow: arrow keys walk through the points without reaching for the mouse (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [role=separator]')) return
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      const list = hints.slice(0, 6)
      const at = Math.max(0, list.findIndex((h) => h.id === shown?.id))
      const next = list[(at + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]
      if (next) setActiveHint(next.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hints, shown])

  const base = { assistent: 1 + (100 - settings.focus) / 50, chat: 1 + settings.focus / 50 }

  // Trennlinie von Hand ziehen: die Zeigerposition bestimmt den Anteil des Berater-Chats (25–75 %).
  const split = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragTo = (x: number) => {
    const box = split.current?.getBoundingClientRect()
    if (!box) return
    // Die mittlere Spalte ist fest breit; verteilt wird nur der Rest zwischen Gesprächsassistent und Berater-Chat.
    const share = 1 - (x - box.left) / (box.width - MID_WIDTH - 20)
    update({ focus: Math.round(Math.max(0, Math.min(100, (share * 4 - 1) * 50))) })
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 gap-2.5 bg-gradient-to-br from-brand-soft/25 via-transparent to-transparent p-2">
        <aside style={{ width: settings.clientsOpen ? 196 : 44 }} className={`flex shrink-0 flex-col overflow-hidden rounded-xl bg-white/60 transition-[width,opacity] duration-500 ease-[cubic-bezier(.22,1,.36,1)] ${inCall ? 'opacity-40 hover:opacity-100' : ''}`}>
          {!settings.clientsOpen ? (
            <button onClick={() => update({ clientsOpen: true })} aria-label="Kundenliste öffnen" title="Kundenliste öffnen"
              className="flex h-full w-11 flex-col items-center gap-2.5 py-4 text-muted transition-colors hover:text-ink">
              <Users size={16} strokeWidth={1.5} />
              <span className="whitespace-nowrap text-[11px] [writing-mode:vertical-rl]">Kunden</span>
            </button>
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-end border-b border-line/60 px-1.5 py-1">
                <button onClick={() => update({ clientsOpen: false })} aria-label="Kundenliste einklappen" title="Kundenliste einklappen" className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-pill hover:text-ink"><PanelLeftClose size={15} /></button>
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto py-1.5">
                {clients.map((c) => {
                  const s = topSignal(c.ref)
                  const severity = s?.severity ?? (c.errors ? 'risk' : c.warnings ? 'warn' : null)
                  return (
                    <li key={c.ref}>
                      <button onClick={() => select(c.ref)} title={s?.title ?? c.profile} className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] transition-colors duration-200 ${c.ref === ref ? 'bg-brand-soft/40 text-ink' : 'text-ink/75 hover:bg-brand-soft/20'}`}>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${severity === 'risk' ? 'bg-risk' : severity === 'warn' ? 'bg-warn' : 'bg-transparent'}`} />
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="flex shrink-0 items-center gap-1 border-t border-line/60 px-2 py-1.5">
                <button onClick={() => setSettingsOpen(true)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-muted hover:bg-pill hover:text-ink">
                  <SettingsIcon size={14} className="shrink-0" /><span className="truncate">KI: {providerLabel[activeProvider(settings, status) ?? 'beispiel']}</span>
                </button>
                <button onClick={onSimulateCall} aria-label="Anruf simulieren" title="Anruf simulieren" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-pill hover:text-ink"><PhoneCall size={14} /></button>
              </div>
            </>
          )}
        </aside>

        <div ref={split} className={`flex min-w-0 flex-1 ${settings.dragSplit ? '' : 'gap-2.5'} ${dragging ? 'select-none' : ''}`}>
        <section style={{ flexGrow: base.assistent }} className={`flex min-w-0 basis-0 flex-col overflow-hidden rounded-xl bg-white shadow-card motion-reduce:transition-none ${dragging ? '' : 'transition-[flex-grow] duration-[650ms] ease-[cubic-bezier(.22,1,.36,1)]'}`}>
          <div className="flex shrink-0 items-center gap-2 px-6 pt-5">
            <div className="min-w-0">
              <div className="truncate text-[17px]">{client.name}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${inCall ? 'animate-pulse bg-risk' : 'bg-track'}`} />
                {inCall ? 'Gespräch läuft' : 'Vorbereitung'}
                <button onClick={() => onOpenBriefing(client.ref)} className="ml-1 inline-flex items-center gap-0.5 hover:text-brand">Briefing <ArrowRight size={10} /></button>
              </div>
            </div>
            <div className="ml-auto flex shrink-0 gap-1.5">
              {inCall && settings.record && canListen(status.elevenlabs) && <button onClick={() => setMic((m) => !m)} aria-label="Mikrofon" title="Mikrofon" className={`flex h-8 w-8 items-center justify-center rounded-full ${mic ? 'bg-risk text-white' : 'bg-pill hover:bg-track'}`}>{mic ? <Mic size={14} /> : <MicOff size={14} />}</button>}
              <button onClick={() => setInCall((v) => !v)} className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs text-white transition-colors ${inCall ? 'bg-risk' : 'bg-brand hover:bg-brand-dark'}`}>{inCall ? <><PhoneOff size={13} /> Beenden</> : <><Phone size={13} /> Anrufen</>}</button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col justify-center px-6 py-4">
            {shown && (
              <div key={shown.id} title={`${shown.why}\n${originLabel[shown.origin]} · ${shown.trigger}`} className="anim-rise">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted"><SeverityIcon severity={shown.severity} size={11} /> {shown.label}</div>
                <p className="text-[22px] leading-snug">{shown.text}</p>
              </div>
            )}
          </div>

          {hints.length > 1 && (
            <nav aria-label="Gesprächspunkte" className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-6 pb-4 text-xs">
              {hints.slice(0, 6).map((h, n) => (
                <button key={h.id} onClick={() => setActiveHint(h.id)} aria-pressed={h.id === shown?.id} title={h.text}
                  className={`border-b-2 pb-0.5 transition-colors ${h.id === shown?.id ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
                  <span className="mr-1 text-[10px] tabular-nums text-muted">{n + 1}</span>{h.label}
                </button>
              ))}
              <span className="ml-auto hidden text-[10px] text-muted xl:inline">← → blättern</span>
            </nav>
          )}

          {(note || (settings.record && lines.length > 0)) && (
            <div className="shrink-0 border-t border-line/60 px-6 py-3">
              {note && <p className="mb-2 flex items-start gap-1.5 text-[11px] leading-snug text-risk"><SeverityIcon severity="risk" size={11} /> {note}</p>}
              <ul className="space-y-1 text-xs">{lines.slice(-2).map((l, i) => <li key={lines.length - i} title={l.text} className="anim-rise truncate text-muted"><span className={`mr-1.5 text-[10px] ${l.speaker === 'Kunde' ? 'text-brand-dark' : ''}`}>{l.speaker}</span>{l.text}</li>)}</ul>
            </div>
          )}
        </section>

        {settings.dragSplit && settings.chatOpen && (
          <div role="separator" aria-orientation="vertical" aria-label="Aufteilung zwischen Gesprächsassistent und Berater-Chat" aria-valuenow={settings.focus} tabIndex={0}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true) }}
            onPointerMove={(e) => { if (dragging) dragTo(e.clientX) }}
            onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}
            onDoubleClick={() => update({ focus: 50 })}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft') update({ focus: Math.min(100, settings.focus + 5) }); if (e.key === 'ArrowRight') update({ focus: Math.max(0, settings.focus - 5) }) }}
            className="group flex w-2.5 shrink-0 cursor-col-resize touch-none items-center justify-center outline-none">
            <span className={`h-10 w-[3px] rounded-full transition-all duration-200 group-hover:h-16 group-hover:bg-brand group-focus-visible:h-16 group-focus-visible:bg-brand ${dragging ? 'h-16 bg-brand' : 'bg-track'}`} />
          </div>
        )}

        <div className={`compact flex shrink-0 flex-col gap-2.5 transition-opacity duration-500 ${settings.dragSplit ? 'mr-2.5' : ''} ${inCall ? 'opacity-50 hover:opacity-100' : ''}`} style={{ width: MID_WIDTH }}>
          <div className="flex max-h-[45%] min-h-0 shrink-0 flex-col overflow-hidden"><NewsFeed key={client.ref} feed={newsFeed} clientRef={client.ref} /></div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl bg-white/75 shadow-card ring-1 ring-black/5 backdrop-blur-md [&>section]:bg-transparent [&>section]:shadow-none">{proposal && <CardView card={proposal} />}</div>
        </div>

        {!settings.chatOpen ? (
          <button onClick={() => update({ chatOpen: true })} aria-label="Chat öffnen" title="Chat öffnen"
            className="anim-rise flex w-11 shrink-0 flex-col items-center gap-2.5 rounded-xl bg-white/75 py-4 text-muted shadow-card ring-1 ring-black/5 transition-colors hover:bg-white hover:text-ink">
            <MessageSquare size={16} strokeWidth={1.5} />
            {unseen > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] tabular-nums text-white">{unseen}</span>}
            <span className="text-[11px] [writing-mode:vertical-rl]">Chat</span>
          </button>
        ) : (
        <Pane grow={base.chat} still={dragging} icon={MessageSquare} title="Chat"
          actions={<button onClick={() => update({ chatOpen: false })} aria-label="Chat einklappen" title="Chat einklappen" className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-pill hover:text-ink"><PanelRightClose size={15} /></button>}
          footer={
            <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('q') as HTMLInputElement; ask(f.value); f.value = '' }} className="flex items-center gap-2 border-t border-line/70 p-2 text-xs">
              <input name="q" autoComplete="off" placeholder={`Frage zu ${client.name} …`} className="min-w-0 flex-1 rounded-full bg-stripe px-3.5 py-2 outline-none focus:ring-1 focus:ring-brand" />
              <button aria-label="Senden" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-dark"><ArrowRight size={14} /></button>
            </form>
          }>
          {open.length > 0 && (
            <div className="mb-3 space-y-1">
              {open.map((t) => <button key={t.id} onClick={() => ask(t.label)} className="block text-left text-[11px] text-muted transition-colors hover:text-brand">{t.label}</button>)}
            </div>
          )}
          <ChatLog chat={chat} busy={busy} detail={settings.detail} onShow={(id) => setChat((c) => c.map((e) => (e.id === id && e.role === 'ki' && e.offered ? { ...e, module: e.offered.spec, offered: undefined } : e)))} />
        </Pane>
        )}
        </div>
      </div>

      {inCall && <LiveIsland key={client.ref} client={client} recording={settings.record} customer={customerSlot} advisor={advisorSlot} onEnd={() => setInCall(false)} />}
      <SettingsPanel open={settingsOpen} settings={settings} status={status} update={update} onClose={() => setSettingsOpen(false)} />
    </>
  )
}

function PaneTitle({ icon: Icon, title, actions }: { icon: typeof Users; title: string; actions?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-4">
      <h3 className="flex min-w-0 items-baseline gap-2 text-[15px]"><Icon size={16} strokeWidth={1.5} className="shrink-0 self-center" /><span className="whitespace-nowrap">{title}</span></h3>
      {actions && <div className="flex shrink-0 gap-1.5">{actions}</div>}
    </div>
  )
}

function Pane({ grow, still, icon, title, actions, footer, children }: { grow: number; still: boolean; icon: typeof Users; title: string; actions?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section
      style={{ flexGrow: grow }}
      className={`flex min-w-0 basis-0 flex-col overflow-hidden rounded-xl bg-white/75 shadow-card ring-1 ring-black/5 backdrop-blur-md motion-reduce:transition-none ${still ? '' : 'transition-[flex-grow] duration-[650ms] ease-[cubic-bezier(.22,1,.36,1)]'}`}>
      <PaneTitle icon={icon} title={title} actions={actions} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      {footer}
    </section>
  )
}

function ChatLog({ chat, busy, detail, onShow }: { chat: ChatEntry[]; busy: boolean; detail: 'kurz' | 'standard' | 'detailliert'; onShow: (id: string) => void }) {
  const end = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [chat, busy])
  return (
    <div className="space-y-2.5 text-xs">
      {chat.map((e) => {
        if (e.role === 'berater') return <div key={e.id} className="anim-rise ml-auto w-fit max-w-[85%] bg-brand px-2.5 py-1.5 leading-snug text-white">{e.text}</div>
        const cutAt = e.text.search(/[.!?](\s|$)/) + 1
        const long = cutAt > 0 && cutAt < e.text.length - 1 && !expanded.has(e.id)
        return (
          <div key={e.id} className="anim-rise bg-stripe px-3 py-2.5">
            <p className="leading-relaxed">
              {e.origin === 'gespraech' && <span className="mr-1.5 text-[10px] uppercase tracking-wide text-brand-dark">Gespräch</span>}
              {long ? e.text.slice(0, cutAt) : e.text}
              {long && <button onClick={() => setExpanded((x) => new Set(x).add(e.id))} className="ml-1 text-brand hover:underline">mehr</button>}
              {e.sources.length > 0 && <span title={e.sources.join(' · ')} className="ml-1.5 cursor-help whitespace-nowrap text-[11px] text-muted">· {e.sources.length} {e.sources.length === 1 ? 'Quelle' : 'Quellen'}</span>}
            </p>
            {e.module && <ModuleView spec={e.module} detail={detail} />}
            {e.offered && <button onClick={() => onShow(e.id)} className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-pill px-2 py-1 text-[11px] hover:bg-brand hover:text-white"><BarChart3 size={12} /> Grafik · {e.offered.confidence}%</button>}
          </div>
        )
      })}
      {busy && <div className="text-muted">…</div>}
      <div ref={end} />
    </div>
  )
}
