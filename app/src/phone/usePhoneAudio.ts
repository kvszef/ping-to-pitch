import { useEffect, useRef } from 'react'
import type { Segment } from '../workspace/brain'
import { audioContext, onCaption } from './deskLine'

const CHUNK_MS = 4000

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null }
const BrowserRecognition = ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => Recognition) | undefined

type Speaker = 'Kunde' | 'Berater'

// Transcribes an internet call. Both sides arrive as separate streams, so the speaker is known
// without diarisation: the remote stream is the client, the laptop microphone the advisor.
// Without a transcription key the browser recognises the advisor and the phone sends captions.
export function usePhoneAudio(
  call: { remote: MediaStream; local: MediaStream } | null,
  active: boolean,
  transcribe: boolean,
  onSegments: (s: Segment[]) => void,
  onError?: (error: string) => void,
) {
  const handlers = useRef({ onSegments, onError })
  handlers.current = { onSegments, onError }

  useEffect(() => {
    console.info('[call] audio', { call: !!call, active, transcribe })
    if (!call || !active) return
    let stopped = false
    const emit = (speaker: Speaker, text: string) => { if (!stopped && text.trim()) handlers.current.onSegments([{ speaker, text: text.trim() }]) }

    if (!transcribe) {
      const off = onCaption((text) => emit('Kunde', text))
      let rec: Recognition | undefined
      if (BrowserRecognition) {
        rec = new BrowserRecognition()
        rec.lang = 'de-CH'; rec.continuous = true; rec.interimResults = false
        rec.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) emit('Berater', e.results[i][0].transcript) }
        // Chrome ends continuous recognition after a pause; keep it going for the whole call.
        rec.onend = () => { if (!stopped) try { rec?.start() } catch { /* already running */ } }
        rec.start()
      } else handlers.current.onError?.('Dieser Browser unterstützt keine Spracherkennung.')
      return () => { stopped = true; off(); rec?.stop() }
    }

    const timers: ReturnType<typeof setTimeout>[] = []
    const recorders: MediaRecorder[] = []
    // Chrome refuses to record a remote WebRTC stream directly (MediaRecorder.start throws), so both
    // sides are routed through Web Audio and the recorder takes the resulting local stream.
    const audio = audioContext() ?? new AudioContext()
    void audio.resume()
    console.info('[call] audio context', audio.state)
    const recordable = (stream: MediaStream) => {
      const out = audio.createMediaStreamDestination()
      audio.createMediaStreamSource(stream).connect(out)
      return out.stream
    }
    const record = (stream: MediaStream, speaker: Speaker) => {
      if (stopped || !stream.getAudioTracks().length) return
      // Every chunk is a complete file of its own, hence a new recorder per chunk.
      const current = new MediaRecorder(stream)
      recorders.push(current)
      const parts: Blob[] = []
      current.ondataavailable = (e) => { if (e.data.size) parts.push(e.data) }
      current.onstop = async () => {
        recorders.splice(recorders.indexOf(current), 1)
        record(stream, speaker)
        const blob = new Blob(parts, { type: current.mimeType })
        console.info('[call] chunk', speaker, blob.size, blob.type)
        if (blob.size < 4000) return
        try {
          const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob })
          const data = await r.json()
          if (!r.ok) throw new Error(data.error)
          const text = ((data.segments ?? []) as Segment[]).map((s) => s.text.trim()).filter(Boolean).join(' ')
          console.info('[call] text', speaker, text)
          emit(speaker, text)
        } catch (e) {
          if (!stopped) handlers.current.onError?.(e instanceof Error ? e.message : String(e))
        }
      }
      try { current.start() } catch (e) {
        recorders.splice(recorders.indexOf(current), 1)
        if (!stopped) handlers.current.onError?.(`Aufnahme (${speaker}) nicht möglich: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
      timers.push(setTimeout(() => current.state === 'recording' && current.stop(), CHUNK_MS))
    }
    // The client's words come from the phone itself (it transcribes its own voice and sends captions),
    // so they arrive even when the network blocks the direct audio link. The laptop records the advisor.
    const off = onCaption((text) => emit('Kunde', text))
    record(recordable(call.local), 'Berater')

    return () => {
      stopped = true
      off()
      timers.forEach(clearTimeout)
      recorders.forEach((r) => { if (r.state === 'recording') r.stop() })
    }
  }, [call, active, transcribe])
}
