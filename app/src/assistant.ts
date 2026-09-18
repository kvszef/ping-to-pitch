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
      case 'drivers': return [...c.items.map((d) => `${d.name}: Gewicht ${d.weight}%, Rendite ${d.ret}%, Beitrag ${d.contribution} Prozentpunkte.`), c.note]
      case 'context': return [...c.facts.map((f) => `${f.label}: ${f.value}`), ...c.notes.map((n) => n.text), ...c.changes]
      case 'proposal': return [c.summary, ...c.trades.map((t) => `${t.side} ${t.name}: ${t.amount} (${t.share}).`), ...c.effects.map((e) => `${e.label}: ${e.before} → ${e.after}.`)]
      case 'contradiction': return [`${c.wish.quote} (${c.wish.source}, ${c.wish.date})`, c.verdict, ...c.holdings.map((h) => `${h.name}: ${h.exposure}% ${c.exposure.label} (${h.via}).`), c.fix.summary, ...c.fix.trades.map((t) => `${t.side} ${t.name}: ${t.amount} (${t.share}).`), ...c.fix.effects.map((e) => `${e.label}: ${e.before} → ${e.after}.`)]
      case 'lookthrough': return [...c.rows.map((r) => `${c.dimension} ${r.label}: direkt ${r.direct}%, über Fonds ${r.viaFunds}%.`), ...(c.note ? [c.note] : [])]
      case 'stalenote': return [`Notiz vom ${c.note.date} (${c.age} alt, nicht bestätigt): ${c.note.quote} ${c.reason} Nachfragen: ${c.question}`]
      case 'profile': return [`Einschätzung: ${c.persona}`, ...c.said.map((n) => `Notiz vom ${n.date}: ${n.text}`), ...c.done.map((d) => `${d.label}: ${d.value} (${d.source})`)]
      case 'peers': return [...c.metrics.map((m) => `${m.label}: ${m.value}${m.unit}, Vergleichsgruppe ${c.profile} (${c.n} Kunden) ${m.min}–${m.max}${m.unit}, Median ${m.median}${m.unit}.`), ...(c.note ? [c.note] : [])]
      case 'todos': return c.items.map((t) => `${t.done ? 'Erledigt' : t.overdue ? 'Überfällig' : 'Offen'} (${t.owner}${t.due ? `, fällig ${t.due}` : ''}): ${t.text}`)
      case 'callnote': return [...c.note.proposed.map((p) => `Vorgeschlagen: ${p.text} ${p.why ?? ''}`), ...c.note.promises.map((p) => `Zusage${p.due ? ` bis ${p.due}` : ''}: ${p.text}`), ...c.note.factUpdates.map((f) => `${f.note}${f.newValue ? ` → ${f.newValue}` : ''}`)]
    }
  })
  const hits = lines.filter((l) => words.some((w) => l.toLowerCase().includes(w))).slice(0, 2)
  return hits.length ? hits.join(' ') : 'Dazu liegen für diesen Kunden keine Daten vor.'
}
