// Loads the Velachery slice written by pipeline/08_landing_scene.py. Resolves null when the file
// is not there yet (the page then draws the stylised city).
import type { SceneData } from './types'

interface Raw {
  version: number
  run: string; run_label: string; total_mm: number; wet_share_15cm?: number | null
  size_m: number; cell_m: number; n: number
  ground: string; frame_hours: number[]; frames: string[]
  roads: { xy_half_m: string; off: string; cls: string; bridge: string }
  buildings: { xy_half_m: string; off: string; height_dm: string }
  street: { name: string; xy: number[][]; peak_cm: number; t15_hour: number; series_cm: number[] }
  route: {
    dry: number[][]; usual: number[][] | null; deck: number[][] | null; dry_m: number; usual_m: number
    parking: { name: string; kind: string; xy: number[] }
  }
}

function bytes(b64: string): ArrayBuffer {
  const s = atob(b64)
  const u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i)
  return u.buffer
}
const halfM = (b64: string) => Float32Array.from(new Uint16Array(bytes(b64)), (v) => v / 2)
const flat = (pts: number[][]) => new Float32Array(pts.flat())

export const SCENE_URL = '/landing/scene.json'

export async function loadRealScene(): Promise<SceneData | null> {
  let raw: Raw
  try {
    const r = await fetch(SCENE_URL)
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null
    raw = await r.json()
  } catch {
    return null
  }
  if (raw.version !== 1) return null
  const n = raw.n
  const ground = Float32Array.from(new Int16Array(bytes(raw.ground)), (v) => v / 100)
  const frames = raw.frames.map((f) => Float32Array.from(new Uint8Array(bytes(f)), (v) => v / 100))
  // the route ends on the parking spot: along the flyover deck to its middle when it is one
  const dry = raw.route.dry.slice()
  const p = raw.route.parking.xy
  if (raw.route.deck && raw.route.deck.length > 1) {
    const deck = raw.route.deck
    const last = dry[dry.length - 1]
    const d0 = Math.hypot(deck[0][0] - last[0], deck[0][1] - last[1])
    const d1 = Math.hypot(deck[deck.length - 1][0] - last[0], deck[deck.length - 1][1] - last[1])
    const along = d0 <= d1 ? deck : deck.slice().reverse()
    let k = 0, best = Infinity
    along.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < best) { best = d; k = i } })
    dry.push(...along.slice(0, k + 1))
  }
  dry.push(p)
  return {
    kind: 'real', size: raw.size_m, n, cell: raw.cell_m, ground, frames, frameHours: raw.frame_hours, vex: 4,
    buildings: {
      xy: halfM(raw.buildings.xy_half_m), off: new Uint32Array(bytes(raw.buildings.off)),
      height: Float32Array.from(new Uint16Array(bytes(raw.buildings.height_dm)), (v) => v / 10),
    },
    roads: {
      xy: halfM(raw.roads.xy_half_m), off: new Uint32Array(bytes(raw.roads.off)),
      cls: new Uint8Array(bytes(raw.roads.cls)), bridge: new Uint8Array(bytes(raw.roads.bridge)),
    },
    street: { line: flat(raw.street.xy), name: raw.street.name, peakCm: raw.street.peak_cm,
      t15Hour: raw.street.t15_hour >= 0 ? raw.street.t15_hour : null, seriesCm: raw.street.series_cm },
    route: {
      dry: flat(dry), usual: raw.route.usual ? flat(raw.route.usual) : null,
      parking: { x: p[0], y: p[1], name: raw.route.parking.name, kind: raw.route.parking.kind },
      dryM: raw.route.dry_m, usualM: raw.route.usual_m,
    },
    run: { id: raw.run, label: raw.run_label, totalMm: raw.total_mm, wetShare: raw.wet_share_15cm ?? null },
  }
}
