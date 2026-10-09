// Hourly depth frames (cm, 8-bit, Web-Mercator grid) blended across the runs of a scenario.
import { loadGray } from './data'
import type { MixPart } from './scenario'

export function frameName(hour: number | 'max') {
  return hour === 'max' ? 'max' : `h${String(Math.max(1, hour)).padStart(2, '0')}`
}

/** Weighted blend of one hour (or the peak) across runs; null if any run's frame is missing. */
export async function blendedFrame(mix: MixPart[], hour: number | 'max', n: number): Promise<Uint8Array | null> {
  const out = new Uint8Array(n)
  if (!mix.length) return out
  const frames = await Promise.all(mix.map(({ run }) => loadGray(`water/${run}/${frameName(hour)}.png`).catch(() => null)))
  if (frames.some((f) => !f)) return null
  if (frames.length === 1 && mix[0].w === 1) return frames[0]!
  const acc = new Float32Array(n)
  frames.forEach((f, k) => { const w = mix[k].w; for (let i = 0; i < n; i++) acc[i] += w * f![i] })
  for (let i = 0; i < n; i++) out[i] = acc[i]
  return out
}
