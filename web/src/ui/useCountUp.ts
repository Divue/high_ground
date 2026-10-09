import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '../config'

/** Counts from 0 up to target whenever key changes (ease-out), so the number climbs with the water. */
export function useCountUp(target: number, key: string, ms = 2800): number {
  const [v, setV] = useState(target)
  useEffect(() => {
    if (prefersReducedMotion()) { setV(target); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return v
}
