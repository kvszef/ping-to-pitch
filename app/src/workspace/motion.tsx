import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

// Motion helpers so nothing on the stage jumps: heights follow their content smoothly, and
// elements that change place glide there (FLIP).

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// A box whose height follows its content with a transition instead of snapping.
export function Smooth({ children, className = '', ms = 450 }: { children: ReactNode; className?: string; ms?: number }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const measure = () => setHeight(el.offsetHeight)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  return (
    <div className={`overflow-hidden ${className}`} style={{ height, transition: reduced() ? undefined : `height ${ms}ms cubic-bezier(.22,1,.36,1)` }}>
      <div ref={inner}>{children}</div>
    </div>
  )
}

// Children marked with `data-flip="<id>"` inside `box` glide from their old to their new position
// whenever `key` changes (an item arrived, left or moved).
export function useFlip(box: RefObject<HTMLElement | null>, key: string) {
  const before = useRef(new Map<string, DOMRect>())
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const next = new Map<string, DOMRect>()
    el.querySelectorAll<HTMLElement>('[data-flip]').forEach((node) => {
      const id = node.dataset.flip!
      const rect = node.getBoundingClientRect()
      next.set(id, rect)
      const was = before.current.get(id)
      if (!was || reduced()) return
      const dx = was.left - rect.left, dy = was.top - rect.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
      node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.22,1,.36,1)' })
    })
    before.current = next
  }, [box, key])
}
