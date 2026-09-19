// The text overview (src/workspace/TextView.tsx) as one running text the advisor can say to the client,
// worded in the tone that fits this client. The tone is not guessed here: it is the engine's profile.tone
// finding (register plus hints). The model only phrases the points it is given; the client checks every
// number against the overview (src/workspace/useNarrative.ts) and falls back to the plain points.
// No name, IBAN or account number is part of the input.

import { langOf } from '../../engine/lang.ts'
import { REGISTER, REGISTER_EN } from '../../engine/checks/profile-tone.ts'

type Message = { role: 'system' | 'user' | 'assistant'; content: string }
type Point = { figure?: string; text: string; source: string }
export type NarrativeInput = { register?: string; hints?: string[]; facts?: [string, string][]; sections?: { group: string; points: Point[] }[]; language?: string }

const SHAPE = {
  brief: 'Höchstens 4 kurze Sätze. Die wichtigste Zahl zuerst, keine Herleitung, keine Erklärung von Begriffen.',
  calm: '5 bis 7 ruhige Sätze. Jeden Fachbegriff in einem Halbsatz erklären, Schwankungen einordnen statt kleinreden, kein Zeitdruck.',
  mixed: '4 bis 5 sachliche Sätze. Einen Fachbegriff nur dann kurz erklären, wenn er für die Aussage nötig ist.',
}

function shapeOf(register?: string) {
  const r = (register ?? '').trim()
  if (r === REGISTER.brief || r === REGISTER_EN.brief) return SHAPE.brief
  if (r === REGISTER.calm || r === REGISTER_EN.calm) return SHAPE.calm
  return SHAPE.mixed
}

export function narrativePrompt(p: NarrativeInput): Message[] {
  const english = langOf(p.language) === 'en'
  const sections = (p.sections ?? []).map((s) => ({ thema: s.group, punkte: s.points.map((x) => ({ zahl: x.figure, text: x.text, quelle: x.source })) }))
  return [
    { role: 'system', content: `Du schreibst für einen Kundenberater einer Schweizer Bank einen kurzen Fliesstext, den er dem Kunden im Gespräch so sagen kann. Er fasst die PUNKTE zusammen.
Sie-Form, direkt an den Kunden gerichtet. Keine Anrede mit Namen, keine Grussformel, keine Aufzählung, ein einziger Absatz, höchstens 110 Wörter.
TON: ${p.register || 'sachlich'}. ${shapeOf(p.register)}
Beachte die HINWEISE ZUM TON, soweit sie den Text betreffen. Die Hinweise selbst kommen im Text nicht vor.
Verwende NUR, was in ECKDATEN und PUNKTE steht. Jede Zahl übernimmst du wörtlich (gleiche Ziffern und Trennzeichen), du rechnest und rundest nicht. Erfinde keine Ereignisse, Gründe oder Prognosen.
Keine Anlageempfehlung: nenne eine Massnahme nur, wenn sie wörtlich in den PUNKTEN steht, und dann als Vorschlag zur Besprechung. Keine Floskeln wie «es ist wichtig» oder «ich verstehe Ihre Sorge».
${english ? 'Write the text in English (British spelling). Names of positions and text in «…» stay as they are.' : 'Schreibe auf Deutsch in Schweizer Schreibweise (ss statt ß).'}
Antworte als ein einziges JSON-Objekt ohne weiteren Text: {"text": string}` },
    { role: 'user', content: `HINWEISE ZUM TON:\n${(p.hints ?? []).join('\n') || '–'}\n\nECKDATEN:\n${(p.facts ?? []).map(([l, v]) => `${l}: ${v}`).join('\n') || '–'}\n\nPUNKTE:\n${JSON.stringify(sections)}` },
  ]
}
