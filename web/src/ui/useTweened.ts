import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../config'

/** Eases a displayed integer from its current value to `target` over `ms` (instant when ms is 0).
 *  A new `resetKey` (a new street or storm) starts again from 0 instead of the last street's number. */
export function useTweened(target: number, ms: number, resetKey = ''): number {
  const [v, setV] = useState(target)
  const from = useRef(target)
  const cur = useRef(target)
  const key = useRef(resetKey)
  useEffect(() => {
    if (key.current !== resetKey) { key.current = resetKey; cur.current = 0 }
    if (ms <= 0 || prefersReducedMotion()) { cur.current = target; setV(target); return }
    from.current = cur.current
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      const e = 1 - Math.pow(1 - p, 3)
      cur.current = Math.round(from.current + (target - from.current) * e)
      setV(cur.current)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms, resetKey])
  return v
}
