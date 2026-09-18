// Plivo-Seite der Brücke: das Antwort-XML und das Anhängen des Audiostroms.
//
// Warum der Strom per API und nicht per XML kommt: Plivos <Stream>-Element blockiert –
// ein nachfolgendes <Dial> liefe erst, wenn der Strom endet. Wir antworten deshalb sofort
// mit <Dial> und hängen den Strom danach über die API an denselben Anruf.

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** Verbindet den Anrufer mit dem Berater. Der Anruf bleibt eine Plivo-Sitzung, deshalb erfasst der Strom beide Seiten. */
export function antwortXml(o: { beraterNummer: string; anruferId: string }): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Dial callerId="${escape(o.anruferId)}">`,
    `    <Number>${escape(o.beraterNummer)}</Number>`,
    '  </Dial>',
    '</Response>',
    '',
  ].join('\n')
}

export async function starteStrom(o: {
  authId: string
  authToken: string
  callUuid: string
  serviceUrl: string
}): Promise<{ ok: true } | { ok: false; fehler: string }> {
  const r = await fetch(`https://api.plivo.com/v1/Account/${o.authId}/Call/${o.callUuid}/Stream/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${o.authId}:${o.authToken}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      service_url: o.serviceUrl,
      // Beide Spuren: inbound ist der Anrufer, outbound das, was er hört – also der Berater.
      audio_track: 'both',
      content_type: 'audio/x-mulaw;rate=8000',
    }),
  })
  if (r.ok) return { ok: true }
  return { ok: false, fehler: `${r.status} ${(await r.text()).slice(0, 400)}` }
}
