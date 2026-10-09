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
  preWet: boolean        // low ground the model already holds water on before the storm starts
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
      const penalty = (hw === 'service' ? 25 : 0) + (name ? 0 : 40)
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

function decode(b64: string, bytes: number): number[] {
  // hourly depth in cm: uint16 little-endian (current exports) or uint8 (older ones)
  const s = atob(b64)
  if (bytes === 1) return Array.from(s, (c) => c.charCodeAt(0))
  const out = new Array<number>(s.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = s.charCodeAt(2 * i) | (s.charCodeAt(2 * i + 1) << 8)
  return out
}

export async function segmentValues(seg: Segment, mix: MixPart[]): Promise<StreetAnswer> {
  const bytes = (await loadStreetIndex()).series_bytes ?? 1
  let max = 0
  let series: number[] | null = null
  let pre = 0
  for (const { run, w } of mix) {
    const v = await getJSON<StreetVals>(`streets/${run}/${seg.tile}.json`)
    max += w * v.max[seg.index]
    pre += w * (v.pre?.[seg.index] ?? 0)
    const s = decode(v.series[seg.index], bytes)
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
    preWet: pre >= 0.5,
  }
}

export { distM }

/** Share of street segments within `radiusM` that pass 15 cm at peak (same blend as the answer). */
export async function nearbyShare(lon: number, lat: number, mix: MixPart[], radiusM = 500): Promise<{ wet: number; total: number }> {
  const idx = await loadStreetIndex()
  const pad = radiusM / 100_000 + 0.002
  const tiles = Object.entries(idx.tile_bounds_lonlat)
    .filter(([, [w, s, e, n]]) => lon >= w - pad && lon <= e + pad && lat >= s - pad && lat <= n + pad)
    .map(([t]) => t)
  let wet = 0, total = 0
  for (const t of tiles) {
    const g = await getJSON<StreetGeom>(`streets/geom/${t}.json`)
    const vals = await Promise.all(mix.map((m) => getJSON<StreetVals>(`streets/${m.run}/${t}.json`)))
    g.segs.forEach(([, , hw, br, flat], i) => {
      if (hw === 'service' || br) return
      const mid = Math.floor(flat.length / 4) * 2
      if (distM(lon, lat, flat[mid], flat[mid + 1]) > radiusM) return
      total++
      const v = vals.reduce((acc, vv, k) => acc + mix[k].w * vv.max[i], 0)
      if (v >= 15) wet++
    })
  }
  return { wet, total }
}
