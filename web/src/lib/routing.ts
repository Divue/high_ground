// A* over the precomputed road graph, run in the browser. Edges deeper than the limit
// (cars 30 cm, two-wheelers 15 cm) at peak in the active scenario are skipped.
import { getBin, getJSON } from './data'
import type { MixPart } from './scenario'
import { distM } from './geo'

export interface Graph {
  nodes: Float32Array
  edges: Uint32Array
  len: Float32Array
  cls: Uint8Array
  geomOff: Uint32Array
  geom: Float32Array
  adjStart: Uint32Array
  adjNode: Uint32Array
  adjEdge: Uint32Array
}

let graphP: Promise<Graph> | null = null

export function loadGraph(): Promise<Graph> {
  if (!graphP) {
    graphP = (async () => {
      const [n, e, l, c, go, g] = await Promise.all(
        ['nodes', 'edges', 'len', 'cls', 'geom_off', 'geom'].map((f) => getBin(`graph/${f}.bin`)))
      const nodes = new Float32Array(n), edges = new Uint32Array(e)
      const N = nodes.length / 2, E = edges.length / 2
      const deg = new Uint32Array(N + 1)
      for (let i = 0; i < E; i++) { deg[edges[2 * i] + 1]++; deg[edges[2 * i + 1] + 1]++ }
      for (let i = 0; i < N; i++) deg[i + 1] += deg[i]
      const fill = deg.slice(0, N)
      const adjNode = new Uint32Array(2 * E), adjEdge = new Uint32Array(2 * E)
      for (let i = 0; i < E; i++) {
        const a = edges[2 * i], b = edges[2 * i + 1]
        adjNode[fill[a]] = b; adjEdge[fill[a]++] = i
        adjNode[fill[b]] = a; adjEdge[fill[b]++] = i
      }
      return {
        nodes, edges, len: new Float32Array(l), cls: new Uint8Array(c), geomOff: new Uint32Array(go),
        geom: new Float32Array(g), adjStart: deg, adjNode, adjEdge,
      }
    })()
    graphP.catch(() => { graphP = null })
  }
  return graphP
}

const depthCache = new Map<string, Promise<Uint16Array>>()
export function edgeDepths(run: string): Promise<Uint16Array> {
  if (!depthCache.has(run)) {
    const p = getBin(`graph/depth_${run}.bin`).then((b) => new Uint16Array(b))
    depthCache.set(run, p)
    p.catch(() => depthCache.delete(run))
  }
  return depthCache.get(run)!
}

export async function mixedDepth(mix: MixPart[]): Promise<Float32Array> {
  const arrs = await Promise.all(mix.map((m) => edgeDepths(m.run)))
  const out = new Float32Array(arrs[0].length)
  arrs.forEach((a, k) => { for (let i = 0; i < a.length; i++) out[i] += mix[k].w * a[i] })
  return out
}

export function nearestNode(g: Graph, lon: number, lat: number, minCls = 5): number {
  const k = Math.cos(lat * Math.PI / 180)
  let best = Infinity, bi = 0
  const N = g.nodes.length / 2
  for (let i = 0; i < N; i++) {
    const dx = (g.nodes[2 * i] - lon) * k, dy = g.nodes[2 * i + 1] - lat
    const d = dx * dx + dy * dy
    if (d < best) {
      // only snap to nodes touching an edge of class <= minCls
      let ok = minCls >= 5
      if (!ok) for (let j = g.adjStart[i]; j < g.adjStart[i + 1]; j++) if (g.cls[g.adjEdge[j]] <= minCls) { ok = true; break }
      if (ok) { best = d; bi = i }
    }
  }
  return bi
}

class Heap {
  k: number[] = []
  v: number[] = []
  push(key: number, val: number) {
    const k = this.k, v = this.v
    let i = k.length
    k.push(key); v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]; v[i] = v[p]; i = p
    }
    k[i] = key; v[i] = val
  }
  pop(): number {
    const k = this.k, v = this.v
    const top = v[0]
    const lk = k.pop()!, lv = v.pop()!
    if (k.length) {
      let i = 0
      const n = k.length
      while (true) {
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

export interface Route { lengthM: number; edges: number[]; coords: [number, number][]; floodedEdges: number }

export function astar(g: Graph, s: number, t: number, depth: Float32Array | null, limitCm: number): Route | null {
  const N = g.nodes.length / 2
  const dist = new Float64Array(N).fill(Infinity)
  const prevE = new Int32Array(N).fill(-1)
  const tx = g.nodes[2 * t], ty = g.nodes[2 * t + 1]
  const h = (n: number) => distM(g.nodes[2 * n], g.nodes[2 * n + 1], tx, ty)
  const heap = new Heap()
  dist[s] = 0
  heap.push(h(s), s)
  const closed = new Uint8Array(N)
  while (heap.size) {
    const u = heap.pop()
    if (closed[u]) continue
    closed[u] = 1
    if (u === t) break
    for (let j = g.adjStart[u]; j < g.adjStart[u + 1]; j++) {
      const e = g.adjEdge[j]
      if (depth && depth[e] >= limitCm) continue
      const v = g.adjNode[j]
      const nd = dist[u] + g.len[e]
      if (nd < dist[v]) { dist[v] = nd; prevE[v] = e; heap.push(nd + h(v), v) }
    }
  }
  if (!isFinite(dist[t])) return null
  const edges: number[] = []
  let n = t
  while (n !== s) {
    const e = prevE[n]
    edges.push(e)
    n = g.edges[2 * e] === n ? g.edges[2 * e + 1] : g.edges[2 * e]
  }
  edges.reverse()
  // stitch coordinates in travel order
  const coords: [number, number][] = []
  let cur = s
  for (const e of edges) {
    const a = g.geomOff[e], b = g.geomOff[e + 1]
    const pts: [number, number][] = []
    for (let i = a; i < b; i++) pts.push([g.geom[2 * i], g.geom[2 * i + 1]])
    if (g.edges[2 * e] !== cur) pts.reverse()
    coords.push(...(coords.length ? pts.slice(1) : pts))
    cur = g.edges[2 * e] === cur ? g.edges[2 * e + 1] : g.edges[2 * e]
  }
  return { lengthM: dist[t], edges, coords, floodedEdges: 0 }
}

export async function routePair(fromLL: [number, number], toLL: [number, number], mix: MixPart[], limitCm = 30) {
  const g = await loadGraph()
  const depth = mix.length ? await mixedDepth(mix) : null
  const s = nearestNode(g, fromLL[0], fromLL[1])
  const t = nearestNode(g, toLL[0], toLL[1])
  const normal = astar(g, s, t, null, limitCm)
  if (normal && depth) normal.floodedEdges = normal.edges.filter((e) => depth[e] >= limitCm).length
  const safe = depth ? astar(g, s, t, depth, limitCm) : normal
  return { normal, safe }
}

export async function loadGraphMeta() {
  return getJSON<{ nodes: number; edges: number; hourly?: Record<string, { edges: number; hours: number }> }>('graph/meta.json')
}

// Hour-by-hour edge depths from the model grid (05_features.py): the same samples and p90 as the
// answer card, for edges that ever reach 15 cm (all others stay under every routing limit).
const hourlyCache = new Map<string, Promise<{ ids: Uint32Array; vals: Uint8Array; hours: number } | null>>()
export function hourlyDepths(run: string) {
  if (!hourlyCache.has(run)) {
    hourlyCache.set(run, (async () => {
      const m = (await loadGraphMeta()).hourly?.[run]
      if (!m) return null
      const [ids, vals] = await Promise.all([getBin(`graph/hourly_${run}_ids.bin`), getBin(`graph/hourly_${run}.bin`)])
      return { ids: new Uint32Array(ids), vals: new Uint8Array(vals), hours: m.hours }
    })())
    hourlyCache.get(run)!.catch(() => hourlyCache.delete(run))
  }
  return hourlyCache.get(run)!
}

/** Edge depths (cm) at one model hour for a scenario mix; null if a run has no hourly data. */
export async function edgeDepthAtHour(g: Graph, mix: MixPart[], h: number): Promise<Float32Array | null> {
  const out = new Float32Array(g.edges.length / 2)
  for (const { run, w } of mix) {
    const d = await hourlyDepths(run)
    if (!d) return null
    const base = (Math.min(Math.max(1, h), d.hours) - 1) * d.ids.length
    for (let i = 0; i < d.ids.length; i++) out[d.ids[i]] += w * d.vals[base + i]
  }
  return out
}

/** Shortest dry path from a node to the nearest node on a main road (trunk/primary). */
export function toArterial(g: Graph, s: number, depth: Float32Array, limitCm: number): Route | null {
  const N = g.nodes.length / 2
  const dist = new Float64Array(N).fill(Infinity)
  const prevE = new Int32Array(N).fill(-1)
  const heap = new Heap()
  dist[s] = 0
  heap.push(0, s)
  const closed = new Uint8Array(N)
  let target = -1
  while (heap.size) {
    const u = heap.pop()
    if (closed[u]) continue
    closed[u] = 1
    let arterial = false
    for (let j = g.adjStart[u]; j < g.adjStart[u + 1]; j++) if (g.cls[g.adjEdge[j]] <= 1 && depth[g.adjEdge[j]] < limitCm) { arterial = true; break }
    if (arterial && dist[u] > 300) { target = u; break }
    for (let j = g.adjStart[u]; j < g.adjStart[u + 1]; j++) {
      const e = g.adjEdge[j]
      if (depth[e] >= limitCm) continue
      const v = g.adjNode[j]
      const nd = dist[u] + g.len[e]
      if (nd < dist[v]) { dist[v] = nd; prevE[v] = e; heap.push(nd, v) }
    }
  }
  if (target < 0) return null
  return astar(g, target, s, depth, limitCm)
}

// ---------------------------------------------------------------- time-aware routing
// Edge depth at a given hour comes from the model grid (edgeDepthAtHour), so a route can be
// planned for the moment you leave rather than the storm's peak.

export interface LeavePlan { leaveByHour: number | null; route: Route | null; normal: Route | null; openAllNight: boolean }

/** Latest hour (up to `untilHour`) at which a route under `limitCm` still exists, and that route. */
export async function leaveByPlan(fromLL: [number, number], toLL: [number, number], mix: MixPart[],
  untilHour: number, limitCm = 30): Promise<LeavePlan> {
  const g = await loadGraph()
  const s = nearestNode(g, fromLL[0], fromLL[1])
  const t = nearestNode(g, toLL[0], toLL[1])
  const normal = astar(g, s, t, null, limitCm)
  const yieldFrame = () => new Promise((r) => setTimeout(r, 0))
  const tooLong = (r: Route) => !!normal && r.lengthM > Math.max(3 * normal.lengthM, normal.lengthM + 4000)
  const tryHour = async (h: number) => {
    // model-grid depths per hour, not the display textures (which miss narrow deep roads)
    const depth = await edgeDepthAtHour(g, mix, h)
    if (!depth) return null
    await yieldFrame()
    const r = astar(g, s, t, depth, limitCm)
    await yieldFrame()
    return r && !tooLong(r) ? r : null
  }
  // water only rises before the street floods, so the open hours form a prefix: binary search it
  let best: Route | null = null
  let bestH: number | null = null
  let lo = 1, hi = untilHour
  const last = await tryHour(hi)
  if (last) { best = last; bestH = hi } else {
    hi -= 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const r = await tryHour(mid)
      if (r) { best = r; bestH = mid; lo = mid + 1 } else hi = mid - 1
    }
  }
  return { leaveByHour: bestH, route: best, normal, openAllNight: bestH === untilHour }
}
