// Die Schnittstelle zur Telefonie. Sie wird parallel von jemand anderem gebaut, deshalb steht hier
// genau, was geliefert werden muss – und sonst nichts. Es gibt drei Andockpunkte; einer genügt.
//
//   A  MediaStreams im Browser   -> BrowserTransport (bevorzugt, deckt alles ab)
//   B  Audio am Server           -> WebSocket an /stt?callId=..&role=caller|advisor
//   C  fertiges Transkript       -> HTTP POST /call mit CallEvent-Objekten
//
// Alle drei münden in denselben Ereignisvertrag aus contracts/events.ts.

import type { CallEvent, CallStarted } from './events.ts'

/** Was ein Anruf für den Copiloten ist, unabhängig vom Anbieter. */
export type ActiveCall = {
  callId: string
  /** Anrufernummer in E.164. Leerstring bei unterdrückter Nummer. */
  from: string
  /** Angerufene Nummer in E.164. */
  to: string
  /** Der eigene Mikrofonton des Beraters. */
  localStream: MediaStream
  /** Der Ton der Gegenseite. */
  remoteStream: MediaStream
  /** Auflegen. Muss idempotent sein. */
  hangup(): void | Promise<void>
}

/**
 * Andockpunkt A: der Browser-Transport.
 *
 * Bekannte Umsetzungen, beide liefern genau diese zwei MediaStreams:
 *   livekit-client       Remote: `RemoteAudioTrack.mediaStreamTrack`, lokal: der publizierte Mic-Track
 *   @twilio/voice-sdk    `call.getRemoteStream()` und `call.getLocalStream()`
 *
 * Der Copilot ruft `connect()` einmal beim Laden der Seite auf und wartet dann auf `onIncoming`.
 */
export type BrowserTransport = {
  /** Name für Anzeige und `CallStarted.transport`. */
  readonly name: string
  /** Erreichbar werden (Raum betreten, Gerät registrieren). Danach kann es klingeln. */
  connect(): Promise<void>
  /** Es klingelt. Der Copilot zeigt die Klingel-Karte und lädt bereits das Briefing. */
  onIncoming(handler: (call: IncomingCall) => void): void
  /** Verbindung beenden, Ressourcen freigeben. */
  disconnect(): Promise<void>
}

/** Ein klingelnder Anruf: erst annehmen, dann gibt es Audio. */
export type IncomingCall = {
  callId: string
  from: string
  to: string
  /** Annehmen. Liefert die beiden Audiospuren. */
  accept(): Promise<ActiveCall>
  /** Ablehnen. */
  reject(): Promise<void>
  /** Die Gegenseite hat vorher aufgelegt. */
  onCancelled(handler: () => void): void
}

/** Andockpunkt B: ein Audiorahmen einer Spur, wie ihn der Server unter /stt erwartet. */
export type AudioFrame = {
  callId: string
  role: 'caller' | 'advisor'
  /** PCM16 mono. Bevorzugt 16000 Hz; 8000 Hz wird serverseitig hochgerechnet. */
  pcm16: ArrayBuffer
  sampleRate: 16000 | 8000
}

/**
 * Andockpunkt C: eine fremde Quelle schickt fertige Ereignisse an POST /call.
 * Beispiel Twilio Real-Time Transcription: `Track` -> speaker, `Final` -> final,
 * `TranscriptionData.transcript` -> text. Die Umrechnung gehört in server/telephony/inbound.ts.
 */
export type InboundPayload = CallEvent | CallEvent[]

/**
 * Das Minimum, das die Telefonie-Seite liefern muss, damit der Copilot arbeiten kann.
 * Fehlt die Nummer, läuft alles weiter – nur ohne automatische Kundenerkennung.
 */
export type TelephonyHandshake = Pick<CallStarted, 'callId' | 'from' | 'to' | 'transport'>

/** Kennung der gewählten Umsetzung, aus der Umgebungsvariable TELEPHONY. */
export type TelephonyMode = 'sim' | 'livekit' | 'twilio' | 'external'
