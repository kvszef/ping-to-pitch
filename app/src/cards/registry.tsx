import type { ComponentType } from 'react'
import type { Card, CardOf } from '../types'
import { Actions, Flags, Headline, Metrics, Questions, Split } from './basic'

type Registry = { [T in Card['type']]: ComponentType<{ card: CardOf<T> }> }

const registry: Registry = {
  headline: Headline,
  metrics: Metrics,
  split: Split,
  flags: Flags,
  actions: Actions,
  questions: Questions,
}

export function CardView({ card }: { card: Card }) {
  const Component = registry[card.type] as ComponentType<{ card: Card }> | undefined
  if (!Component) return null
  return <Component card={card} />
}
