import { Mic, MicOff, PanelLeftClose, Phone, PhoneCall, PhoneOff, Settings as SettingsIcon, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useBriefing } from '../data/useBriefing'
import * as deskLine from '../phone/deskLine'
import { usePhoneAudio } from '../phone/usePhoneAudio'
import { demoCalls, lineDelay } from '../data/demoCalls'
import type { Client, Signal } from '../types'
import { activeProvider, agentStep, answer, fetchStatus, question, screenFor, topicsFor, type AgentEvent, type Segment, type Status } from './brain'
import { localPlan, nameIn, rebasePlan, type Plan, type Suggestion } from './screen'
import { SettingsPanel } from './SettingsPanel'
import { useSettings } from './settings'
import { Stage, Transcript } from './Stage'
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
  initialDemo?: string
  onSimulateCall: (demoId: string) => void
  onOpenBriefing: (ref: string) => void
}

const rank = { risk: 0, warn: 1, info: 2, ok: 3 }
// Why the client is probably calling, from the engine's profile check.
const callReasons = (client: Client) => (client.findings ?? []).filter((f) => f.check === 'profile.call-reason').map((f) => f.title).join('; ') || undefined
const providerLabel = { openai: 'OpenAI', apertus: 'Apertus', beispiel: 'Beispielmodus' }

export function Workspace({ clients, signals, initialRef, initialCall, initialDemo, onSimulateCall }: Props) {
  const [settings, update] = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ref, setRef] = useState(initialRef ?? clients[0].ref)
  // An inbound demo call starts without a known caller; the name in the transcript picks the client.
  const [inCall, setInCall] = useState(!!initialCall)
  const [mic, setMic] = useState(false)
  const [status, setStatus] = useState<Status>({ openai: false, apertus: false, elevenlabs: false })
  const [note, setNote] = useState<string | null>(null)
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [hints, setHints] = useState<Hint[]>([])
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [demoMenu, setDemoMenu] = useState(false)

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

  // ---- the conversation ------------------------------------------------------------------------
  // Transcript lines show at once. The agent runs beside the conversation, never in front of it:
  // whatever arrives while it thinks is collected and sent in its next step. Its plan is moved onto
  // the current tiles when the engine's later tiers arrived meanwhile.
  const linesRef = useRef<TranscriptLine[]>([])
  const [pending, setPending] = useState<string[]>([]) // heard, speaker not assigned yet
  const saidRef = useRef<{ ids: string[]; texts: string[] }>({ ids: [], texts: [] })
  const planRef = useRef(plan)
  planRef.current = plan
  const latest = useRef({ client, screen, settings, status, inCall })
  latest.current = { client, screen, settings, status, inCall }
  type Inbox = { segments: Segment[]; unknown: string[]; said: string[]; start: boolean }
  const empty = (): Inbox => ({ segments: [], unknown: [], said: [], start: false })
  const inbox = useRef<Inbox>(empty())
  const running = useRef(false)

  const drain = async () => {
    if (running.current) return
    running.current = true
    setThinking(true)
    while (inbox.current.segments.length || inbox.current.said.length || inbox.current.start) {
      const job = inbox.current
      inbox.current = empty()
      const { client: c, screen: on, settings: st, status: su, inCall: live } = latest.current
      const knownCount = job.segments.length - job.unknown.length
      const before = linesRef.current.slice(0, linesRef.current.length - knownCount)
      const event: AgentEvent = job.segments.length ? { type: 'transcript', segments: job.segments }
        : job.said.length ? { type: 'said', text: job.said.join(' · ') }
        : { type: 'start', call: live ? callReasons(c) : undefined }
      const r = await agentStep(c, on, before, saidRef.current.texts, event, st, su)
      if (latest.current.client.ref !== c.ref) continue // the advisor moved on to another client
      if (job.unknown.length) {
        // Microphone lines: the agent assigned the roles; they replace the "…" placeholders.
        setPending((p) => p.filter((t) => !job.unknown.includes(t)))
        const assigned = r.lines.filter((l) => job.unknown.includes(l.text))
        const lines = assigned.length ? assigned : job.unknown.map((text) => ({ speaker: 'Kunde' as const, text }))
        linesRef.current = [...linesRef.current, ...lines]
        setLines(linesRef.current)
      }
      const spoken = r.lines.filter((l) => l.speaker === 'Berater').flatMap((l) => planRef.current.suggestions.filter((s) => sameSentence(s.text, l.text)))
      if (spoken.length) mark(spoken)
      const now = latest.current.screen
      setPlan(now === on ? r.plan : rebasePlan(r.plan, now.tiles, now.charts))
    }
    setThinking(false)
    running.current = false
  }

  const mark = (list: Suggestion[]) => {
    saidRef.current = { ids: [...saidRef.current.ids, ...list.map((s) => s.id)], texts: [...saidRef.current.texts, ...list.map((s) => s.text)] }
    setSaid(saidRef.current.ids)
  }
  // Clicking a talking point: marked at once and its tile comes forward; the agent follows up.
  const use = (s: Suggestion) => {
    if (saidRef.current.ids.includes(s.id)) return
    mark([s])
    if (s.tile) setPlan((p) => ({ ...p, focus: s.tile!, widgets: [`tile:${s.tile}`, ...p.widgets.filter((w) => w !== `tile:${s.tile}`)].slice(0, 3) }))
    inbox.current.said.push(s.text)
    void drain()
  }

  // Who is calling: until a name is heard, an unknown caller; then the client opens and the call goes on.
  const [identifying, setIdentifying] = useState(!!initialCall && !initialRef)
  const keepCall = useRef(false)
  const hear = (segments: Segment[]) => {
    const known = segments.filter((s) => s.speaker === 'Kunde' || s.speaker === 'Berater')
    const unknown = segments.filter((s) => !(s.speaker === 'Kunde' || s.speaker === 'Berater')).map((s) => s.text)
    if (known.length) { linesRef.current = [...linesRef.current, ...known.map((s) => ({ speaker: s.speaker as TranscriptLine['speaker'], text: s.text }))]; setLines(linesRef.current) }
    if (unknown.length) setPending((p) => [...p, ...unknown])
    if (identifyingRef.current) {
      const found = nameIn(segments.filter((s) => s.speaker !== 'Berater').map((s) => s.text).join(' '), clients)
      if (found) { keepCall.current = true; setIdentifying(false); setRef(found) }
    }
    inbox.current.segments.push(...segments)
    inbox.current.unknown.push(...unknown)
    void drain()
  }
  const identifyingRef = useRef(identifying)
  identifyingRef.current = identifying
  const hearRef = useRef(hear)
  hearRef.current = hear

  useEffect(() => { fetchStatus().then(setStatus) }, [])

  // New client: a fresh start, except when the caller was just recognised mid-call (the call goes on).
  useEffect(() => {
    if (keepCall.current) { keepCall.current = false; saidRef.current = { ids: [], texts: [] }; setSaid([]); setChat([]); setHints([]); return }
    linesRef.current = []; saidRef.current = { ids: [], texts: [] }; inbox.current = empty()
    setLines([]); setPending([]); setChat([]); setHints([]); setSaid([]); setMic(false); setNote(null)
  }, [client.ref])
  // New tiles (client, engine tiers) or the model became reachable: before a call a fresh plan;
  // during a call the running plan is only moved onto the new tiles, the conversation keeps steering.
  const planned = useRef<string | null>(null)
  useEffect(() => {
    if (inCall && planned.current === client.ref) { setPlan((p) => rebasePlan(p, screen.tiles, screen.charts)); return }
    planned.current = client.ref
    setPlan(localPlan(screen.tiles, saidRef.current.ids))
    inbox.current.start = true
    void drain()
  }, [screen, status.openai, status.apertus]) // eslint-disable-line react-hooks/exhaustive-deps

  // An internet call from the client's phone (Arash, phone/): both sides are transcribed from their own
  // streams, so neither the demo script nor the laptop microphone runs alongside it.
  const line = deskLine.useDeskLine()
  const phone = line.state !== 'idle' && line.ref === client.ref
  const phoneCall = line.state === 'connected' && line.ref === client.ref ? line : null
  const wasConnected = useRef(false)
  useEffect(() => {
    if (phoneCall) wasConnected.current = true
    else if (wasConnected.current) { wasConnected.current = false; setInCall(false) } // the client hung up
  }, [phoneCall])
  usePhoneAudio(phoneCall, inCall && settings.record, !!status.transcribe, (segments) => hearRef.current(segments), (error) => setNote(error))
  const endCall = () => { if (phone) deskLine.hangup(); setInCall(false) }

  // A demo call plays its script at speaking pace through the same path as live transcription.
  const demo = demoCalls.find((d) => d.id === initialDemo)
  useEffect(() => {
    if (!inCall || !demo || phone) return
    let stop = false, timer = 0
    const play = (i: number) => {
      if (stop || i >= demo.script.length) return
      hearRef.current([demo.script[i]])
      timer = window.setTimeout(() => play(i + 1), lineDelay(demo.script[i]))
    }
    timer = window.setTimeout(() => play(0), 2000)
    return () => { stop = true; clearTimeout(timer) }
  }, [inCall, demo?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // A call listens to the microphone straight away when recording is on (real transcript, no script).
  useEffect(() => { if (inCall && settings.record && canListen(!!status.transcribe) && !demo && !phone) setMic(true) }, [inCall, status.transcribe]) // eslint-disable-line react-hooks/exhaustive-deps
  // (the internet call brings its own audio; see usePhoneAudio above) // eslint-disable-line react-hooks/exhaustive-deps

  useCallAudio(mic && inCall && settings.record && !phone, !!status.transcribe, (segments) => hearRef.current(segments), (error) => { setMic(false); if (error) setNote(error) })

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
                      <button onClick={() => select(c.ref)} title={s?.title ?? c.profile} className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] transition-colors duration-200 ${c.ref === client.ref && !identifying ? 'bg-brand-soft/40 text-ink' : 'text-ink/75 hover:bg-brand-soft/20'}`}>
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
                <div className="relative">
                  <button onClick={() => setDemoMenu((v) => !v)} aria-label="Demo-Anruf" title="Demo-Anruf" aria-expanded={demoMenu} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg hover:bg-pill hover:text-ink ${demoMenu ? 'bg-pill text-ink' : 'text-muted'}`}><PhoneCall size={14} /></button>
                  {demoMenu && (
                    <div className="anim-rise absolute bottom-9 left-0 z-30 w-64 rounded-xl bg-white/90 p-1.5 shadow-[0_12px_40px_rgba(31,56,88,0.18)] ring-1 ring-black/5 backdrop-blur-xl">
                      {(['eingehend', 'ausgehend'] as const).map((dir) => (
                        <div key={dir}>
                          <div className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-muted">{dir === 'eingehend' ? 'Eingehender Anruf' : 'Ausgehender Anruf'}</div>
                          {demoCalls.filter((d) => d.direction === dir).map((d) => {
                            const who = clients.find((c) => c.ref === d.ref)
                            return (
                              <button key={d.id} onClick={() => { setDemoMenu(false); onSimulateCall(d.id) }} className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-brand-soft/40">
                                <span className="text-[12px]">{who?.name ?? d.ref}</span>
                                <span className="text-[11px] text-muted">{d.label}</span>
                              </button>
                            )
                          })}
                          {!demoCalls.some((d) => d.direction === dir) && <p className="px-2 py-1 text-[11px] text-muted">Folgt.</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          {identifying ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="anim-rise flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/55 px-6 py-10 text-center shadow-[0_8px_32px_rgba(31,56,88,0.10)] ring-1 ring-white/70 backdrop-blur-xl">
                <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-ok text-white"><span className="absolute inset-0 animate-ping rounded-full bg-ok/40" /><Phone size={22} className="relative" /></span>
                <div className="text-[18px]">Unbekannter Anrufer</div>
                <p className="max-w-md text-[13px] text-muted">Die Nummer ist keinem Kunden zugeordnet. Sobald im Gespräch ein Name fällt, öffnet sich der Kunde mit allen Angaben.</p>
                <button onClick={() => { setInCall(false); setIdentifying(false) }} className="flex items-center gap-1.5 rounded-full bg-risk px-3 py-1 text-xs text-white"><PhoneOff size={12} /> Beenden</button>
              </div>
              <div className="rounded-2xl bg-white/55 p-1 shadow-[0_8px_32px_rgba(31,56,88,0.10)] ring-1 ring-white/70 backdrop-blur-xl"><Transcript lines={lines} pending={pending} tall /></div>
            </div>
          ) : (
          <Stage client={client} screen={screen} plan={plan} thinking={thinking} said={said} onUse={use} inCall={inCall} recording={settings.record}
            lines={lines} pending={pending} note={note} hints={hints}
            lead={
              <div className="flex min-w-0 shrink-0 items-baseline gap-2">
                <span className="truncate text-[15px]">{client.name}</span>
                <span className="flex items-center gap-1 text-[11px] text-muted"><span className={`h-1.5 w-1.5 rounded-full ${inCall ? 'animate-pulse bg-risk' : 'bg-track'}`} />{inCall ? 'Gespräch' : 'Vorbereitung'}</span>
              </div>
            }
            actions={
              <div className="flex shrink-0 gap-1.5">
                {inCall && settings.record && canListen(!!status.transcribe) && <button onClick={() => setMic((m) => !m)} aria-label="Mikrofon" title="Mikrofon" className={`flex h-7 w-7 items-center justify-center rounded-full ${mic ? 'bg-risk text-white' : 'bg-pill hover:bg-track'}`}>{mic ? <Mic size={13} /> : <MicOff size={13} />}</button>}
                <button onClick={() => (inCall ? endCall() : setInCall(true))} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-white transition-colors ${inCall ? 'bg-risk' : 'bg-brand hover:bg-brand-dark'}`}>{inCall ? <><PhoneOff size={12} /> Beenden</> : <><Phone size={12} /> Anrufen</>}</button>
              </div>
            }
            chat={chat} busy={busy} detail={settings.detail} chatSuggestions={chatSuggestions} onAsk={ask}
            onShowChart={(id) => setChat((c) => c.map((e) => (e.id === id && e.role === 'ki' && e.offered ? { ...e, module: e.offered.spec, offered: undefined } : e)))} />
          )}
        </section>
      </div>

      <SettingsPanel open={settingsOpen} settings={settings} status={status} update={update} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
