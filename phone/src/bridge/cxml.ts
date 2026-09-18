// Antwort-XML für die Brücke. SignalWire und Twilio sprechen dasselbe cXML/TwiML,
// deshalb trägt eine Fassung beide Anbieter.
//
// <Start> ist der entscheidende Teil: es macht den Strom nebenläufig. Ein blankes <Stream>
// würde blockieren und das <Dial> erst nach Ende des Stroms ausführen – dann redet niemand
// miteinander. Mit <Start> läuft der Strom mit, während die beiden verbunden werden.

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export function antwortXml(o: { beraterNummer: string; anruferId: string; stromUrl: string }): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    '  <Start>',
    // both_tracks: inbound ist der Anrufer, outbound das, was er hört – also der Berater.
    `    <Stream url="${escape(o.stromUrl)}" track="both_tracks" />`,
    '  </Start>',
    `  <Dial callerId="${escape(o.anruferId)}" answerOnBridge="true">${escape(o.beraterNummer)}</Dial>`,
    '</Response>',
    '',
  ].join('\n')
}
