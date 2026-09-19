import { useSyncExternalStore } from 'react'
import { gathered, ICE, listenCall, sendCall, type CallMessage } from './protocol'

// The advisor's end of the internet call: one live call at a time, kept outside React so the
// ringing banner (App) and the workspace share it. Audio flows browser to browser over WebRTC.

export type Line =
  | { state: 'idle' }
  | { state: 'ringing'; ref: string; offer: string }
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

function set(next: Line) { line = next; subscribers.forEach((f) => f()) }

function teardown() {
  if (line.state === 'connected') { line.local.getTracks().forEach((t) => t.stop()) }
  pc?.close(); pc = null
  if (player) { player.srcObject = null; player.remove(); player = null }
  set({ state: 'idle' })
}

function onMessage(msg: CallMessage) {
  if (msg.type === 'ring') {
    if (line.state === 'connected') return // one call at a time
    set({ state: 'ringing', ref: msg.ref, offer: msg.sdp })
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
  const { ref, offer } = line
  if (!audio || audio.state === 'closed') audio = new AudioContext()
  void audio.resume()
  try {
    const local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    const conn = new RTCPeerConnection(ICE)
    pc = conn
    const remote = new MediaStream()
    conn.ontrack = (e) => { if (!remote.getTracks().includes(e.track)) remote.addTrack(e.track) }
    local.getTracks().forEach((t) => conn.addTrack(t, local))
    await conn.setRemoteDescription({ type: 'offer', sdp: offer })
    await conn.setLocalDescription(await conn.createAnswer())
    await gathered(conn)
    await sendCall('phone', { type: 'answer', sdp: conn.localDescription?.sdp ?? '' })
    // The advisor hears the client through a hidden audio element.
    player = document.createElement('audio')
    player.autoplay = true
    player.style.display = 'none'
    player.srcObject = remote
    document.body.appendChild(player)
    void player.play().catch(() => { /* autoplay blocked: the click on accept normally allows it */ })
    set({ state: 'connected', ref, remote, local })
    return true
  } catch {
    void sendCall('phone', { type: 'decline' })
    teardown()
    return false
  }
}

export function decline() {
  if (line.state !== 'ringing') return
  void sendCall('phone', { type: 'decline' })
  set({ state: 'idle' })
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
