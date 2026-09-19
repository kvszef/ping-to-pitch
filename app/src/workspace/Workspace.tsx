import { PanelLeftClose, Mic, MicOff, Phone, PhoneCall, PhoneOff, Settings as SettingsIcon, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { transcripts } from '../data/workspace'
import type { Client, Signal } from '../types'
import { activeProvider, answer, fetchStatus, openingHints, question, suggest, think, topicsFor, type Segment, type Status } from './brain'
import { QuickAsk } from './QuickAsk'
import { Stage } from './Stage'
import { SettingsPanel } from './SettingsPanel'
import { useSettings } from './settings'
import type { ChatEntry, Hint, Slot, TranscriptLine } from './types'
import { canListen, useCallAudio } from './useCallAudio'

const stem = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3).map((w) => w.slice(0, 6)))
// A spoken line counts as the suggestion when it shares at least half of its content words.
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
  const [activeHint, setActiveHint] = useState<string | null>(null)
  // The three best sentences to say next (model-phrased), and which of them the advisor already said.
  const [ideas, setIdeas] = useState<Hint[]>([])
  const [said, setSaid] = useState<string[]>([])
  const [thinking, setThinking] = useState(false)
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [quick, setQuick] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || (e.target instanceof HTMLElement && e.target.closest('input, textarea'))) return
      e.preventDefault(); setQuick(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
  // Results that come back after the advisor switched clients are dropped.
  const current = useRef(client.ref)
  current.current = client.ref
  const hear = (segments: Segment[]) => {
    const at = client.ref
    queue.current = queue.current.then(async () => {
      const thought = await think(client, linesRef.current, segments, settings, status)
      if (current.current !== at) return
      linesRef.current = [...linesRef.current, ...thought.lines]
      setLines(linesRef.current)
      // Zwei getrennte Spuren: Aussagen des Kunden führen zu einer Antwort, Aussagen des Beraters zum nächsten Schritt.
      if (thought.customer) setCustomerSlot(thought.customer)
      if (thought.advisor) setAdvisorSlot(thought.advisor)
      if (thought.hints.length) addHints(thought.hints)
      const insight = thought.insight
      if (insight) setChat((c) => (c.some((e) => e.role === 'ki' && e.text === (insight as { text: string }).text) ? c : [...c, insight]))
      const spoken = thought.lines.filter((l) => l.speaker === 'Berater').map((l) => ideasRef.current.find((i) => sameSentence(i.text, l.text))).find(Boolean)
      if (spoken) use(spoken)
      else if (thought.lines.some((l) => l.speaker === 'Kunde')) refresh()
    })
  }
  const ideasRef = useRef<Hint[]>([])
  ideasRef.current = ideas
  const asked = useRef(0)
  // Next three suggestions from the conversation so far; at most every few seconds, newest wins.
  const refresh = () => {
    const n = ++asked.current
    const at = client.ref
    setThinking(true)
    suggest(client, linesRef.current, settings, status).then((next) => { if (n === asked.current && at === current.current) { setIdeas(next); setThinking(false) } })
  }
  // The advisor said (or picked) one: its tile comes forward, it is marked as said, the next three follow.
  const use = (idea: Hint) => {
    setSaid((s) => (s.includes(idea.id) ? s : [...s, idea.id]))
    addHints([{ ...idea, id: `${idea.id}-said`, origin: 'gespraech', trigger: 'Von Ihnen gesagt' }])
    refresh()
  }
  const hearRef = useRef(hear)
  hearRef.current = hear

  useEffect(() => { fetchStatus().then(setStatus) }, [])
  // Once the model is reachable, the openers are rephrased by it.
  useEffect(() => { if (status.openai || status.apertus) refresh() }, [status.openai, status.apertus]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    linesRef.current = []; queue.current = Promise.resolve()
    setLines([]); setChat([]); setHints(openingHints(client)); setActiveHint(null); setSaid([]); setIdeas(openingHints(client).slice(0, 3)); refresh(); setMic(false); setNote(null); setCustomerSlot(null); setAdvisorSlot(null)
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

        <div className="flex min-w-0 flex-1 gap-2.5">
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-card">
          <div className="flex shrink-0 items-center gap-2 px-6 pt-4">
            <div className="min-w-0">
              <div className="truncate text-[17px]">{client.name}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${inCall ? 'animate-pulse bg-risk' : 'bg-track'}`} />
                {inCall ? 'Gespräch läuft' : 'Vorbereitung'}
              </div>
            </div>
            <div className="ml-auto flex shrink-0 gap-1.5">
              {inCall && settings.record && canListen(status.elevenlabs) && <button onClick={() => setMic((m) => !m)} aria-label="Mikrofon" title="Mikrofon" className={`flex h-8 w-8 items-center justify-center rounded-full ${mic ? 'bg-risk text-white' : 'bg-pill hover:bg-track'}`}>{mic ? <Mic size={14} /> : <MicOff size={14} />}</button>}
              <button onClick={() => setInCall((v) => !v)} className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs text-white transition-colors ${inCall ? 'bg-risk' : 'bg-brand hover:bg-brand-dark'}`}>{inCall ? <><PhoneOff size={13} /> Beenden</> : <><Phone size={13} /> Anrufen</>}</button>
            </div>
          </div>

          <Stage client={client} hints={hints} ideas={ideas} said={said} thinking={thinking} onUse={use} inCall={inCall} recording={settings.record}
            lines={lines} note={note} customer={customerSlot} advisor={advisorSlot} onEnd={() => setInCall(false)} />
        </section>

        </div>
      </div>

      <QuickAsk open={quick} onOpen={() => setQuick(true)} onClose={() => setQuick(false)} name={client.name} chat={chat} busy={busy} detail={settings.detail}
        suggestions={open.map((t) => t.label)} onAsk={ask}
        onShow={(id) => setChat((c) => c.map((e) => (e.id === id && e.role === 'ki' && e.offered ? { ...e, module: e.offered.spec, offered: undefined } : e)))} />
      <SettingsPanel open={settingsOpen} settings={settings} status={status} update={update} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
