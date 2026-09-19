import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, UserRound } from 'lucide-react'
import { ICE, gathered, listenCall, sendCall, type CallMessage } from './protocol.ts'
import { startRingback, startRingtone, unlockTones } from './tones.ts'
import { inOrder, recordUtterances } from './utterances.ts'

// The client's side of the internet call: pick a client, call the advisor's desk, talk over WebRTC.
// The advisor can also call: a 'dial' makes this page ring ('incoming'); picking up runs the same
// path as calling (the phone always creates the WebRTC offer).

type Phase = 'idle' | 'incoming' | 'ringing' | 'connected' | 'ended'
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

// This page has no settings: it speaks the call's language, which the server fixes for the
// transcription (`callLanguage` in /api/status). English until the status has answered.
type Language = 'de' | 'en'
const TEXT = {
  de: {
    pageTitle: 'Anruf · Kundenberater', advisor: 'Ihr Kundenberater', advisorCalls: 'Ihr Kundenberater ruft an',
    ready: 'Bereit zum Anrufen', incoming: 'Eingehender Anruf …', ringing: 'Klingelt …', connected: 'Verbunden', ended: 'Anruf beendet',
    as: 'Als', keepOpen: 'Seite offen lassen, um Anrufe zu erhalten', screenOn: 'Bildschirm bleibt an. Diese Seite während des Gesprächs offen lassen.',
    captions: 'Live-Untertitel vom Telefon', callAs: 'Anrufen als', loadingClients: 'Kunden werden geladen …', call: 'Anrufen',
    decline: 'Ablehnen', accept: 'Annehmen', unmute: 'Stummschaltung aufheben', mute: 'Stummschalten', muted: 'Stumm', microphone: 'Mikrofon', hangUp: 'Auflegen',
    errClients: 'Kundenliste konnte nicht geladen werden.', errConnect: 'Verbindung konnte nicht aufgebaut werden.', errHttps: 'Bitte über die https-Adresse öffnen.',
    errPick: 'Bitte zuerst einen Kunden wählen.', errAudio: 'Keine direkte Tonverbindung (Netzwerk blockiert). Das Transkript läuft weiter.',
    errMicDenied: 'Kein Zugriff auf das Mikrofon. Bitte in den Browser-Einstellungen erlauben und erneut versuchen.', errMicMissing: 'Kein Mikrofon gefunden.',
    errCall: 'Der Anruf konnte nicht gestartet werden.',
  },
  en: {
    pageTitle: 'Call · Client advisor', advisor: 'Your client advisor', advisorCalls: 'Your client advisor is calling',
    ready: 'Ready to call', incoming: 'Incoming call …', ringing: 'Ringing …', connected: 'Connected', ended: 'Call ended',
    as: 'As', keepOpen: 'Keep this page open to receive calls', screenOn: 'The screen stays on. Keep this page open during the call.',
    captions: 'Live captions from the phone', callAs: 'Call as', loadingClients: 'Loading clients …', call: 'Call',
    decline: 'Decline', accept: 'Accept', unmute: 'Unmute', mute: 'Mute', muted: 'Muted', microphone: 'Microphone', hangUp: 'Hang up',
    errClients: 'The client list could not be loaded.', errConnect: 'The connection could not be established.', errHttps: 'Please open this page via its https address.',
    errPick: 'Please choose a client first.', errAudio: 'No direct audio link (blocked by the network). The transcript keeps running.',
    errMicDenied: 'No access to the microphone. Please allow it in the browser settings and try again.', errMicMissing: 'No microphone found.',
    errCall: 'The call could not be started.',
  },
} as const
// Errors are kept as keys, so a message follows the language even when it was set before the status answered.
type ErrorKey = Extract<keyof typeof TEXT.de, `err${string}`>

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
  const [incoming, setIncoming] = useState('') // the client the advisor is calling, while it rings here
  const [error, setError] = useState<ErrorKey | null>(null)
  const [language, setLanguage] = useState<Language>('en')
  const t = TEXT[language]
  const [muted, setMuted] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [transcribe, setTranscribe] = useState<boolean | null>(null)
  const [captionsOn, setCaptionsOn] = useState(false)
  // Debug trail: shown on the phone and printed in the dev server log (/api/call/log).
  const [logs, setLogs] = useState<string[]>([])
  const log = useCallback((text: string) => {
    const at = new Date().toTimeString().slice(0, 8)
    setLogs((l) => [...l.slice(-7), `${at} ${text}`])
    void fetch('/api/call/log', { method: 'POST', body: text }).catch(() => {})
  }, [])

  const phaseRef = useRef<Phase>('idle')
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const backTimer = useRef<number | null>(null)

  const go = (p: Phase) => { phaseRef.current = p; setPhase(p) }

  // Load clients and server capabilities. The client list is re-read while the phone is idle, so client
  // files uploaded at the desk during the demo show up here without reloading the page.
  useEffect(() => {
    const loadClients = (first: boolean) => fetch('/api/clients', { cache: 'no-store' }).then((r) => r.json()).then((data: unknown) => {
      const list = (Array.isArray(data) ? data : []).map((c) => labelOf(c as Record<string, unknown>)).filter((x): x is ClientOption => !!x)
      setClients((cur) => (cur.length === list.length && cur.every((c, i) => c.ref === list[i].ref) ? cur : list))
      setRef((cur) => (cur && list.some((c) => c.ref === cur)) ? cur : (list.find((c) => c.ref === DEFAULT_REF)?.ref ?? list[0]?.ref ?? cur))
    }).catch(() => { if (first) setError('errClients') })
    void loadClients(true)
    const again = window.setInterval(() => { if (phaseRef.current === 'idle') void loadClients(false) }, 8000)
    fetch('/api/status').then((r) => r.json()).then((s: { transcribe?: boolean; callLanguage?: string }) => { setTranscribe(s.transcribe !== false); setLanguage(s.callLanguage === 'de' ? 'de' : 'en'); log(`status transcribe=${s.transcribe}`) }).catch((e) => { setTranscribe(null); log(`status failed ${e}`) })
    return () => window.clearInterval(again)
  }, [])

  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en-GB' : 'de-CH'
    document.title = TEXT[language].pageTitle
  }, [language])

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
    log(`from desk: ${msg.type}`)
    if (msg.type === 'dial') {
      if (phaseRef.current !== 'idle' && phaseRef.current !== 'ended') return
      setError(null)
      setIncoming(msg.ref)
      go('incoming')
    } else if (phaseRef.current === 'incoming') {
      // The advisor gave up before the client picked up.
      if (msg.type === 'hangup' || msg.type === 'decline') go('idle')
    } else if (msg.type === 'answer') {
      const pc = pcRef.current
      if (!pc || phaseRef.current !== 'ringing') return
      pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).then(() => {
        setStartedAt(Date.now())
        go('connected')
      }).catch(() => { setError('errConnect'); finish(true) })
    } else if (msg.type === 'decline' || msg.type === 'hangup') {
      finish(false)
    }
  }), [finish, log])

  // Tell the desk when the page goes away mid-call.
  useEffect(() => {
    const onHide = () => {
      if (phaseRef.current === 'incoming' || phaseRef.current === 'ringing' || phaseRef.current === 'connected') { hangupBeacon(); cleanup(); phaseRef.current = 'idle' }
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [cleanup])

  // Tones: the ringtone and vibration while the advisor calls, the ringback while the desk rings.
  // An unanswered incoming call ends by itself, in case the desk's hangup never arrives.
  useEffect(() => {
    if (phase === 'ringing') return startRingback()
    if (phase !== 'incoming') return
    const stopTone = startRingtone()
    const buzz = () => { try { navigator.vibrate?.([700, 300, 700]) } catch { /* not supported */ } }
    buzz()
    const buzzing = window.setInterval(buzz, 3000)
    const giveUp = window.setTimeout(() => { if (phaseRef.current === 'incoming') go('idle') }, 35000)
    return () => {
      stopTone()
      clearInterval(buzzing)
      clearTimeout(giveUp)
      try { navigator.vibrate?.(0) } catch { /* not supported */ }
    }
  }, [phase])

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

  // The phone transcribes its own voice: utterances cut at speech pauses go through the tunnel to /api/transcribe and the
  // text reaches the desk as a caption. This works even when the network blocks the direct audio link.
  useEffect(() => {
    if (phase !== 'connected') return
    log(`recorder check: transcribe=${transcribe} stream=${!!streamRef.current} MediaRecorder=${typeof MediaRecorder !== 'undefined'}`)
    if (transcribe !== true || !streamRef.current || typeof MediaRecorder === 'undefined') return
    const send = inOrder((text) => {
      log(`transcribed: "${text.slice(0, 60)}"`)
      void sendCall('desk', { type: 'caption', speaker: 'Kunde', text }).catch(() => {})
    }, (e) => log(`transcribe failed ${e}`), language)
    return recordUtterances(streamRef.current, (audio) => { log(`utterance ${audio.size} bytes`); send(audio) }, { onLog: log })
  }, [phase, transcribe, log, language])

  // Fallback captions from the phone's own speech recognition when the server cannot transcribe.
  useEffect(() => {
    if (phase !== 'connected' || transcribe !== false || !BrowserRecognition) return
    let active = true
    let rec: Recognition | null = null
    try {
      rec = new BrowserRecognition()
      rec.lang = language === 'en' ? 'en-GB' : 'de-CH'
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
  }, [phase, transcribe, language])

  // Tells the desk that its call is not taken (the client declined or the call could not start).
  const refuse = () => {
    log('incoming declined')
    void sendCall('desk', { type: 'decline' }).catch(() => {})
    go('idle')
  }

  // `as` is set when the client picks up the advisor's call: the call runs as the dialled client.
  const call = async (as?: string) => {
    const who = as ?? ref
    setError(null)
    unlockTones()
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('errHttps')
      if (as) refuse()
      return
    }
    if (!who) { setError('errPick'); return }
    go('ringing')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (phaseRef.current !== 'ringing') { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current = stream
      log(`mic ok: ${stream.getAudioTracks().map((t) => `${t.label} enabled=${t.enabled} muted=${t.muted}`).join(', ')}`)
      const pc = new RTCPeerConnection(ICE)
      pcRef.current = pc
      stream.getTracks().forEach((t) => pc.addTrack(t, stream))
      pc.ontrack = (e) => {
        const el = audioRef.current
        if (!el) return
        el.srcObject = e.streams[0] ?? new MediaStream([e.track])
        void el.play().catch(() => {})
      }
      pc.oniceconnectionstatechange = () => log(`ice ${pc.iceConnectionState}`)
      pc.onconnectionstatechange = () => {
        log(`connection ${pc.connectionState}`)
        // The transcript travels through the server, so a blocked direct audio link does not end the call.
        if (pc.connectionState === 'failed') setError('errAudio')
      }
      await pc.setLocalDescription(await pc.createOffer())
      await gathered(pc)
      if (phaseRef.current !== 'ringing' || !pc.localDescription) return
      const res = await sendCall('desk', { type: 'ring', ref: who, sdp: pc.localDescription.sdp })
      log(`ring sent ${res.status}`)
    } catch (e) {
      log(`call failed ${e}`)
      const name = e instanceof DOMException ? e.name : ''
      setError(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'errMicDenied'
        : name === 'NotFoundError'
          ? 'errMicMissing'
          : 'errCall')
      cleanup()
      if (as) refuse()
      else go('idle')
    }
  }

  const pickUp = () => { log(`incoming accepted as ${incoming}`); setRef(incoming); void call(incoming) }

  const toggleMute = () => {
    const next = !muted
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next })
    setMuted(next)
  }

  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  const shownRef = phase === 'incoming' ? incoming : ref
  const clientLabel = clients.find((c) => c.ref === shownRef)?.label ?? shownRef
  const insecure = typeof window !== 'undefined' && !window.isSecureContext

  return (
    <div className="flex min-h-dvh flex-col items-center justify-between bg-[#0b0f14] px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))] text-white">
      <audio ref={audioRef} autoPlay playsInline />

      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className={`mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-white/10 ${phase === 'ringing' || phase === 'incoming' ? 'animate-pulse' : ''}`}>
          <UserRound className="h-14 w-14 text-white/80" strokeWidth={1.5} />
        </div>
        <h1 className="text-2xl font-semibold">{phase === 'incoming' ? t.advisorCalls : t.advisor}</h1>
        <p className="mt-2 text-base text-white/60">
          {phase === 'idle' && t.ready}
          {phase === 'incoming' && t.incoming}
          {phase === 'ringing' && t.ringing}
          {phase === 'connected' && <>{t.connected} · <span className="tabular-nums">{mmss(elapsed)}</span></>}
          {phase === 'ended' && t.ended}
        </p>
        {phase !== 'idle' && clientLabel && <p className="mt-1 text-sm text-white/40">{t.as} {clientLabel}</p>}
        {phase === 'idle' && <p className="mt-3 text-xs text-white/40">{t.keepOpen}</p>}
        {phase === 'connected' && <p className="mt-3 text-xs text-white/50">{t.screenOn}</p>}
        {phase === 'connected' && captionsOn &&<p className="mt-3 text-xs text-emerald-300/80">{t.captions}</p>}
      </div>

      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        {(error || insecure) && (
          <p role="alert" className="w-full rounded-xl bg-red-500/15 px-4 py-3 text-center text-sm text-red-200">
            {t[error ?? 'errHttps']}
          </p>
        )}

        {logs.length > 0 && (
          <pre className="w-full whitespace-pre-wrap break-all rounded-lg bg-white/5 p-2 text-left font-mono text-[10px] leading-snug text-white/50">{logs.join(String.fromCharCode(10))}</pre>
        )}

        {phase === 'idle' && (
          <>
            <label className="w-full text-left text-sm text-white/60">
              {t.callAs}
              <select
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base text-white"
              >
                {clients.length === 0 && <option value={ref}>{ref || t.loadingClients}</option>}
                {clients.map((c) => <option key={c.ref} value={c.ref} className="text-black">{c.label}</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void call()}
              disabled={!ref}
              aria-label={t.call}
              className="flex flex-col items-center gap-2 disabled:opacity-40"
            >
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/30 active:scale-95">
                <Phone className="h-9 w-9" />
              </span>
              <span className="text-sm text-white/80">{t.call}</span>
            </button>
          </>
        )}

        {phase === 'incoming' && (
          <div className="flex items-end justify-center gap-16">
            <button type="button" onClick={refuse} aria-label={t.decline} className="flex flex-col items-center gap-2">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/30 active:scale-95">
                <PhoneOff className="h-9 w-9" />
              </span>
              <span className="text-sm text-white/80">{t.decline}</span>
            </button>
            <button type="button" onClick={pickUp} aria-label={t.accept} className="flex flex-col items-center gap-2">
              <span className="flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/30 active:scale-95">
                <Phone className="h-9 w-9" />
              </span>
              <span className="text-sm text-white/80">{t.accept}</span>
            </button>
          </div>
        )}

        {(phase === 'ringing' || phase === 'connected') && (
          <div className="flex items-end justify-center gap-12">
            {phase === 'connected' && (
              <button type="button" onClick={toggleMute} aria-label={muted ? t.unmute : t.mute} className="flex flex-col items-center gap-2">
                <span className={`flex h-16 w-16 items-center justify-center rounded-full ${muted ? 'bg-white text-black' : 'bg-white/15'} active:scale-95`}>
                  {muted ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
                </span>
                <span className="text-sm text-white/80">{muted ? t.muted : t.microphone}</span>
              </button>
            )}
            <button type="button" onClick={() => finish(true)} aria-label={t.hangUp} className="flex flex-col items-center gap-2">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/30 active:scale-95">
                <PhoneOff className="h-9 w-9" />
              </span>
              <span className="text-sm text-white/80">{t.hangUp}</span>
            </button>
          </div>
        )}

        {phase === 'ended' && <div className="h-20" />}
      </div>
    </div>
  )
}
