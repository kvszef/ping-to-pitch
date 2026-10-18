import WebSocket from 'ws'

// ElevenLabs Scribe v2 Realtime. Pro Gesprächsspur eine eigene Sitzung – dadurch ist der
// Sprecher schon durch die Sitzung bestimmt und es braucht keine Diarisierung.

const URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'
const SAMPLE_RATE = 8000
// SignalWire und Twilio schicken alle 20 ms einen Rahmen. Gebündelt alle 200 ms senden statt 50-mal pro Sekunde.
const BUENDEL_MS = 200

export type Scribe = { sende: (pcm: Buffer) => void; schliesse: () => void }

export function oeffneScribe(o: {
  key: string
  sprache: string
  onText: (text: string, endgueltig: boolean) => void
  onFehler: (meldung: string) => void
}): Scribe {
  const ws = new WebSocket(`${URL}?model_id=scribe_v2_realtime&language=${encodeURIComponent(o.sprache)}`, {
    headers: { 'xi-api-key': o.key },
  })

  let offen = false
  let geschlossen = false
  let puffer: Buffer[] = []

  const leeren = () => {
    if (!offen || !puffer.length) return
    const pcm = Buffer.concat(puffer)
    puffer = []
    ws.send(JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: pcm.toString('base64'),
      commit: false,
      sample_rate: SAMPLE_RATE,
    }))
  }

  const takt = setInterval(leeren, BUENDEL_MS)

  ws.on('open', () => { offen = true; leeren() })

  ws.on('message', (roh) => {
    let m: { message_type?: string; text?: string; message?: string }
    try { m = JSON.parse(roh.toString()) } catch { return }
    if (m.message_type === 'partial_transcript' && m.text) return o.onText(m.text, false)
    if (m.message_type === 'committed_transcript' && m.text) return o.onText(m.text, true)
    if (m.message_type === 'error') o.onFehler(m.message ?? 'unbekannter Fehler von ElevenLabs')
  })

  ws.on('error', (e) => { if (!geschlossen) o.onFehler(e instanceof Error ? e.message : String(e)) })
  ws.on('close', (code, grund) => {
    clearInterval(takt)
    if (!geschlossen && code !== 1000) o.onFehler(`ElevenLabs hat getrennt (${code}${grund.length ? ` ${grund.toString()}` : ''})`)
  })

  return {
    sende: (pcm) => { if (!geschlossen) puffer.push(pcm) },
    schliesse: () => {
      geschlossen = true
      clearInterval(takt)
      if (offen && ws.readyState === WebSocket.OPEN) {
        leeren()
        // Leerer Rahmen mit commit: schliesst das letzte Segment ab, statt es zu verlieren.
        ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: SAMPLE_RATE }))
        setTimeout(() => ws.close(1000), 700)
      } else ws.terminate()
    },
  }
}
