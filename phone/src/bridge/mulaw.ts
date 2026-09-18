// G.711 µ-law nach 16-bit PCM. Die Telefonie liefert µ-law; ElevenLabs bekommt lineares PCM,
// damit wir uns nicht auf ein Encoding-Feld verlassen müssen, das die Doku nicht festschreibt.
// 8 kHz PCM steht ausdrücklich in der Liste der unterstützten Formate.

const TABELLE = new Int16Array(256)
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff
  let t = ((u & 0x0f) << 3) + 0x84
  t <<= (u & 0x70) >> 4
  TABELLE[i] = u & 0x80 ? 0x84 - t : t - 0x84
}

export function mulawZuPcm16(mulaw: Buffer): Buffer {
  const out = Buffer.allocUnsafe(mulaw.length * 2)
  for (let i = 0; i < mulaw.length; i++) out.writeInt16LE(TABELLE[mulaw[i]], i * 2)
  return out
}
