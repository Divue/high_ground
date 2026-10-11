// Flood-safe navigation on the precomputed road graph, run in the browser (and offline).
//
// Rules (docs/OFFLINE_AND_NAVIGATION_PLAN.md, section 5):
//  - never route through water at or above the mode's limit; limits sit below the display bands
//    because the model has hourly steps, p90 depths along each edge and no velocity
//  - depths come from the WORSE of the storms in the blend, and look one model hour ahead
//  - underpasses and tunnels are closed whenever it rains (a 30 m model cannot see them)
//  - vehicles keep to one-way rules; bridges and flyover decks stay passable (depth 0 in the data)
//  - water close to the limit is penalised, main roads are preferred:
//      cost = length * k_class * (1 + 3 * (D / limit)^2)   for D >= the soft limit
import { getBin, getJSON, loadHospitals, loadParking } from './data'
import { distM } from './geo'
import { edgeDepths, hourlyDepths, loadGraph, nearestNode, type Graph } from './routing'
import type { MixPart } from './scenario'

export type Mode = 'foot' | 'two_wheeler' | 'car'
export const MODES: Record<Mode, { label: string; verb: string; block: number; soft: number; kmh: number; oneway: boolean }> = {
  foot: { label: 'On foot', verb: 'on foot', block: 10, soft: 5, kmh: 4.5, oneway: false },
  two_wheeler: { label: 'Two-wheeler', verb: 'by two-wheeler', block: 10, soft: 5, kmh: 18, oneway: true },
  car: { label: 'Car', verb: 'by car', block: 20, soft: 10, kmh: 18, oneway: true },
}
export type DestKind = 'parking' | 'hospital' | 'high' | 'place'

// road class 0 trunk .. 5 service: prefer wide, watched roads that rescuers can reach (our assumption)
const K_CLASS = [1.0, 1.0, 1.05, 1.15, 1.3, 1.5]
export const F_ONEWAY_FWD = 1, F_ONEWAY_REV = 2, F_ROUNDABOUT = 4, F_TUNNEL = 8, F_LINK = 16

export interface NavData { g: Graph; flags: Uint8Array; bridge: Uint8Array; names: string[]; refs: string[] }
let navP: Promise<NavData> | null = null
export function loadNav(): Promise<NavData> {
  if (!navP) {
    navP = (async () => {
      const [g, flags, bridge, names, refs] = await Promise.all([
        loadGraph(),
        getBin('graph/flags.bin').then((b) => new Uint8Array(b)).catch(() => null),
        getBin('graph/bridge.bin').then((b) => new Uint8Array(b)),
        getJSON<string[]>('graph/names.json'),
        getJSON<string[]>('graph/refs.json').catch(() => [] as string[]),
      ])
      const E = g.edges.length / 2
      return { g, flags: flags ?? new Uint8Array(E), bridge, names, refs }
    })()
    navP.catch(() => { navP = null })
  }
  return navP
}

/** Edge depths (cm) hour by hour, the worse of the storms in the mix. Edges never reaching 15 cm
 *  have no hourly series; they keep their peak (under 15 cm), which is the cautious choice. */
export class Depths {
  private cache = new Map<number, Float32Array>()
  readonly worstPeak: Float32Array
  readonly hours: number
  private runs: { peak: Uint16Array; hourly: { ids: Uint32Array; vals: Uint8Array; hours: number } | null }[]
  private constructor(runs: Depths['runs'], E: number) {
    this.runs = runs
    this.hours = Math.max(1, ...runs.map((r) => r.hourly?.hours ?? 1))
    this.worstPeak = new Float32Array(E)
    for (const r of runs) for (let i = 0; i < E; i++) if (r.peak[i] > this.worstPeak[i]) this.worstPeak[i] = r.peak[i]
  }
  static async load(mix: MixPart[], E: number) {
    const runs = await Promise.all(mix.filter((m) => m.w > 0).map(async (m) => ({
      peak: await edgeDepths(m.run), hourly: await hourlyDepths(m.run).catch(() => null),
    })))
    return new Depths(runs, E)
  }
  at(hour: number): Float32Array {
    const h = Math.min(Math.max(1, Math.round(hour)), this.hours)
    let a = this.cache.get(h)
    if (a) return a
    a = new Float32Array(this.worstPeak.length)
    for (const r of this.runs) {
      if (!r.hourly) {             // no hourly data: the peak all night
        for (let i = 0; i < a.length; i++) if (r.peak[i] > a[i]) a[i] = r.peak[i]
        continue
      }
      // edges outside the hourly set stay under 15 cm all night: keep their peak
      for (let i = 0; i < a.length; i++) if (r.peak[i] < 15 && r.peak[i] > a[i]) a[i] = r.peak[i]
      const base = (Math.min(h, r.hourly.hours) - 1) * r.hourly.ids.length
      for (let k = 0; k < r.hourly.ids.length; k++) {
        const e = r.hourly.ids[k], v = r.hourly.vals[base + k]
        if (v > a[e]) a[e] = v
      }
    }
    if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(h, a)
    return a
  }
}

export interface NavRoute {
  nodes: number[]
  edges: number[]
  coords: [number, number][]
  lengthM: number
  timeS: number
  maxCm: number                 // deepest water expected along the way (under the limit)
}

class Heap {
  k: number[] = []; v: number[] = []
  push(key: number, val: number) {
    const k = this.k, v = this.v
    let i = k.length
    k.push(key); v.push(val)
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p }
    k[i] = key; v[i] = val
  }
  pop(): number {
    const k = this.k, v = this.v, top = v[0], lk = k.pop()!, lv = v.pop()!
    if (k.length) {
      let i = 0
      const n = k.length
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && k[c + 1] < k[c]) c++
        if (k[c] >= lk) break
        k[i] = k[c]; v[i] = v[c]; i = c
      }
      k[i] = lk; v[i] = lv
    }
    return top
  }
  get size() { return this.k.length }
}

interface SearchOpts {
  mode: Mode
  depths: Depths | null       // null: ignore water (the "usual way", for comparison)
  storm: boolean              // any rain: underpasses closed
  hour: number                // model hour you leave at
  target?: number             // one destination node (A*), or
  goal?: (n: number) => boolean   // the first node that satisfies this (Dijkstra)
  maxCostM?: number
}

/** Time-dependent search: each edge is judged at the hour you would reach it, looking one hour ahead. */
export function search(nav: NavData, start: number, o: SearchOpts): NavRoute | null {
  const { g, flags } = nav
  const m = MODES[o.mode]
  const N = g.nodes.length / 2
  const cost = new Float64Array(N).fill(Infinity)
  const time = new Float64Array(N)
  const prevE = new Int32Array(N).fill(-1)
  const closed = new Uint8Array(N)
  const speed = m.kmh / 3.6
  const tx = o.target != null ? g.nodes[2 * o.target] : 0, ty = o.target != null ? g.nodes[2 * o.target + 1] : 0
  const h = (n: number) => (o.target != null ? distM(g.nodes[2 * n], g.nodes[2 * n + 1], tx, ty) : 0)
  const heap = new Heap()
  cost[start] = 0
  heap.push(h(start), start)
  let goal = -1
  const maxCost = o.maxCostM ?? 40_000
  while (heap.size) {
    const u = heap.pop()
    if (closed[u]) continue
    closed[u] = 1
    if (u === o.target || (o.goal && o.goal(u))) { goal = u; break }
    if (cost[u] > maxCost) break
    const hr = o.hour + time[u] / 3600
    const d0 = o.depths?.at(hr), d1 = o.depths?.at(hr + 1)
    for (let j = g.adjStart[u]; j < g.adjStart[u + 1]; j++) {
      const e = g.adjEdge[j]
      const v = g.adjNode[j]
      const fl = flags[e]
      if (o.storm && fl & F_TUNNEL) continue
      if (m.oneway) {
        const fwd = g.edges[2 * e] === u
        if ((fl & F_ONEWAY_FWD && !fwd) || (fl & F_ONEWAY_REV && fwd)) continue
      }
      let pen = 0
      if (d0 && d1) {
        const D = Math.max(d0[e], d1[e])
        if (D >= m.block) continue
        if (D >= m.soft) pen = 3 * (D / m.block) ** 2
      }
      const len = g.len[e]
      const nc = cost[u] + len * K_CLASS[g.cls[e]] * (1 + pen)
      if (nc < cost[v]) {
        cost[v] = nc; prevE[v] = e; time[v] = time[u] + len / speed
        heap.push(nc + h(v), v)
      }
    }
  }
  if (goal < 0) return null
  const edges: number[] = [], nodes: number[] = [goal]
  for (let n = goal; n !== start;) {
    const e = prevE[n]
    edges.push(e)
    n = g.edges[2 * e] === n ? g.edges[2 * e + 1] : g.edges[2 * e]
    nodes.push(n)
  }
  edges.reverse(); nodes.reverse()
  const coords: [number, number][] = []
  let lengthM = 0, maxCm = 0
  edges.forEach((e, i) => {
    const a = g.geomOff[e], b = g.geomOff[e + 1]
    const pts: [number, number][] = []
    for (let k = a; k < b; k++) pts.push([g.geom[2 * k], g.geom[2 * k + 1]])
    if (g.edges[2 * e] !== nodes[i]) pts.reverse()
    coords.push(...(coords.length ? pts.slice(1) : pts))
    lengthM += g.len[e]
    if (o.depths) maxCm = Math.max(maxCm, o.depths.at(o.hour + time[nodes[i]] / 3600)[e])
  })
  return { nodes, edges, coords, lengthM, timeS: time[goal], maxCm: Math.round(maxCm) }
}

// ---------------------------------------------------------------- destinations
export interface Dest { kind: DestKind; name: string; lon: number; lat: number; node: number; detail?: string }

const destCache = new Map<string, Promise<Dest[]>>()
async function parkingDests(nav: NavData, mix: MixPart[]): Promise<Dest[]> {
  const key = `park|${mix.map((m) => m.run).join()}`
  if (!destCache.has(key)) {
    destCache.set(key, (async () => {
      const p = await loadParking()
      const runs = mix.filter((m) => m.w > 0).map((m) => m.run)
      return p.candidates
        .map((c, i) => ({ c, ok: runs.every((r) => p.dry[r]?.[i] === 1) }))
        .filter((x) => x.ok)
        .map(({ c }) => ({ kind: 'parking' as const, name: c.name, lon: c.lon, lat: c.lat, node: nearestNode(nav.g, c.lon, c.lat, 4), detail: c.kind }))
    })())
    destCache.get(key)!.catch(() => destCache.delete(key))
  }
  return destCache.get(key)!
}
async function hospitalDests(): Promise<Dest[]> {
  const h = await loadHospitals()
  return h.hospitals.map((x) => ({ kind: 'hospital' as const, name: x.name, lon: x.lon, lat: x.lat, node: x.node }))
}

export interface NavRequest {
  from: [number, number]
  mode: Mode
  kind: DestKind
  mix: MixPart[]
  hour: number
  place?: { name: string; lon: number; lat: number }
}
export interface NavResult {
  ok: boolean
  dest: Dest | null
  route: NavRoute | null
  usual: NavRoute | null        // the shortest way ignoring water, to show what the route avoids
  avoided: number               // streets on the usual way at or over the limit
  startCm: number               // water on your own street now
  opensAt: number | null        // no route now: the first later hour one exists
  onHighGround: boolean
}

export async function navigate(req: NavRequest): Promise<NavResult> {
  const nav = await loadNav()
  const { g } = nav
  const E = g.edges.length / 2
  const depths = await Depths.load(req.mix, E)
  const storm = req.mix.length > 0
  const start = nearestNode(g, req.from[0], req.from[1], 4)
  const m = MODES[req.mode]
  const startCm = (() => {
    let worst = 0
    const d = depths.at(req.hour)
    for (let j = g.adjStart[start]; j < g.adjStart[start + 1]; j++) worst = Math.max(worst, d[g.adjEdge[j]])
    return Math.round(worst)
  })()

  // the destinations, as a goal test over graph nodes
  let dests: Dest[] = []
  let goal: (n: number) => boolean
  let target: number | undefined
  if (req.kind === 'parking') dests = await parkingDests(nav, req.mix)
  else if (req.kind === 'hospital') dests = await hospitalDests()
  else if (req.kind === 'place' && req.place) {
    target = nearestNode(g, req.place.lon, req.place.lat, 4)
    dests = [{ kind: 'place', name: req.place.name, lon: req.place.lon, lat: req.place.lat, node: target }]
  }
  const byNode = new Map(dests.map((d) => [d.node, d]))
  if (req.kind === 'high') {
    // high ground: a junction on a secondary or bigger road whose roads all stay under 5 cm all storm
    const sx = g.nodes[2 * start], sy = g.nodes[2 * start + 1]
    goal = (n) => {
      let main = false
      for (let j = g.adjStart[n]; j < g.adjStart[n + 1]; j++) {
        const e = g.adjEdge[j]
        if (depths.worstPeak[e] >= 5 || nav.flags[e] & F_TUNNEL) return false
        if (g.cls[e] <= 2) main = true
      }
      return main && distM(sx, sy, g.nodes[2 * n], g.nodes[2 * n + 1]) > 150
    }
  } else goal = (n) => byNode.has(n)

  const run = (hour: number) => search(nav, start, { mode: req.mode, depths, storm, hour, target, goal })
  const route = run(req.hour)
  let dest: Dest | null = null
  if (route) {
    const end = route.nodes[route.nodes.length - 1]
    if (req.kind === 'high') {
      // named after the main road it sits on (the last piece of the way there may be a lane or a car park)
      let road = ''
      for (let j = g.adjStart[end]; j < g.adjStart[end + 1] && !road; j++) if (g.cls[g.adjEdge[j]] <= 2) road = nav.names[g.adjEdge[j]] || nav.refs[g.adjEdge[j]] || ''
      for (let j = g.adjStart[end]; j < g.adjStart[end + 1] && !road; j++) if (g.cls[g.adjEdge[j]] <= 4) road = nav.names[g.adjEdge[j]] || ''
      dest = { kind: 'high', name: road ? `Higher ground on ${road}` : 'Higher ground', lon: g.nodes[2 * end], lat: g.nodes[2 * end + 1], node: end,
        detail: 'stays under 5 cm all storm in the model' }
    } else dest = byNode.get(end) ?? null
  }
  // the usual way to the same place, ignoring water (what the route avoids)
  let usual: NavRoute | null = null, avoided = 0
  if (route && dest) {
    usual = search(nav, start, { mode: req.mode, depths: null, storm: false, hour: req.hour, target: dest.node })
    if (usual) {
      const d = depths.at(req.hour), d1 = depths.at(req.hour + 1)
      const seen = new Set<string>()
      for (const e of usual.edges) if (Math.max(d[e], d1[e]) >= m.block) seen.add(nav.names[e] || `#${e}`)
      avoided = seen.size
    }
  }
  // no route now: after the peak, roads reopen; find the first hour one exists
  let opensAt: number | null = null
  if (!route) {
    for (let h = Math.ceil(req.hour) + 1; h <= Math.min(depths.hours, req.hour + 12); h++) if (run(h)) { opensAt = h; break }
  }
  // your own street stays under 5 cm all storm: staying put is a fair answer too
  let onHighGround = true
  for (let j = g.adjStart[start]; j < g.adjStart[start + 1]; j++) if (depths.worstPeak[g.adjEdge[j]] >= 5) onHighGround = false
  return { ok: !!route, dest, route, usual, avoided, startCm, opensAt, onHighGround }
}

// ---------------------------------------------------------------- the card's decision
/** "Move your car to X by 2 AM": the latest hour (up to `until`) at which this router still finds a
 *  way to the place, with the same rules as Take me to dry ground, so the card and the directions agree. */
export async function leaveBy(req: { from: [number, number]; to: [number, number]; mix: MixPart[]; until: number; mode: Mode }) {
  const nav = await loadNav()
  const { g } = nav
  const depths = await Depths.load(req.mix, g.edges.length / 2)
  const storm = req.mix.length > 0
  const start = nearestNode(g, req.from[0], req.from[1], 4)
  const target = nearestNode(g, req.to[0], req.to[1], 4)
  const usual = search(nav, start, { mode: req.mode, depths: null, storm: false, hour: 1, target })
  const tooLong = (r: NavRoute) => !!usual && r.lengthM > Math.max(3 * usual.lengthM, usual.lengthM + 4000)
  const at = (h: number) => {
    const r = search(nav, start, { mode: req.mode, depths, storm, hour: h, target })
    return r && !tooLong(r) ? r : null
  }
  // water only rises before the street floods, so the open hours form a prefix: binary search it
  let best: NavRoute | null = null, bestH: number | null = null
  let lo = 1, hi = Math.max(1, req.until)
  const last = at(hi)
  if (last) { best = last; bestH = hi } else {
    hi -= 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const r = at(mid)
      if (r) { best = r; bestH = mid; lo = mid + 1 } else hi = mid - 1
    }
  }
  return { leaveByHour: bestH, route: best, usual }
}
