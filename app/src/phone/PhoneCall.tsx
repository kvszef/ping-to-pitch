import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, UserRound } from 'lucide-react'
import { ICE, gathered, listenCall, sendCall, type CallMessage } from './protocol.ts'

// The client's side of the internet call: pick a client, call the advisor's desk, talk over WebRTC.

type Phase = 'idle' | 'ringing' | 'connected' | 'ended'
type ClientOption = { ref: string; label: string }

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
  start: () => void
  stop: () => void
}

const w = window as unknown as Record<string, unknown>
const BrowserRecognition = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | undefined

const DEFAULT_REF = 'CASE-038'

function labelOf(c: Record<string, unknown>): ClientOption | null {
  const ref = typeof c.ClientRef === 'string' ? c.ClientRef : null
  if (!ref) return null
  const name = c.IsClientACompany && typeof c.Company === 'string' && c.Company
    ? c.Company
    : [c.FirstName, c.LastName].filter((x) => typeof x === 'string' && x.trim()).join(' ')
  return { ref, label: name ? `${name} · ${ref}` : ref }
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

function hangupBeacon() {
  const body = JSON.stringify({ to: 'desk', msg: { type: 'hangup' } satisfies CallMessage })
  try {
    if (!navigator.sendBeacon?.('/api/call/send', new Blob([body], { type: 'application/json' }))) void sendCall('desk', { type: 'hangup' })
  } catch { void sendCall('desk', { type: 'hangup' }).catch(() => {}) }
}

export default function PhoneCall() {
  const [clients, setClients] = useState<ClientOption[]>([])
  const [ref, setRef] = useState<string>(() => new URLSearchParams(location.search).get('ref') ?? '')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [transcribe, setTranscribe] = useState<boolean | null>(null)
  const [captionsOn, setCaptionsOn] = useState(false)

  const phaseRef = useRef<Phase>('idle')
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const backTimer = useRef<number | null>(null)

  const go = (p: Phase) => { phaseRef.current = p; setPhase(p) }

  // Load clients and server capabilities once.
  useEffect(() => {
    fetch('/api/clients').then((r) => r.json()).then((data: unknown) => {
      const list = (Array.isArray(data) ? data : []).map((c) => labelOf(c as Record<string, unknown>)).filter((x): x is ClientOption => !!x)
      setClients(list)
      setRef((cur) => (cur && list.some((c) => c.ref === cur)) ? cur : (list.find((c) => c.ref === DEFAULT_REF)?.ref ?? list[0]?.ref ?? cur))
    }).catch(() => setError('Kundenliste konnte nicht geladen werden.'))
    fetch('/api/status').then((r) => r.json()).then((s: { transcribe?: boolean }) => setTranscribe(s.transcribe !== false)).catch(() => setTranscribe(null))
  }, [])

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    if (audioRef.current) audioRef.current.srcObject = null
    setMuted(false)
    setStartedAt(null)
  }, [])

  const finish = useCallback((notifyDesk: boolean) => {
    if (phaseRef.current === 'idle' || phaseRef.current === 'ended') return
    if (notifyDesk) void sendCall('desk', { type: 'hangup' }).catch(() => {})
    cleanup()
    go('ended')
    if (backTimer.current) clearTimeout(backTimer.current)
    backTimer.current = window.setTimeout(() => { if (phaseRef.current === 'ended') go('idle') }, 2000)
  }, [cleanup])

  // Messages from the desk.
  useEffect(() => listenCall('phone', (msg) => {
    if (msg.type === 'answer') {
      const pc = pcRef.current
      if (!pc || phaseRef.current !== 'ringing') return
      pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).then(() => {
        setStartedAt(Date.now())
        go('connected')
      }).catch(() => { setError('Verbindung konnte nicht aufgebaut werden.'); finish(true) })
    } else if (msg.type === 'decline' || msg.type === 'hangup') {
      finish(false)
    }
  }), [finish])

  // Tell the desk when the page goes away mid-call.
  useEffect(() => {
    const onHide = () => {
      if (phaseRef.current === 'ringing' || phaseRef.current === 'connected') { hangupBeacon(); cleanup(); phaseRef.current = 'idle' }
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [cleanup])

  // Call timer.
  useEffect(() => {
    if (phase !== 'connected') return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [phase])

  // Keeps the screen on during the call: phones cut the mic of a browser page once the screen locks.
  // The lock drops whenever the page is hidden, so it is taken again when the page comes back.
  useEffect(() => {
    if (phase !== 'ringing' && phase !== 'connected') return
    type Lock = { release: () => Promise<void> }
    const wake = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<Lock> } }).wakeLock
    if (!wake) return
    let lock: Lock | null = null
    let active = true
    const take = () => { if (active && document.visibilityState === 'visible') wake.request('screen').then((l) => { if (active) lock = l; else void l.release() }).catch(() => {}) }
    take()
    document.addEventListener('visibilitychange', take)
    return () => { active = false; document.removeEventListener('visibilitychange', take); void lock?.release().catch(() => {}) }
  }, [phase])

  // The phone transcribes its own voice: 7 s chunks go through the tunnel to /api/transcribe and the
  // text reaches the desk as a caption. This works even when the network blocks the direct audio link.
  useEffect(() => {
    if (phase !== 'connected' || transcribe !== true || !streamRef.current || typeof MediaRecorder === 'undefined') return
    const stream = streamRef.current
    let stopped = false
    let timer = 0
    let recorder: MediaRecorder | null = null
    const record = () => {
      if (stopped) return
      const current = new MediaRecorder(stream)
      recorder = current
      const parts: Blob[] = []
      current.ondataavailable = (e) => { if (e.data.size) parts.push(e.data) }
      current.onstop = async () => {
        record()
        const blob = new Blob(parts, { type: current.mimeType })
        if (blob.size < 4000) return
        try {
          const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob })
          const data = (await r.json()) as { segments?: { text: string }[] }
          const text = (data.segments ?? []).map((s) => s.text.trim()).filter(Boolean).join(' ')
          if (text) void sendCall('desk', { type: 'caption', speaker: 'Kunde', text }).catch(() => {})
        } catch { /* a lost chunk is fine, the next one follows */ }
      }
      try { current.start() } catch { return }
      timer = window.setTimeout(() => current.state === 'recording' && current.stop(), 7000)
    }
    record()
    return () => { stopped = true; clearTimeout(timer); if (recorder?.state === 'recording') recorder.stop() }
  }, [phase, transcribe])

  // Fallback captions from the phone's own speech recognition when the server cannot transcribe.
  useEffect(() => {
    if (phase !== 'connected' || transcribe !== false || !BrowserRecognition) return
    let active = true
    let rec: Recognition | null = null
    try {
      rec = new BrowserRecognition()
      rec.lang = 'de-CH'
      rec.continuous = true
      rec.interimResults = false
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          const text = r.isFinal ? r[0]?.transcript.trim() : ''
          if (text) void sendCall('desk', { type: 'caption', speaker: 'Kunde', text }).catch(() => {})
        }
      }
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') { active = false; setCaptionsOn(false) }
      }
      rec.onend = () => {
        if (!active || phaseRef.current !== 'connected') return
        try { rec?.start() } catch { active = false; setCaptionsOn(false) }
      }
      rec.onstart = () => { if (active) setCaptionsOn(true) }
      rec.start()
    } catch {
      active = false
    }
    return () => {
      active = false
      setCaptionsOn(false)
      try { rec?.stop() } catch { /* already stopped */ }
    }
  }, [phase, transcribe])

  const call = async () => {
    setError(null)
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Bitte über die https-Adresse öffnen.')
      return
    }
    if (!ref) { setError('Bitte zuerst einen Kunden wählen.'); return }
    go('ringing')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (phaseRef.current !== 'ringing') { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current = stream
      const pc = new RTCPeerConnection(ICE)
      pcRef.current = pc
      stream.getTracks().forEach((t) => pc.addTrack(t, stream))
      pc.ontrack = (e) => {
        const el = audioRef.current
        if (!el) return
        el.srcObject = e.streams[0] ?? new MediaStream([e.track])
        void el.play().catch(() => {})
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') { setError('Die Verbindung ist abgebrochen.'); finish(true) }
      }
      await pc.setLocalDescription(await pc.createOffer())
      await gathered(pc)
      if (phaseRef.current !== 'ringing' || !pc.localDescription) return
      await sendCall('desk', { type: 'ring', ref, sdp: pc.localDescription.sdp })
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      setError(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Kein Zugriff auf das Mikrofon. Bitte in den Browser-Einstellungen erlauben und erneut versuchen.'
        : name === 'NotFoundError'
          ? 'Kein Mikrofon gefunden.'
          : 'Der Anruf konnte nicht gestartet werden.')
      cleanup()
      go('idle')
    }
  }

  const toggleMute = () => {
    const next = !muted
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next })
    setMuted(next)
  }

  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  const clientLabel = clients.find((c) => c.ref === ref)?.label ?? ref
  const insecure = typeof window !== 'undefined' && !window.isSecureContext

  return (
    <div className="flex min-h-dvh flex-col items-center justify-between bg-[#0b0f14] px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))] text-white">
      <audio ref={audioRef} autoPlay playsInline />

      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className={`mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-white/10 ${phase === 'ringing' ? 'animate-pulse' : ''}`}>
          <UserRound className="h-14 w-14 text-white/80" strokeWidth={1.5} />
        </div>
        <h1 className="text-2xl font-semibold">Ihr Kundenberater</h1>
        <p className="mt-2 text-base text-white/60">
          {phase === 'idle' && 'Bereit zum Anrufen'}
          {phase === 'ringing' && 'Klingelt …'}
          {phase === 'connected' && <>Verbunden · <span className="tabular-nums">{mmss(elapsed)}</span></>}
          {phase === 'ended' && 'Anruf beendet'}
        </p>
        {phase !== 'idle' && clientLabel && <p className="mt-1 text-sm text-white/40">Als {clientLabel}</p>}
        {phase === 'connected' && <p className="mt-3 text-xs text-white/50">Bildschirm bleibt an. Diese Seite während des Gesprächs offen lassen.</p>}
        {phase === 'connected' && captionsOn &&<p className="mt-3 text-xs text-emerald-300/80">Live-Untertitel vom Telefon</p>}
      </div>

      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        {(error || insecure) && (
          <p role="alert" className="w-full rounded-xl bg-red-500/15 px-4 py-3 text-center text-sm text-red-200">
            {error ?? 'Bitte über die https-Adresse öffnen.'}
          </p>
        )}

        {phase === 'idle' && (
          <>
            <label className="w-full text-left text-sm text-white/60">
              Anrufen als
              <select
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base text-white"
              >
                {clients.length === 0 && <option value={ref}>{ref || 'Kunden werden geladen …'}</option>}
                {clients.map((c) => <option key={c.ref} value={c.ref} className="text-black">{c.label}</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void call()}
              disabled={!ref}
              aria-label="Anrufen"
              className="flex flex-col items-center gap-2 disabled:opacity-40"
            >
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/30 active:scale-95">
                <Phone className="h-9 w-9" />
              </span>
              <span className="text-sm text-white/80">Anrufen</span>
            </button>
          </>
        )}

        {(phase === 'ringing' || phase === 'connected') && (
          <div className="flex items-end justify-center gap-12">
            {phase === 'connected' && (
              <button type="button" onClick={toggleMute} aria-label={muted ? 'Stummschaltung aufheben' : 'Stummschalten'} className="flex flex-col items-center gap-2">
                <span className={`flex h-16 w-16 items-center justify-center rounded-full ${muted ? 'bg-white text-black' : 'bg-white/15'} active:scale-95`}>
                  {muted ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
                </span>
                <span className="text-sm text-white/80">{muted ? 'Stumm' : 'Mikrofon'}</span>
              </button>
            )}
            <button type="button" onClick={() => finish(true)} aria-label="Auflegen" className="flex flex-col items-center gap-2">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/30 active:scale-95">
                <PhoneOff className="h-9 w-9" />
              </span>
              <span className="text-sm text-white/80">Auflegen</span>
            </button>
          </div>
        )}

        {phase === 'ended' && <div className="h-20" />}
      </div>
    </div>
  )
}
