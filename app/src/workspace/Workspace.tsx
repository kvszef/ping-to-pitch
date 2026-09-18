import { ArrowRight, BarChart3, Headset, MessageSquare, Mic, MicOff, Phone, PhoneCall, PhoneOff, Settings as SettingsIcon, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SeverityIcon } from '../cards/ui'
import { Pill } from '../components/Chrome'
import { CardView } from '../cards/registry'
import { newsFeed } from '../data/mock'
import { topics as topicData, transcripts } from '../data/workspace'
import type { Client, Signal } from '../types'
import { activeProvider, answer, fetchStatus, openingHints, question, think, type Segment, type Status } from './brain'
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
  const open = useMemo(() => (topicData[client.ref] ?? []).filter((t) => !chat.some((e) => e.role === 'ki' && e.text === t.insight[settings.detail])), [client.ref, chat, settings.detail])

  const proposal = client.briefing.find((c) => c.type === 'proposal')
  const shown = hints.find((h) => h.id === activeHint) ?? hints[0]

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
      <div className="flex shrink-0 items-center justify-between bg-band px-3 py-3">
        <div>
          <div className="text-[17px]">Anrufe &amp; Signale</div>
          <div className="mt-1 text-[11px]">KI: {providerLabel[activeProvider(settings, status) ?? 'beispiel']} <span className="mx-1 text-muted">|</span> Aufzeichnung: {settings.record ? 'ein' : 'aus'}</div>
        </div>
        <div className="flex gap-2">
          <Pill icon={PhoneCall} onClick={onSimulateCall}>Anruf simulieren</Pill>
          <Pill icon={SettingsIcon} onClick={() => setSettingsOpen(true)}>Einstellungen</Pill>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2.5 p-2">
        <aside className="flex w-[230px] shrink-0 flex-col bg-white shadow-card">
          <PaneTitle icon={Users} title="Kunden" />
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {clients.map((c, i) => {
              const s = topSignal(c.ref)
              return (
                <li key={c.ref}>
                  <button onClick={() => select(c.ref)} title={s?.title} className={`flex w-full items-center gap-2 border-l-[3px] px-3 py-2.5 text-left transition-colors duration-200 ${c.ref === ref ? 'border-brand bg-brand-soft/30' : `border-transparent hover:bg-brand-soft/20 ${i % 2 ? 'bg-stripe' : ''}`}`}>
                    {s ? <SeverityIcon severity={s.severity} size={12} /> : <span className="block w-3" />}
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 text-[11px] text-muted">{c.profile}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <div ref={split} className={`flex min-w-0 flex-1 ${settings.dragSplit ? '' : 'gap-2.5'} ${dragging ? 'select-none' : ''}`}>
        <Pane grow={base.assistent} still={dragging} icon={Headset} title="Gesprächsassistent"
          actions={<>
            {inCall && settings.record && canListen(status.elevenlabs) && <button onClick={() => setMic((m) => !m)} className={`flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] ${mic ? 'bg-risk text-white' : 'bg-pill hover:bg-track'}`}>{mic ? <Mic size={12} /> : <MicOff size={12} />} Mikrofon</button>}
            <button onClick={() => setInCall((v) => !v)} className={`flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-white ${inCall ? 'bg-risk' : 'bg-brand hover:bg-brand-dark'}`}>{inCall ? <><PhoneOff size={12} /> Gespräch beenden</> : <><Phone size={12} /> Gespräch starten</>}</button>
          </>}>
          <div className="mb-3 flex items-center gap-2 text-[11px] text-muted">
            <span className={`h-2 w-2 rounded-full ${inCall ? 'animate-pulse bg-risk' : 'bg-track'}`} />
            {inCall ? 'Gespräch läuft' : 'Vorbereitung'}
            <button onClick={() => onOpenBriefing(client.ref)} className="ml-auto inline-flex items-center gap-1 text-brand hover:underline">Briefing <ArrowRight size={11} /></button>
          </div>

          {hints.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {hints.slice(0, 6).map((h) => (
                <button key={h.id} onClick={() => setActiveHint(h.id)} title={h.text} aria-pressed={h.id === shown?.id}
                  className={`flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] transition-colors ${h.id === shown?.id ? 'bg-brand text-white' : 'bg-pill hover:bg-brand-soft'}`}>
                  <SeverityIcon severity={h.severity} size={11} /> {h.label}
                </button>
              ))}
            </div>
          )}
          {shown && (
            <div key={shown.id} title={`${shown.why}
${originLabel[shown.origin]} · ${shown.trigger}`} className="anim-rise border-l-4 border-brand bg-brand-soft/25 p-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted"><SeverityIcon severity={shown.severity} size={11} /> {shown.label}</div>
              <p className="text-[19px] leading-snug">{shown.text}</p>
            </div>
          )}
          {(note || (settings.record && lines.length > 0)) && (
            <div className="mt-4 border-t border-line pt-3">
              {note && <p className="mb-2 flex items-start gap-1.5 text-[11px] leading-snug text-risk"><SeverityIcon severity="risk" size={11} /> {note}</p>}
              <ul className="space-y-1 text-xs">{lines.slice(-3).map((l, i) => <li key={lines.length - i} title={l.text} className="anim-rise truncate text-muted"><span className={`mr-1.5 text-[10px] uppercase ${l.speaker === 'Kunde' ? 'text-brand-dark' : ''}`}>{l.speaker}</span>{l.text}</li>)}</ul>
            </div>
          )}
        </Pane>

        {settings.dragSplit && (
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

        <div className={`compact flex shrink-0 flex-col gap-2.5 ${settings.dragSplit ? 'mr-2.5' : ''}`} style={{ width: MID_WIDTH }}>
          <div className="flex min-h-0 flex-[45] flex-col overflow-hidden"><NewsFeed key={client.ref} feed={newsFeed} clientRef={client.ref} /></div>
          <div className="min-h-0 flex-[55] overflow-hidden bg-white shadow-card [&>section]:shadow-none">{proposal && <CardView card={proposal} />}</div>
        </div>

        <Pane grow={base.chat} still={dragging} icon={MessageSquare} title="Berater-Chat"
          footer={
            <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('q') as HTMLInputElement; ask(f.value); f.value = '' }} className="flex border-t border-line text-xs">
              <input name="q" autoComplete="off" placeholder={`Frage zu ${client.name} stellen …`} className="min-w-0 flex-1 px-3 py-2.5 outline-none" />
              <button className="bg-brand px-4 text-white hover:bg-brand-dark">Senden</button>
            </form>
          }>
          {open.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {open.map((t) => <button key={t.id} onClick={() => ask(t.label)} className="rounded-sm bg-pill px-2 py-1 text-[11px] transition-colors hover:bg-brand hover:text-white">{t.label}</button>)}
            </div>
          )}
          <ChatLog chat={chat} busy={busy} detail={settings.detail} onShow={(id) => setChat((c) => c.map((e) => (e.id === id && e.role === 'ki' && e.offered ? { ...e, module: e.offered.spec, offered: undefined } : e)))} />
        </Pane>
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
      className={`flex min-w-0 basis-0 flex-col bg-white shadow-card motion-reduce:transition-none ${still ? '' : 'transition-[flex-grow] duration-[650ms] ease-[cubic-bezier(.22,1,.36,1)]'}`}>
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
              {e.sources.length > 0 && <span title={e.sources.join(' · ')} className="ml-1.5 cursor-help whitespace-nowrap text-[11px] text-muted">· {e.sources.length} Quellen</span>}
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
