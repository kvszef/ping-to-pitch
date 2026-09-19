// The bank's investment view for the engine (ctx.houseView) and the UI (GET /api/house-view).
// Today: the example view in engine/houseview.ts. With HOUSE_VIEW_FILE set, a JSON file in the same shape
// replaces it, e.g. one produced from the CIO's monthly publication. A broken file never stops the app:
// the example stays and the server log says why.
import { readFileSync } from 'node:fs'
import { EXAMPLE_HOUSE_VIEW, houseViewIn, type HouseView } from '../engine/houseview.ts'
import type { Lang } from '../engine/lang.ts'

let cached: HouseView | undefined

export function houseView(): HouseView {
  if (cached) return cached
  const file = process.env.HOUSE_VIEW_FILE?.trim()
  if (file) {
    try {
      const v = JSON.parse(readFileSync(file, 'utf8')) as HouseView
      if (v && Array.isArray(v.stances) && v.date) return (cached = { ...v, example: v.example ?? false })
      console.warn(`[houseview] ${file}: no stances or date, using the example view`)
    } catch (e) {
      console.warn(`[houseview] ${file} unreadable (${e instanceof Error ? e.message : e}), using the example view`)
    }
  }
  return (cached = EXAMPLE_HOUSE_VIEW)
}

/** The view for the screen (GET /api/house-view, the house-view card): the example comes out in the language, a bank's own file keeps its own words. */
export const houseViewFor = (lang?: Lang): HouseView => houseViewIn(houseView(), lang)
