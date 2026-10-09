// Nearest street segment and its model values for a scenario (same blend as the Lambdas).
import { getJSON, loadStreetIndex, type StreetGeom, type StreetVals } from './data'
import type { MixPart } from './scenario'
import { distM, pointSegM } from './geo'

export interface Segment {
  tile: string
  index: number
  id: string
  name: string
  highway: string
  bridge: boolean
  coords: [number, number][]
  distanceM: number
}

export interface StreetAnswer {
  maxCm: number
  seriesCm: number[]
  hoursTo15: number | null
  peakHour: number | null
}

export async function nearestSegment(lon: number, lat: number): Promise<Segment | null> {
  const idx = await loadStreetIndex()
  const pad = 0.004
  const tiles = Object.entries(idx.tile_bounds_lonlat)
    .filter(([, [w, s, e, n]]) => lon >= w - pad && lon <= e + pad && lat >= s - pad && lat <= n + pad)
    .map(([t]) => t)
  let best: Segment | null = null
  for (const t of tiles) {
    const g = await getJSON<StreetGeom>(`streets/geom/${t}.json`)
    g.segs.forEach(([id, name, hw, br, flat], i) => {
      // Prefer named, non-service streets for an address answer
      const penalty = hw === 'service' ? 25 : 0
      for (let j = 0; j + 3 < flat.length; j += 2) {
        const d = pointSegM(lon, lat, flat[j], flat[j + 1], flat[j + 2], flat[j + 3]) + penalty
        if (!best || d < best.distanceM) {
          const coords: [number, number][] = []
          for (let k = 0; k < flat.length; k += 2) coords.push([flat[k], flat[k + 1]])
          best = { tile: t, index: i, id, name: name || 'Unnamed street', highway: hw, bridge: !!br, coords, distanceM: d }
        }
      }
    })
  }
  return best
}

function decode(b64: string): number[] {
  const s = atob(b64)
  const out = new Array<number>(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export async function segmentValues(seg: Segment, mix: MixPart[]): Promise<StreetAnswer> {
  let max = 0
  let series: number[] | null = null
  for (const { run, w } of mix) {
    const v = await getJSON<StreetVals>(`streets/${run}/${seg.tile}.json`)
    max += w * v.max[seg.index]
    const s = decode(v.series[seg.index])
    series = series ? series.map((x, i) => x + w * (s[i] ?? 0)) : s.map((x) => w * x)
  }
  const sc = (series ?? []).map((x) => Math.round(x))
  const t15 = sc.findIndex((x) => x >= 15)
  const peak = sc.length ? Math.max(...sc) : 0
  return {
    maxCm: Math.round(max),
    seriesCm: sc,
    hoursTo15: t15 >= 0 ? t15 + 1 : null,
    peakHour: peak > 0 ? sc.indexOf(peak) + 1 : null,
  }
}

export { distM }
