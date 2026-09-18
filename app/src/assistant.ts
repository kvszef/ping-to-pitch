import type { Client } from './types'

// Einzige Anschlussstelle für das LLM-Backend. Beispiel: Stichwortsuche im Text des Briefings.
export async function ask(client: Client, question: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 400))
  const words = question.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3)
  const lines = client.briefing.flatMap((c) => {
    switch (c.type) {
      case 'headline': return [c.text]
      case 'metrics': return c.items.map((m) => `${m.label}: ${m.value}${m.delta ? ` (${m.delta})` : ''}`)
      case 'split': return [...c.left.points, ...c.right.points].map((p) => p.text)
      case 'allocation': return c.rows.map((r) => `${r.label}: ${r.actual}% des Portfolios, Mandatsband ${r.min}–${r.max}%, Soll ${r.target}%.`)
      case 'flags': return c.items.map((f) => `${f.text} (${f.source})`)
      case 'actions': return c.items.map((a) => `${a.text} ${a.why}`)
      case 'questions': return c.items.map((x) => x.a)
    }
  })
  const hits = lines.filter((l) => words.some((w) => l.toLowerCase().includes(w))).slice(0, 2)
  return hits.length ? hits.join(' ') : 'Dazu liegen für diesen Kunden keine Daten vor.'
}
