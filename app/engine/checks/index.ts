// Check registry. One file per check, one line here.
import type { Check } from '../types.ts'
import { allocation } from './portfolio-allocation.ts'
import { concentration } from './portfolio-concentration.ts'
import { maturities } from './portfolio-maturities.ts'
import { performance } from './portfolio-performance.ts'
import { proposals } from './portfolio-proposals.ts'
import { risk } from './portfolio-risk.ts'
import { violations } from './portfolio-violations.ts'

export const checks: Record<string, Check> = {
  'portfolio.performance': performance,
  'portfolio.allocation': allocation,
  'portfolio.concentration': concentration,
  'portfolio.risk': risk,
  'portfolio.violations': violations,
  'portfolio.proposals': proposals,
  'portfolio.maturities': maturities,
}
