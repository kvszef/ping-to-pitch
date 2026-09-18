// The engine owns the Finding contract; the briefing writer only formats.
export type { DraftProposal, Evidence, Finding } from '../../engine/types.ts'

/** Fraction 0–1 → "3.4%". */
export const pct = (fraction: number, digits = 1) => `${(fraction * 100).toFixed(digits)}%`

/** 14342.8 → "14'343" */
export function amount(value: number): string {
  const int = Math.round(Math.abs(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'")
  return `${value < 0 ? '-' : ''}${int}`
}

/** ISO date → "05.03.2025" */
export const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso)
