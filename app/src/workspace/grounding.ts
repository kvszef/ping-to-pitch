// Deterministic check behind every model sentence: a number may only appear if it is in the data
// the model was given (or in what was just said). The model phrases, it never calculates or invents.

const NUMBER = /\d+(?:['’]\d{3})*(?:[.,]\d+)?/g
const value = (token: string) => Number(token.replace(/['’]/g, '').replace(',', '.'))

/** Numbers in `text` that do not occur in `evidence`. Single digits are ignored: they are counts and list positions. */
export function unsupportedNumbers(text: string, evidence: string): string[] {
  const known = new Set((evidence.match(NUMBER) ?? []).map(value))
  return (text.match(NUMBER) ?? []).filter((token) => {
    const v = value(token)
    return !(Number.isInteger(v) && v < 10) && !known.has(v)
  })
}

export const grounded = (text: string | null | undefined, evidence: string) => !!text && unsupportedNumbers(text, evidence).length === 0
