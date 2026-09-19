import { useEffect, useRef } from 'react'
import type { Segment } from '../workspace/brain'
import { useLanguage } from '../data/useLanguage'
import { audioContext, onCaption } from './deskLine'
import { inOrder, recordUtterances } from './utterances'

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
  const language = useLanguage() // the advisor's display language is the language spoken on the call
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

    // The client's words come from the phone itself (it transcribes its own voice and sends captions),
    // so they arrive even when the network blocks the direct audio link. The laptop records the advisor,
    // cut at speech pauses so no sentence is split (utterances.ts).
    const off = onCaption((text) => emit('Kunde', text))
    const send = inOrder((text) => { console.info('[call] text Berater', text); emit('Berater', text) }, (e) => { if (!stopped) handlers.current.onError?.(e instanceof Error ? e.message : String(e)) }, language)
    const stop = recordUtterances(call.local, send, { audio: audioContext(), onLog: (t) => console.info('[call]', t) })

    return () => {
      stopped = true
      off()
      stop()
    }
  }, [call, active, transcribe, language])
}
