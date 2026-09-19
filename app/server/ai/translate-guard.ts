// Deterministic guard behind /api/translate: a translation may change the words, never a figure.
// Pure (no Node APIs), so it is unit-tested on its own.

// A number token: digits with ' . , inside and a % right after (80'000, 23.9%, 14.10.2026, 1,5).
// The sign is not part of it: «−4.2%» and "minus 4.2%" carry the same token.
const NUMBER = /\d(?:[\d'’.,]*\d)?(?:\s?%)?/g

/** The number tokens of a text, sorted: a multiset that ignores word order, which a translation may change. */
export const numberTokens = (text: string): string[] => (text.match(NUMBER) ?? []).map((t) => t.replace(/\s/g, '').replace(/’/g, "'")).sort()

export function sameNumbers(a: string, b: string): boolean {
  const x = numberTokens(a), y = numberTokens(b)
  return x.length === y.length && x.every((t, i) => t === y[i])
}

/** One entry per input, same order: the translation where it kept every number token, otherwise the original. */
export function guardTranslation(input: string[], output: unknown): string[] {
  const out = Array.isArray(output) && output.length === input.length ? output : []
  return input.map((original, i) => {
    const t: unknown = out[i]
    return typeof t === 'string' && t.trim() && sameNumbers(original, t) ? t : original
  })
}
