import { useEffect, useRef } from 'react'
import type { Segment } from './brain'

const CHUNK_MS = 7000

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null }
const BrowserRecognition = ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => Recognition) | undefined

export const canListen = (elevenlabs: boolean) => (elevenlabs ? !!navigator.mediaDevices?.getUserMedia && 'MediaRecorder' in window : !!BrowserRecognition)

// Nimmt das Gespräch über das Mikrofon auf. Mit ElevenLabs werden abgeschlossene Abschnitte von je
// 7 Sekunden transkribiert (mit Sprechertrennung); ohne Schlüssel dient die Spracherkennung des Browsers.
export function useCallAudio(active: boolean, elevenlabs: boolean, onSegments: (s: Segment[]) => void, onStop: (error?: string) => void) {
  const handlers = useRef({ onSegments, onStop })
  handlers.current = { onSegments, onStop }

  useEffect(() => {
    if (!active) return
    let stopped = false

    if (!elevenlabs) {
      if (!BrowserRecognition) return handlers.current.onStop('Dieser Browser unterstützt keine Spracherkennung.')
      const rec = new BrowserRecognition()
      rec.lang = 'de-CH'; rec.continuous = true; rec.interimResults = false
      rec.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) handlers.current.onSegments([{ speaker: 'unbekannt', text: e.results[i][0].transcript.trim() }]) }
      rec.onend = () => { if (!stopped) handlers.current.onStop() }
      rec.start()
      return () => { stopped = true; rec.stop() }
    }

    let stream: MediaStream | undefined
    let recorder: MediaRecorder | undefined
    let timer: ReturnType<typeof setTimeout>

    const record = () => {
      if (stopped || !stream) return
      // Jeder Abschnitt ist eine eigene, vollständige Datei – deshalb pro Abschnitt ein neuer Recorder.
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
          const data = await r.json()
          if (!r.ok) throw new Error(data.error)
          if (data.segments?.length && !stopped) handlers.current.onSegments(data.segments)
        } catch (e) {
          if (!stopped) { stopped = true; handlers.current.onStop(e instanceof Error ? e.message : String(e)) }
        }
      }
      current.start()
      timer = setTimeout(() => current.state === 'recording' && current.stop(), CHUNK_MS)
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
      if (stopped) return s.getTracks().forEach((t) => t.stop())
      stream = s
      record()
    }).catch(() => handlers.current.onStop('Kein Zugriff auf das Mikrofon.'))

    return () => {
      stopped = true
      clearTimeout(timer)
      if (recorder?.state === 'recording') recorder.stop()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [active, elevenlabs])
}
