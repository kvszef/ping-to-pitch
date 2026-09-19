import { Mic, MicOff, PanelLeftClose, Phone, PhoneCall, PhoneOff, Settings as SettingsIcon, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useBriefing } from '../data/useBriefing'
import * as deskLine from '../phone/deskLine'
import { usePhoneAudio } from '../phone/usePhoneAudio'
import { transcripts } from '../data/workspace'
import type { Client, Signal } from '../types'
import { activeProvider, agentStep, answer, fetchStatus, question, screenFor, topicsFor, type AgentEvent, type Segment, type Status } from './brain'
import { localPlan, type Plan, type Suggestion } from './screen'
import { SettingsPanel } from './SettingsPanel'
import { useSettings } from './settings'
import { Stage } from './Stage'
import type { ChatEntry, Hint, TranscriptLine } from './types'
import { canListen, useCallAudio } from './useCallAudio'

const stem = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3).map((w) => w.slice(0, 6)))
// A spoken line counts as the talking point when it shares at least half of its content words.
const sameSentence = (idea: string, spoken: string) => { const a = stem(idea), b = stem(spoken); let n = 0; a.forEach((w) => { if (b.has(w)) n++ }); return a.size > 0 && n / a.size >= 0.5 }

type Props = {
  clients: Client[]
  signals: Signal[]
  initialRef?: string
  initialCall?: boolean
  onSimulateCall: () => void
  onOpenBriefing: (ref: string) => void
}

const rank = { risk: 0, warn: 1, info: 2, ok: 3 }
const providerLabel = { openai: 'OpenAI', apertus: 'Apertus', beispiel: 'Beispielmodus' }

export function Workspace({ clients, signals, initialRef, initialCall, onSimulateCall }: Props) {
  const [settings, update] = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ref, setRef] = useState(initialRef ?? clients[0].ref)
  const [inCall, setInCall] = useState(!!initialCall)
  const [mic, setMic] = useState(false)
  const [status, setStatus] = useState<Status>({ openai: false, apertus: false, elevenlabs: false })
  const [note, setNote] = useState<string | null>(null)
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [hints, setHints] = useState<Hint[]>([])
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [busy, setBusy] = useState(false)

  // The client, enriched with the engine's briefing once the server answered.
  const listed = clients.find((c) => c.ref === ref) ?? clients[0]
  const engine = useBriefing(listed.ref)
  const client = useMemo(() => (engine.findings.length || engine.cards.length
    ? { ...listed, briefing: engine.cards.length ? engine.cards : listed.briefing, findings: engine.findings.length ? engine.findings : undefined }
    : listed), [listed, engine.cards, engine.findings])
  // The elements the agent can show for this client, and its current plan.
  const screen = useMemo(() => screenFor(client), [client])
  const [plan, setPlan] = useState<Plan>(() => localPlan(screen.tiles, []))
  const [said, setSaid] = useState<string[]>([])
  const [thinking, setThinking] = useState(false)

  // Agent steps run one after another, so the transcript stays in spoken order; results for a
  // client the advisor already left are dropped.
  const linesRef = useRef<TranscriptLine[]>([])
  const saidRef = useRef<{ ids: string[]; texts: string[] }>({ ids: [], texts: [] })
  const planRef = useRef(plan)
  planRef.current = plan
  const queue = useRef(Promise.resolve())
  const current = useRef(client.ref)
  current.current = client.ref
  const screenRef = useRef(screen)
  screenRef.current = screen
  const step = (event: AgentEvent) => {
    const at = client.ref, on = screen
    queue.current = queue.current.then(async () => {
      setThinking(true)
      const r = await agentStep(client, on, linesRef.current, saidRef.current.texts, event, settings, status)
      if (current.current !== at) return
      setThinking(false)
      if (screenRef.current !== on) return // the tiles changed meanwhile (engine data arrived); a newer step follows
      if (r.lines.length) { linesRef.current = [...linesRef.current, ...r.lines]; setLines(linesRef.current) }
      // A talking point the advisor just said is marked, so it drops back.
      const spoken = r.lines.filter((l) => l.speaker === 'Berater').flatMap((l) => planRef.current.suggestions.filter((s) => sameSentence(s.text, l.text)))
      if (spoken.length) mark(spoken)
      setPlan(r.plan)
    })
  }
  const mark = (list: Suggestion[]) => {
    saidRef.current = { ids: [...saidRef.current.ids, ...list.map((s) => s.id)], texts: [...saidRef.current.texts, ...list.map((s) => s.text)] }
    setSaid(saidRef.current.ids)
  }
  const use = (s: Suggestion) => { if (saidRef.current.ids.includes(s.id)) return; mark([s]); step({ type: 'said', text: s.text }) }
  const stepRef = useRef(step)
  stepRef.current = step
  const hear = (segments: Segment[]) => stepRef.current({ type: 'transcript', segments })

  useEffect(() => { fetchStatus().then(setStatus) }, [])

  // An internet call from the client's phone: both sides are transcribed from their own streams,
  // so neither the script nor the laptop-microphone recording runs alongside it.
  const line = deskLine.useDeskLine()
  const phone = line.state !== 'idle' && line.ref === client.ref
  const phoneCall = line.state === 'connected' && line.ref === client.ref ? line : null
  const wasConnected = useRef(false)
  useEffect(() => {
    if (phoneCall) wasConnected.current = true
    else if (wasConnected.current) { wasConnected.current = false; setInCall(false) } // the client hung up
  }, [phoneCall])
  usePhoneAudio(phoneCall, inCall && settings.record, !!status.transcribe, (segments) => hear(segments), (error) => setNote(error))
  const endCall = () => { deskLine.hangup(); setInCall(false) }

  // New client: clear the conversation and start with the local plan.
  useEffect(() => {
    linesRef.current = []; queue.current = Promise.resolve(); saidRef.current = { ids: [], texts: [] }
    setLines([]); setChat([]); setHints([]); setSaid([]); setMic(false); setNote(null)
  }, [client.ref])
  // Whenever the elements change (client, engine data) or the model became reachable: a fresh plan.
  useEffect(() => {
    setPlan(localPlan(screen.tiles, saidRef.current.ids))
    stepRef.current({ type: 'start' })
  }, [screen, status.openai, status.apertus])

  // Without a microphone a scripted conversation plays.
  useEffect(() => {
    if (!inCall || !settings.record || mic || phone) return
    const script = transcripts[client.ref] ?? []
    let i = 0
    const timer = setInterval(() => {
      if (i >= script.length) return clearInterval(timer)
      hear([script[i++]])
    }, 5500)
    return () => clearInterval(timer)
  }, [inCall, settings.record, mic, client.ref, phone]) // eslint-disable-line react-hooks/exhaustive-deps

  // A call listens to the microphone straight away when recording is on (real transcript, no script).
  useEffect(() => { if (inCall && !phone && settings.record && canListen(!!status.transcribe) && !(transcripts[client.ref]?.length)) setMic(true) }, [inCall]) // eslint-disable-line react-hooks/exhaustive-deps

  useCallAudio(mic && inCall && settings.record && !phone, !!status.transcribe, (segments) => hear(segments), (error) => { setMic(false); if (error) setNote(error) })

  async function ask(text: string) {
    if (!text.trim() || busy) return
    setChat((c) => [...c, question(text)])
    setBusy(true)
    const reply = await answer(client, text, settings, status, chat)
    setChat((c) => [...c, reply.entry])
    if (reply.hints.length) setHints(reply.hints)
    setBusy(false)
  }

  const select = (r: string) => { setRef(r); setInCall(false) }
  const topSignal = (r: string) => signals.flatMap((s) => s.affected.filter((a) => a.ref === r).map((a) => ({ ...a, title: s.title }))).sort((a, b) => rank[a.severity] - rank[b.severity])[0]
  const chatSuggestions = useMemo(() => topicsFor(client).map((t) => t.label), [client])

  return (
    <>
      <div className="flex min-h-0 flex-1 gap-3 bg-[radial-gradient(ellipse_at_top_left,rgba(89,151,237,0.28),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(105,212,214,0.22),transparent_55%)] p-3">
        <aside style={{ width: settings.clientsOpen ? 196 : 44 }} className={`flex shrink-0 flex-col overflow-hidden rounded-2xl bg-white/55 shadow-[0_8px_32px_rgba(31,56,88,0.10)] ring-1 ring-white/70 backdrop-blur-xl transition-[width,opacity] duration-500 ease-[cubic-bezier(.22,1,.36,1)] ${inCall ? 'opacity-40 hover:opacity-100' : ''}`}>
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
                      <button onClick={() => select(c.ref)} title={s?.title ?? c.profile} className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] transition-colors duration-200 ${c.ref === client.ref ? 'bg-brand-soft/40 text-ink' : 'text-ink/75 hover:bg-brand-soft/20'}`}>
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

        <section className="flex min-w-0 flex-1 flex-col">
          <Stage client={client} screen={screen} plan={plan} thinking={thinking} said={said} onUse={use} inCall={inCall} recording={settings.record}
            lines={lines} note={note} onEnd={endCall} hints={hints}
            lead={
              <div className="flex min-w-0 shrink-0 items-baseline gap-2">
                <span className="truncate text-[15px]">{client.name}</span>
                <span className="flex items-center gap-1 text-[11px] text-muted"><span className={`h-1.5 w-1.5 rounded-full ${inCall ? 'animate-pulse bg-risk' : 'bg-track'}`} />{inCall ? 'Gespräch' : 'Vorbereitung'}</span>
              </div>
            }
            actions={
              <div className="flex shrink-0 gap-1.5">
                {inCall && !phone && settings.record && canListen(!!status.transcribe) && <button onClick={() => setMic((m) => !m)} aria-label="Mikrofon" title="Mikrofon" className={`flex h-7 w-7 items-center justify-center rounded-full ${mic ? 'bg-risk text-white' : 'bg-pill hover:bg-track'}`}>{mic ? <Mic size={13} /> : <MicOff size={13} />}</button>}
                <button onClick={() => (inCall ? endCall() : setInCall(true))} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-white transition-colors ${inCall ? 'bg-risk' : 'bg-brand hover:bg-brand-dark'}`}>{inCall ? <><PhoneOff size={12} /> Beenden</> : <><Phone size={12} /> Anrufen</>}</button>
              </div>
            }
            chat={chat} busy={busy} detail={settings.detail} chatSuggestions={chatSuggestions} onAsk={ask}
            onShowChart={(id) => setChat((c) => c.map((e) => (e.id === id && e.role === 'ki' && e.offered ? { ...e, module: e.offered.spec, offered: undefined } : e)))} />
        </section>
      </div>

      <SettingsPanel open={settingsOpen} settings={settings} status={status} update={update} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
