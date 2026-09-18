import type { Client } from './types'

// Single swap point for the real LLM backend. Mock: keyword match over the briefing's own text.
export async function ask(client: Client, question: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 400))
  const words = question.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
  const lines = client.briefing.flatMap((c) => {
    switch (c.type) {
      case 'headline': return [c.text]
      case 'metrics': return c.items.map((m) => `${m.label}: ${m.value}${m.delta ? ` (${m.delta})` : ''}`)
      case 'split': return [...c.left.points, ...c.right.points].map((p) => p.text)
      case 'allocation': return c.rows.map((r) => `${r.label}: ${r.actual}% of portfolio, mandate band ${r.min}–${r.max}%, target ${r.target}%.`)
      case 'flags': return c.items.map((f) => `${f.text} (${f.source})`)
      case 'actions': return c.items.map((a) => `${a.text} ${a.why}`)
      case 'questions': return c.items.map((x) => x.a)
    }
  })
  const hits = lines.filter((l) => words.some((w) => l.toLowerCase().includes(w))).slice(0, 2)
  return hits.length ? hits.join(' ') : 'Not supported by the available data for this client.'
}
