// Messages between the client's phone (call.html) and the advisor's desk (the app), relayed by
// server/call.ts. Audio does not go through here: it flows directly between the browsers (WebRTC).
// Offers and answers carry the full SDP with all ICE candidates (no trickle), so one message each.

export type CallMessage =
  | { type: 'ring'; ref: string; sdp: string }            // phone -> desk: client calls, WebRTC offer
  | { type: 'answer'; sdp: string }                        // desk -> phone: advisor picked up
  | { type: 'decline' }                                    // desk -> phone
  | { type: 'hangup' }                                     // either way
  | { type: 'caption'; speaker: 'Kunde'; text: string }    // phone -> desk: fallback when the server has no transcription key

export type Role = 'desk' | 'phone'

export function sendCall(to: Role, msg: CallMessage) {
  return fetch('/api/call/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, msg }) })
}

export function listenCall(role: Role, on: (msg: CallMessage) => void): () => void {
  // The phone polls: it reaches the server through a tunnel that buffers event streams.
  if (role === 'phone') {
    let stopped = false
    const poll = async () => {
      while (!stopped) {
        try {
          const r = await fetch('/api/call/poll', { cache: 'no-store' })
          const list = (await r.json()) as CallMessage[]
          if (!stopped) list.forEach(on)
        } catch { /* network hiccup: try again */ }
        await new Promise((res) => setTimeout(res, 700))
      }
    }
    void poll()
    return () => { stopped = true }
  }
  const es = new EventSource(`/api/call/events?role=${role}`)
  es.onmessage = (e) => { try { on(JSON.parse(e.data) as CallMessage) } catch { /* ignore malformed */ } }
  return () => es.close()
}

export const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }

// Waits until all ICE candidates are in the local description (at most `ms`), so the SDP is complete.
export function gathered(pc: RTCPeerConnection, ms = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve() }
    const check = () => { if (pc.iceGatheringState === 'complete') done() }
    pc.addEventListener('icegatheringstatechange', check)
    setTimeout(done, ms)
  })
}
