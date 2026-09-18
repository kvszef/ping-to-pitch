import type { ComponentType } from 'react'
import type { Card, CardOf } from '../types'
import { Actions, Allocation, Flags, Headline, Metrics, Questions, Split } from './basic'
import { Context, Drivers, Proposal } from './panels'
import { TalkTrack } from './talktrack'
import { CallNoteCard, Contradiction, LookThrough, Peers, Profile, StaleNote, Todos } from './findings'

export type Slot = 'main' | 'side'
type Entry<T extends Card['type']> = { component: ComponentType<{ card: CardOf<T> }>; slot: Slot }

const registry: { [T in Card['type']]: Entry<T> } = {
  headline: { component: Headline, slot: 'main' },
  metrics: { component: Metrics, slot: 'side' },
  split: { component: Split, slot: 'main' },
  allocation: { component: Allocation, slot: 'main' },
  flags: { component: Flags, slot: 'main' },
  actions: { component: Actions, slot: 'main' },
  questions: { component: Questions, slot: 'main' },
  drivers: { component: Drivers, slot: 'main' },
  context: { component: Context, slot: 'main' },
  proposal: { component: Proposal, slot: 'main' },
  contradiction: { component: Contradiction, slot: 'main' },
  lookthrough: { component: LookThrough, slot: 'main' },
  stalenote: { component: StaleNote, slot: 'main' },
  profile: { component: Profile, slot: 'main' },
  peers: { component: Peers, slot: 'main' },
  todos: { component: Todos, slot: 'main' },
  callnote: { component: CallNoteCard, slot: 'main' },
  talktrack: { component: TalkTrack, slot: 'main' },
}

export const slotOf = (card: Card): Slot => registry[card.type]?.slot ?? 'main'

export function CardView({ card }: { card: Card }) {
  const Component = registry[card.type]?.component as ComponentType<{ card: Card }> | undefined
  if (!Component) return null
  return <Component card={card} />
}
