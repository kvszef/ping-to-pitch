// Deterministic check behind every model sentence: a number may only appear if it is in the data
// the model was given (or in what was just said). The model phrases, it never calculates or invents.
// Language-neutral: only digits count, so German and English text are checked the same way.

// First alternative: English thousands commas (67,000 or 1,250,000.50), which a model writing English or an
// English transcript may produce. Read as a decimal comma, «67,000» would be 67 and pass on any 67% in the data.
const NUMBER = /[1-9]\d{0,2}(?:,\d{3})+(?![\d'’])(?:\.\d+)?|\d+(?:['’]\d{3})*(?:[.,]\d+)?/g
const GROUPED = /^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/
const value = (token: string) => Number(GROUPED.test(token) ? token.replace(/,/g, '') : token.replace(/['’]/g, '').replace(',', '.'))

/** Numbers in `text` that do not occur in `evidence`. Single digits are ignored: they are counts and list positions. */
export function unsupportedNumbers(text: string, evidence: string): string[] {
  const known = new Set((evidence.match(NUMBER) ?? []).map(value))
  return (text.match(NUMBER) ?? []).filter((token) => {
    const v = value(token)
    return !(Number.isInteger(v) && v < 10) && !known.has(v)
  })
}

export const grounded = (text: string | null | undefined, evidence: string) => !!text && unsupportedNumbers(text, evidence).length === 0
