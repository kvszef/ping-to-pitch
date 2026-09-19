// AI step for client notes the engine's rules do not know (E2). The model sees ONLY the note texts, never
// names, account data or holdings, and must pick one item from the closed wish menu per note. Every answer is
// validated against the menu (engine/wishes.ts parseWish); anything else becomes 'unknown', which the engine
// shows as "not checked, please read". Answers are cached by note text for the life of the server.
// The model never writes a label the advisor reads: the engine labels the parsed menu item itself, in German and
// in English (engine/wishes.ts wishLabel), so the answer and its cache do not depend on the display language.
import { parseWish, SECTORS, type Wish } from '../../engine/wishes.ts'

export type Complete = (messages: { role: 'system' | 'user'; content: string }[]) => Promise<unknown>
export type WishAnswers = Record<string, Wish | 'unknown'>

const MAX_NOTES = 20
const MAX_NOTE_CHARS = 500

const cache = new Map<string, Wish | 'unknown'>()
export const clearWishCache = () => cache.clear()

export const CLASSIFY_RULES = `You read short notes a Swiss private banker wrote about a client (any language). For each note decide what the client WANTS FROM THE PORTFOLIO and answer with exactly one item from this menu, as JSON:
- {"type":"exclude-sector","sector":S,"scope":"any"|"direct"}  the client does not want this sector. scope "any" unless the note itself says direct holdings or single positions ("direkt", "direct", "en direct"); then "direct". Oil, gas, coal, fossil fuels = "Energy". S is one of: ${SECTORS.join(', ')}.
- {"type":"exclude-emerging-markets"}  no emerging markets / developed markets only.
- {"type":"exclude-unverifiable","label":L}  an exclusion with no matching sector (weapons, tobacco, gambling, human-rights issues, ...). L = short German label, e.g. "Rüstung", "Tabak", "Glücksspiel", "Alkohol", "Kernenergie".
- {"type":"keep-cash"} or {"type":"keep-cash","amountChf":N}  wants cash or liquidity kept available; N only if the note names a CHF amount.
- {"type":"prefer-chf-hedged"}  foreign-currency investments hedged to CHF.
- {"type":"esg-only"}  only sustainable / ESG-compliant investments (a requirement, not just an interest).
- {"type":"interest","measure":"esg-share"}  would like more sustainable investments.
- {"type":"interest","measure":"sector","sector":S}  would like more of a sector (S from the list above).
- {"type":"interest","measure":"dividend"}  would like dividend income.
- {"type":"interest","measure":"currency-diversification"}  would like more currencies.
- {"type":"interest","measure":"none"}  another investment interest that fits none of the above.
- {"type":"not-a-wish"}  the note is about the person, contact, a plan or event, or background, not about holdings.
- "unknown"  you are not sure.
Never guess: if unsure, answer "unknown". Every menu item is an object with "type", e.g. {"type":"not-a-wish"}. Use only the fields shown.
Answer as one JSON object: {"items":[{"i":<note number>,"wish":<menu item or "unknown">}]}`

/** Classifies notes the rules do not know. Only the texts go to the model; the answer is checked against the menu. */
export async function classifyNotes(notes: string[], complete: Complete): Promise<WishAnswers> {
  const texts = [...new Set(notes.map((n) => n.trim()).filter(Boolean))]
  const todo = texts.filter((t) => !cache.has(t)).slice(0, MAX_NOTES)
  if (todo.length) {
    const answer = await complete([
      { role: 'system', content: CLASSIFY_RULES },
      { role: 'user', content: `NOTES:\n${JSON.stringify(todo.map((text, i) => ({ i, text: text.slice(0, MAX_NOTE_CHARS) })))}` },
    ])
    const items = typeof answer === 'object' && answer !== null && Array.isArray((answer as { items?: unknown }).items) ? (answer as { items: unknown[] }).items : []
    const byIndex = new Map<number, Wish | 'unknown'>()
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue
      const { i, wish } = item as { i?: unknown; wish?: unknown }
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= todo.length || byIndex.has(i)) continue
      // A bare type name ("not-a-wish") is read as the item without fields; parseWish still checks it.
      byIndex.set(i, parseWish(typeof wish === 'string' && wish !== 'unknown' ? { type: wish } : wish) ?? 'unknown')
    }
    // Only answered notes are cached: a note the model skipped is asked again next time.
    todo.forEach((t, i) => { const a = byIndex.get(i); if (a) cache.set(t, a) })
  }
  return Object.fromEntries(texts.map((t) => [t, cache.get(t) ?? 'unknown']))
}
