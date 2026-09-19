// Which of the optional insight cards actually matter for this client, and in what order.
// Today's cards.ts shows every card for which data exists ("all contradictions", "up to 2 stale
// notes", ...); this decides, per client, which of the ones that exist are worth the advisor's
// attention in a 60-second window, and ranks them. It never invents a card or a number: it only
// reorders and hides cards `factCards` already built from the findings.

import type { Card } from '../../src/types.ts'
import type { Complete } from './briefing.ts'

export type RankableType = 'flags' | 'contradiction' | 'stalenote' | 'profile' | 'todos'
const RANKABLE = new Set<RankableType>(['flags', 'contradiction', 'stalenote', 'profile', 'todos'])
const isRankable = (t: string): t is RankableType => RANKABLE.has(t as RankableType)

export type CardRanking = { order: RankableType[]; hidden: RankableType[]; rankedBy: 'vorlage' | 'openai' | 'apertus' }

// One line of context per candidate card, so the model has something to judge importance from.
function summaryOf(c: Card): string {
  switch (c.type) {
    case 'flags': return c.items.length ? `${c.items.length} Befund(e), wichtigster: ${c.items[0].text}` : ''
    case 'contradiction': return c.verdict
    case 'stalenote': return `${c.note.quote} – ${c.age}, ${c.expired}`
    case 'profile': return c.persona
    case 'todos': return c.items.length ? `${c.items.length} offene Zusage(n): ${c.items[0].text}` : ''
    default: return ''
  }
}

const MAX_SHOWN = 5

const RULES = `Du hilfst einem Kundenberater einer Schweizer Bank, sich in 60 Sekunden vor dem Anruf zu orientieren.
Du bekommst eine Liste möglicher Zusatzkarten für DIESEN Kunden, jede mit ihrer Art und ihrem Kurzinhalt. Nicht jede Karte, die existiert, verdient in 60 Sekunden Aufmerksamkeit.
Wähle aus, welche Karten der Berater sehen soll (lass weg, was für dieses Gespräch nebensächlich ist), und ordne sie, wichtigstes zuerst. Höchstens ${MAX_SHOWN} Karten.
Regelverletzungen und ungelöste Widersprüche zu Kundenwünschen wiegen in der Regel schwerer als eine reine Charakterbeschreibung.
Antworte als ein einziges JSON-Objekt ohne weiteren Text: {"show": ["<Art>", ...]} mit "Art" nur aus den gegebenen Arten, wichtigste zuerst.`

/** Ranks and filters the optional insight cards `factCards` built. Falls back to "show everything, keep the given order" without a model or on failure. */
export async function rankCards(cards: Card[], complete: Complete, provider: 'openai' | 'apertus'): Promise<CardRanking> {
  const candidates = cards.filter((c) => isRankable(c.type)).map((c) => ({ art: c.type as RankableType, inhalt: summaryOf(c) })).filter((c) => c.inhalt)
  const fallback: CardRanking = { order: candidates.map((c) => c.art), hidden: [], rankedBy: 'vorlage' }
  if (candidates.length < 2) return fallback
  try {
    const answer = await complete([
      { role: 'system', content: RULES },
      { role: 'user', content: JSON.stringify(candidates.map(({ art, inhalt }) => ({ art, inhalt }))) },
    ])
    const raw = typeof answer === 'object' && answer !== null && Array.isArray((answer as { show?: unknown }).show) ? (answer as { show: unknown[] }).show : []
    const known = new Set(candidates.map((c) => c.art))
    const order = [...new Set(raw.filter((x): x is RankableType => typeof x === 'string' && known.has(x as RankableType)))].slice(0, MAX_SHOWN)
    if (!order.length) return fallback
    return { order, hidden: candidates.map((c) => c.art).filter((a) => !order.includes(a)), rankedBy: provider }
  } catch {
    return fallback
  }
}
