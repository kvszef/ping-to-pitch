// Cuts a microphone stream into utterances for transcription. A chunk ends at a pause in speech,
// never on a timer in the middle of a sentence, and silence is never sent (it only makes the model
// invent text). When Web Audio cannot run (no user gesture yet), it falls back to fixed chunks.

const TICK_MS = 50
const PAUSE_MS = 800        // this much silence after speech ends the utterance
const MIN_SPEECH_MS = 250   // less than this is a click or a cough, not speech
const MAX_MS = 20000        // a monologue is cut at the latest here
const IDLE_MS = 8000        // a chunk without speech is thrown away and a fresh one starts
const FALLBACK_MS = 6000    // fixed chunk length when the level cannot be measured

type Take = { rec: MediaRecorder; parts: Blob[]; keep: boolean }

export function recordUtterances(
  stream: MediaStream,
  onUtterance: (audio: Blob) => void,
  opts: { audio?: AudioContext | null; onLog?: (text: string) => void } = {},
): () => void {
  const log = opts.onLog ?? (() => {})
  let stopped = false
  let take: Take | null = null
  let startedAt = 0, lastVoice = 0, speechMs = 0, floor = 0.005

  let audio: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let source: MediaStreamAudioSourceNode | null = null
  try {
    audio = opts.audio ?? new AudioContext()
    void audio.resume()
    source = audio.createMediaStreamSource(stream)
    analyser = audio.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
  } catch (e) { log(`no level meter (${e}), fixed chunks`) }
  const samples = new Float32Array(analyser?.fftSize ?? 1024)

  const begin = () => {
    if (stopped) return
    const mine: Take = { rec: new MediaRecorder(stream), parts: [], keep: false }
    mine.rec.ondataavailable = (e) => { if (e.data.size) mine.parts.push(e.data) }
    mine.rec.onstop = () => {
      const blob = new Blob(mine.parts, { type: mine.rec.mimeType })
      if (mine.keep && blob.size >= 3000) onUtterance(blob)
    }
    try { mine.rec.start() } catch (e) { log(`recorder start failed ${e}`); return }
    take = mine
    startedAt = Date.now(); lastVoice = 0; speechMs = 0
  }
  // The next take starts before the old one stops, so nothing spoken falls between two chunks.
  const cut = (keep: boolean) => {
    const old = take
    begin()
    if (old) { old.keep = keep; if (old.rec.state === 'recording') old.rec.stop() }
  }

  begin()
  const timer = setInterval(() => {
    if (stopped || !take) return
    const now = Date.now()
    const age = now - startedAt
    if (!analyser || audio?.state !== 'running') { if (age >= FALLBACK_MS) cut(true); return }
    analyser.getFloatTimeDomainData(samples)
    let sum = 0
    for (const x of samples) sum += x * x
    const level = Math.sqrt(sum / samples.length)
    const loud = level > Math.max(0.012, floor * 3)
    if (loud) { speechMs += TICK_MS; lastVoice = now } else floor = floor * 0.95 + level * 0.05
    const spoke = speechMs >= MIN_SPEECH_MS
    if (spoke && (now - lastVoice >= PAUSE_MS || age >= MAX_MS)) cut(true)
    else if (!spoke && age >= IDLE_MS && now - lastVoice > 1000) cut(false)
  }, TICK_MS)

  return () => {
    stopped = true
    clearInterval(timer)
    if (take) { take.keep = speechMs >= MIN_SPEECH_MS; if (take.rec.state === 'recording') take.rec.stop() }
    try { source?.disconnect() } catch { /* already gone */ }
    if (audio && !opts.audio) void audio.close().catch(() => {})
  }
}

// Sends one utterance to the server and returns the text ('' when nothing was understood).
export async function transcribeUtterance(audio: Blob): Promise<string> {
  const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': audio.type || 'audio/webm' }, body: audio })
  const data = (await r.json()) as { segments?: { text: string }[]; error?: string }
  if (!r.ok) throw new Error(data.error ?? `Transkription ${r.status}`)
  return (data.segments ?? []).map((s) => s.text.trim()).filter(Boolean).join(' ')
}

// Utterances are sent at once but delivered in spoken order, even when a later one finishes first.
export function inOrder(deliver: (text: string) => void, onError: (e: unknown) => void) {
  let queue: Promise<void> = Promise.resolve()
  return (audio: Blob) => {
    const text = transcribeUtterance(audio)
    queue = queue.then(() => text).then((t) => { if (t) deliver(t) }).catch(onError)
  }
}
