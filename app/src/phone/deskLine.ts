import { useSyncExternalStore } from 'react'
import { gathered, iceConfig, listenCall, sendCall, type CallMessage } from './protocol'
import { startRingback, startRingtone, unlockTones } from './tones'

// The advisor's end of the internet call: one live call at a time, kept outside React so the
// ringing banner (App) and the workspace share it. Audio flows browser to browser over WebRTC.

export type Line =
  | { state: 'idle' }
  | { state: 'ringing'; ref: string; offer: string }
  | { state: 'dialling'; ref: string }                     // the advisor calls; the phone answers with its own 'ring'
  | { state: 'connected'; ref: string; remote: MediaStream; local: MediaStream }

let line: Line = { state: 'idle' }
let pc: RTCPeerConnection | null = null
let player: HTMLAudioElement | null = null
let listening = false
// Chrome starts an AudioContext muted unless it is created inside a click, so the accept click
// creates it and the recorder (usePhoneAudio) reuses it.
let audio: AudioContext | null = null
export const audioContext = () => audio
const subscribers = new Set<() => void>()
const captionSubscribers = new Set<(text: string) => void>()

// Debug trail of the desk side: browser console and the dev server log.
const dlog = (text: string) => { console.info('[call]', text); void fetch('/api/call/log', { method: 'POST', body: `desk: ${text}` }).catch(() => {}) }

// Outbound call: gives up after DIAL_MS. `connecting` is set while a call is being picked up.
const DIAL_MS = 30_000
let dialTimer: ReturnType<typeof setTimeout> | undefined
let connecting = false
// Ringtone while a call comes in, ringback while our own call rings at the client's end.
let stopTone: (() => void) | null = null
let toneFor: Line['state'] = 'idle'

function set(next: Line) {
  line = next
  if (next.state !== 'dialling') clearTimeout(dialTimer)
  if (next.state !== toneFor) {
    stopTone?.()
    stopTone = next.state === 'ringing' ? startRingtone() : next.state === 'dialling' ? startRingback() : null
    toneFor = next.state
  }
  subscribers.forEach((f) => f())
}

function teardown() {
  if (line.state === 'connected') { line.local.getTracks().forEach((t) => t.stop()) }
  pc?.close(); pc = null
  if (player) { player.srcObject = null; player.remove(); player = null }
  set({ state: 'idle' })
}

function onMessage(msg: CallMessage) {
  if (msg.type === 'ring') {
    if (line.state === 'connected' || connecting) return // one call at a time
    // The phone answers our own dial: pick up straight away, no banner and no ringtone.
    if (line.state === 'dialling' && line.ref === msg.ref) { clearTimeout(dialTimer); dlog('dial answered, connecting'); void connect(msg.ref, msg.sdp); return }
    set({ state: 'ringing', ref: msg.ref, offer: msg.sdp })
  } else if (msg.type === 'decline') {
    if (line.state === 'dialling') { dlog('dial declined'); set({ state: 'idle' }) }
  } else if (msg.type === 'hangup') {
    if (line.state !== 'idle') teardown()
  } else if (msg.type === 'caption') {
    if (line.state === 'connected' && msg.text.trim()) captionSubscribers.forEach((f) => f(msg.text.trim()))
  }
}

// Starts listening for calls from the phone; safe to call more than once.
export function startListening() {
  if (listening || typeof EventSource === 'undefined') return
  listening = true
  listenCall('desk', onMessage)
}

export async function accept(): Promise<boolean> {
  if (line.state !== 'ringing') return false
  return connect(line.ref, line.offer)
}

// The advisor calls the client: the phone page rings and, once the client picks up, sends its usual
// 'ring' with the WebRTC offer, which is accepted automatically (see onMessage). Runs in a click.
export function dial(ref: string) {
  if (line.state === 'ringing' && line.ref === ref) { void accept(); return } // the client is calling right now
  if (line.state !== 'idle') return
  try {
    if (!audio || audio.state === 'closed') audio = new AudioContext()
    void audio.resume()
  } catch { /* no Web Audio: the call still works through the audio element */ }
  unlockTones()
  set({ state: 'dialling', ref })
  dlog(`dial ${ref}`)
  // No phone page open: give up at once, so the laptop microphone takes over as before.
  void sendCall('phone', { type: 'dial', ref }).then((res) => res.json()).then((d: { phoneOnline?: boolean }) => {
    if (d.phoneOnline === false && line.state === 'dialling' && !connecting) { dlog('no phone page open, not dialling'); if (dialTimer) clearTimeout(dialTimer); set({ state: 'idle' }) }
  }).catch(() => {})
  dialTimer = setTimeout(() => {
    if (line.state !== 'dialling' || connecting) return
    dlog('dial timed out')
    void sendCall('phone', { type: 'hangup' }).catch(() => {})
    set({ state: 'idle' })
  }, DIAL_MS)
}

// Picks up: answers the phone's offer and plays the client's voice. Used by the accept click and by
// a ring that answers our own dial.
async function connect(ref: string, offer: string): Promise<boolean> {
  if (connecting) return false
  connecting = true
  const from = line
  if (!audio || audio.state === 'closed') audio = new AudioContext()
  void audio.resume()
  try {
    const local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    // Hung up or declined while the microphone prompt was open.
    if (line !== from) { local.getTracks().forEach((t) => t.stop()); return false }
    const conn = new RTCPeerConnection(await iceConfig())
    pc = conn
    const remote = new MediaStream()
    conn.ontrack = (e) => {
      dlog(`track ${e.track.kind} muted=${e.track.muted}`)
      e.track.onunmute = () => dlog('track unmuted (audio arriving)')
      if (!remote.getTracks().includes(e.track)) remote.addTrack(e.track)
    }
    conn.onconnectionstatechange = () => dlog(`connection ${conn.connectionState}`)
    local.getTracks().forEach((t) => conn.addTrack(t, local))
    await conn.setRemoteDescription({ type: 'offer', sdp: offer })
    await conn.setLocalDescription(await conn.createAnswer())
    await gathered(conn)
    // Hung up while the connection was prepared (teardown already closed it).
    if (line !== from) { local.getTracks().forEach((t) => t.stop()); return false }
    await sendCall('phone', { type: 'answer', sdp: conn.localDescription?.sdp ?? '' })
    // The advisor hears the client through a hidden audio element.
    player = document.createElement('audio')
    player.autoplay = true
    player.style.display = 'none'
    player.srcObject = remote
    document.body.appendChild(player)
    const el = player
    // A monitor without speakers is often the Windows default output (display audio over HDMI/DP):
    // then the client's voice goes to the laptop speakers or headphones instead.
    try {
      const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput')
      const std = outs.find((d) => d.deviceId === 'default')
      const real = outs.find((d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && /lautsprecher|speaker|kopfh|headphone|headset/i.test(d.label))
      if (std && real && /display audio|hdmi|displayport/i.test(std.label) && 'setSinkId' in el) {
        await (el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(real.deviceId)
        dlog(`output moved from "${std.label}" to "${real.label}"`)
      }
    } catch (e) { dlog(`output check failed ${e}`) }
    el.play().then(() => {
      dlog('player playing')
      setTimeout(() => { if (player === el) dlog(`player after 3s: time=${el.currentTime.toFixed(1)} paused=${el.paused} volume=${el.volume} muted=${el.muted}`) }, 3000)
    }).catch((e) => {
      // Autoplay refused: play through the AudioContext from the accept click instead. Chrome only
      // feeds a remote stream into Web Audio while it is attached to a media element, so it stays, muted.
      dlog(`player refused (${e}), using the audio context`)
      el.muted = true
      void el.play().catch(() => {})
      if (audio) audio.createMediaStreamSource(remote).connect(audio.destination)
    })
    set({ state: 'connected', ref, remote, local })
    return true
  } catch {
    if (line !== from) return false // already hung up; a newer call must not be torn down
    void sendCall('phone', { type: 'decline' })
    teardown()
    return false
  } finally {
    connecting = false
  }
}

export function decline() {
  if (line.state !== 'ringing') return
  void sendCall('phone', { type: 'decline' })
  set({ state: 'idle' })
}

// Mutes the advisor's microphone for the client and for the transcript.
export function setMuted(muted: boolean) {
  if (line.state === 'connected') line.local.getAudioTracks().forEach((t) => { t.enabled = !muted })
}

export function hangup() {
  if (line.state === 'idle') return
  void sendCall('phone', { type: 'hangup' })
  teardown()
}

export function onCaption(cb: (text: string) => void): () => void {
  captionSubscribers.add(cb)
  return () => { captionSubscribers.delete(cb) }
}

const subscribe = (f: () => void) => { subscribers.add(f); return () => { subscribers.delete(f) } }
export const getLine = () => line
export function useDeskLine(): Line { return useSyncExternalStore(subscribe, getLine, getLine) }
