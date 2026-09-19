// Call tones made with Web Audio, no audio files. Both start functions return a stop function and
// never throw. Without a user gesture the browser keeps the AudioContext suspended: then the tone
// stays silent and starts as soon as the context runs (resume is tried again while it waits).

let shared: AudioContext | null = null

function context(): AudioContext | null {
  try {
    if (!shared || shared.state === 'closed') {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      shared = new Ctor()
    }
    if (shared.state === 'suspended') void shared.resume().catch(() => {})
    return shared
  } catch { return null }
}

// Call inside a click or tap: creates and resumes the context while the browser allows it, so a tone
// that starts a moment later (after a render) is audible.
export function unlockTones() { context() }

type Beep = { at: number; ms: number; hz: number[] }

// Plays `beeps` (offsets in ms from the start of a cycle) every `cycleMs` until stopped.
function loop(beeps: Beep[], cycleMs: number, volume: number): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let live: { osc: OscillatorNode[]; gain: GainNode }[] = []
  const cycle = () => {
    if (stopped) return
    let wait = cycleMs
    try {
      const ctx = context()
      if (!ctx) return // no Web Audio at all: silent
      if (ctx.state !== 'running') {
        // Scheduling now would pile the beeps up and play them at once after resume: look again shortly.
        wait = 500
      } else {
        live = []
        for (const b of beeps) {
          const t0 = ctx.currentTime + 0.03 + b.at / 1000
          const t1 = t0 + b.ms / 1000
          const gain = ctx.createGain()
          // Short fades, so the beep does not click.
          gain.gain.setValueAtTime(0, t0)
          gain.gain.linearRampToValueAtTime(volume, t0 + 0.02)
          gain.gain.setValueAtTime(volume, t1 - 0.03)
          gain.gain.linearRampToValueAtTime(0, t1)
          gain.connect(ctx.destination)
          const osc = b.hz.map((hz) => {
            const o = ctx.createOscillator()
            o.type = 'sine'
            o.frequency.value = hz
            o.connect(gain)
            o.start(t0)
            o.stop(t1 + 0.01)
            return o
          })
          live.push({ osc, gain })
        }
      }
    } catch { /* no sound is fine, the call itself goes on */ }
    timer = setTimeout(cycle, wait)
  }
  cycle()
  return () => {
    if (stopped) return
    stopped = true
    clearTimeout(timer)
    for (const n of live) {
      try { n.gain.disconnect() } catch { /* already gone */ }
      for (const o of n.osc) { try { o.stop() } catch { /* already stopped */ } }
    }
    live = []
  }
}

// Incoming call: two short bursts of a soft two-tone chord, then a pause (the classic double ring).
// Both tones share one gain node and add up, so the gain is halved (peak about 0.14).
export function startRingtone(): () => void {
  const chord = [440, 554.37]
  return loop([{ at: 0, ms: 400, hz: chord }, { at: 600, ms: 400, hz: chord }], 3000, 0.07)
}

// What the caller hears while it rings at the other end: 425 Hz, 1 s on, 4 s off, quiet.
export function startRingback(): () => void {
  return loop([{ at: 0, ms: 1000, hz: [425] }], 5000, 0.08)
}
