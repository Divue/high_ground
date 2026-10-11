// The stylised city: a made-up district with a river, a marsh basin and a road grid. Shown until
// web/public/landing/scene.json exists, and labelled on the page as an illustration.
import type { SceneData } from './types'

const M = 50            // metres per design unit
const VEX = 3           // the design heights below are already exaggerated by this much

function hash(x: number, z: number) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s) }
function vnoise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf)
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const riverZ = (x: number) => 6 * Math.sin(x * 0.09) - 4
// design units: x east, z south (as drawn in the concept), height in exaggerated units
function H(x: number, z: number) {
  let h = 2.5 - 0.032 * x + 1.0 * (vnoise(x * 0.11 + 3, z * 0.11 + 7) - 0.5) + 0.45 * (vnoise(x * 0.27, z * 0.27) - 0.5)
  const bx = x + 9, bz = z - 11
  h -= 2.0 * Math.exp(-(bx * bx + bz * bz) / (2 * 6 * 6))
  const d = Math.abs(z - riverZ(x))
  h -= 0.9 * Math.exp(-(d * d) / (2 * 4.5 * 4.5))
  const ch = Math.exp(-(d * d) / (2 * 1.1 * 1.1))
  h = h * (1 - ch) - 0.6 * ch
  h += 0.7 * Math.exp(-((x - 21) * (x - 21)) / 3) * (1 - Math.exp(-(d * d) / 8))
  const c = smooth(21, 28, x)
  return h * (1 - c) - 1.6 * c
}

export function stylisedCity(): SceneData {
  const HALF = 36, size = HALF * 2 * M, n = 145, cell = size / (n - 1)
  // design (x, z) -> local metres (east, north)
  const toM = (x: number, z: number): [number, number] => [(x + HALF) * M, (HALF - z) * M]
  const toU = (xm: number, ym: number): [number, number] => [xm / M - HALF, HALF - ym / M]

  const ground = new Float32Array(n * n)
  const land: number[] = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const [x, z] = toU(c * cell, r * cell)
    const h = H(x, z)
    ground[r * n + c] = h * M / VEX
    if (x < 20 && h > -0.2) land.push(h)
  }
  land.sort((a, b) => a - b)
  const LF = land[Math.floor(land.length * 0.17)]
  const levels = [-0.35, LF * 0.2, LF * 0.4, LF * 0.6, LF * 0.8, LF]
  const frames = levels.map((L) => {
    const f = new Float32Array(n * n)
    // signed: below zero on dry ground, so the drawn water surface is one level plane with a clean shoreline
    for (let i = 0; i < f.length; i++) f[i] = L * M / VEX - ground[i]
    return f
  })

  // road grid and graph
  const LINES: number[] = []
  for (let v = -28; v <= 28; v += 4) LINES.push(v)
  const N = LINES.length, id = (i: number, j: number) => i * N + j
  const nodes = LINES.flatMap((x, i) => LINES.map((z, j) => ({ x, z, i, j })))
  const isLand = (k: number) => nodes[k].x < 19
  const crossesRiver = (a: typeof nodes[0], b: typeof nodes[0]) => {
    for (let s = 0; s <= 8; s++) { const x = a.x + (b.x - a.x) * s / 8, z = a.z + (b.z - a.z) * s / 8; if (Math.abs(z - riverZ(x)) < 2.2) return true }
    return false
  }
  const minAlong = (a: typeof nodes[0], b: typeof nodes[0]) => {
    let m = Infinity
    for (let s = 0; s <= 8; s++) m = Math.min(m, H(a.x + (b.x - a.x) * s / 8, a.z + (b.z - a.z) * s / 8))
    return m
  }
  type E = { to: number; wet: boolean; bridge: boolean }
  const adj: E[][] = nodes.map(() => [])
  const edges: [number, number, boolean][] = []
  for (const nd of nodes) {
    const a = id(nd.i, nd.j)
    if (!isLand(a)) continue
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const i2 = nd.i + di, j2 = nd.j + dj
      if (i2 >= N || j2 >= N) continue
      const b = id(i2, j2)
      if (!isLand(b)) continue
      const bridge = crossesRiver(nd, nodes[b])
      const wet = !bridge && minAlong(nd, nodes[b]) < LF + 0.08
      adj[a].push({ to: b, wet, bridge }); adj[b].push({ to: a, wet, bridge })
      edges.push([a, b, bridge])
    }
  }
  const depthAt = (k: number) => LF - H(nodes[k].x, nodes[k].z)
  let S = -1, best = Infinity
  for (let k = 0; k < nodes.length; k++) {
    if (!isLand(k) || !adj[k].length) continue
    const d = depthAt(k)
    if (d < 0.3 || d > 0.8) continue
    const dist = Math.hypot(nodes[k].x + 9, nodes[k].z - 11)
    if (dist < best) { best = dist; S = k }
  }
  if (S < 0) S = id(4, 10)
  const dijkstra = (src: number, avoid: boolean) => {
    const dist = new Array(nodes.length).fill(Infinity), prev = new Array(nodes.length).fill(-1), done = new Array(nodes.length).fill(false)
    dist[src] = 0
    for (;;) {
      let u = -1, du = Infinity
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < du) { du = dist[i]; u = i }
      if (u < 0) break
      done[u] = true
      for (const e of adj[u]) {
        const c = 4 * (avoid && e.wet ? 40 : 1) + 0.001 * e.to
        if (dist[u] + c < dist[e.to]) { dist[e.to] = dist[u] + c; prev[e.to] = u }
      }
    }
    return { dist, prev }
  }
  const safe = dijkstra(S, true), plain = dijkstra(S, false)
  let D = -1, dBest = Infinity
  for (let k = 0; k < nodes.length; k++) {
    const nd = nodes[k]
    if (!isLand(k) || nd.x > 15 || depthAt(k) > -0.45 || nd.i + 2 >= N) continue
    const man = Math.abs(nd.x - nodes[S].x) + Math.abs(nd.z - nodes[S].z)
    if (man < 12 || man > 32 || !Number.isFinite(safe.dist[k]) || safe.dist[k] > 160) continue
    if (!adj[k].some((e) => nodes[e.to].z === nd.z && nodes[e.to].x > nd.x && !e.wet)) continue
    const score = Math.abs(man - 20) + (safe.dist[k] / 4 - man / 4) * 2 + (nd.x < nodes[S].x ? 6 : 0)
    if (score < dBest) { dBest = score; D = k }
  }
  if (D < 0) D = id(10, 3)
  const path = (prev: number[], t: number) => { const p: number[] = []; for (let u = t; u >= 0; u = prev[u]) p.unshift(u); return p }
  const line = (ids: number[], tail: [number, number][] = []) => {
    const pts = ids.flatMap((k) => toM(nodes[k].x, nodes[k].z)).concat(tail.flat())
    return new Float32Array(pts)
  }
  // the flyover: a deck running east from D for 8 design units
  const dn = nodes[D]
  const deckA = toM(dn.x, dn.z), deckB = toM(dn.x + 8, dn.z)
  const park = toM(dn.x + 5, dn.z)
  const roadsXY: number[] = [], roadsOff = [0], cls: number[] = [], bridge: number[] = []
  for (const [a, b, br] of edges) {
    roadsXY.push(...toM(nodes[a].x, nodes[a].z), ...toM(nodes[b].x, nodes[b].z))
    roadsOff.push(roadsOff[roadsOff.length - 1] + 2); cls.push(3); bridge.push(br ? 1 : 0)
  }
  roadsXY.push(...deckA, ...deckB); roadsOff.push(roadsOff[roadsOff.length - 1] + 2); cls.push(1); bridge.push(1)

  // buildings: boxes inside blocks, kept out of the river and the marsh core
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const bxy: number[] = [], boff = [0], bh: number[] = []
  const sx = nodes[S].x, sz = nodes[S].z
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
    const x0 = LINES[i], z0 = LINES[j]
    if (x0 > 17) continue
    const k = 2 + Math.floor(rnd() * 4)
    for (let q = 0; q < k; q++) {
      const w = 0.7 + rnd() * 1.3, dp = 0.7 + rnd() * 1.3
      const cx = x0 + 0.5 + w / 2 + rnd() * (3 - w), cz = z0 + 0.5 + dp / 2 + rnd() * (3 - dp)
      const tall = rnd()
      const hgt = 0.35 + rnd() * 1.4 + (tall < 0.08 + Math.exp(-((cx + 2) ** 2 + (cz + 12) ** 2) / 120) * 0.3 ? 1.5 + rnd() * 2.5 : 0)
      if (Math.abs(cz - riverZ(cx)) < 2.6 || (cx + 9) ** 2 + (cz - 11) ** 2 < 16) continue
      if (Math.hypot(cx - sx, cz - sz) < 3.4) continue          // a clear view onto the street
      if (Math.abs(cz - dn.z) < 1.4 && cx > dn.x - 0.5 && cx < dn.x + 8.5) continue   // the flyover
      for (const [px, pz] of [[cx - w / 2, cz - dp / 2], [cx + w / 2, cz - dp / 2], [cx + w / 2, cz + dp / 2], [cx - w / 2, cz + dp / 2]]) bxy.push(...toM(px, pz))
      boff.push(boff[boff.length - 1] + 4)
      bh.push(hgt * M / VEX)
    }
  }
  const sNb = adj[S].find((e) => !e.bridge) ?? adj[S][0]
  return {
    kind: 'stylised', size, n, cell, ground, frames, frameHours: levels.map((_, i) => i + 1), vex: VEX,
    buildings: { xy: new Float32Array(bxy), off: new Uint32Array(boff), height: new Float32Array(bh) },
    roads: { xy: new Float32Array(roadsXY), off: new Uint32Array(roadsOff), cls: new Uint8Array(cls), bridge: new Uint8Array(bridge) },
    street: { line: line([S, sNb.to]), name: '', peakCm: null, t15Hour: null, seriesCm: null },
    route: {
      dry: line(path(safe.prev, D), [park]),
      usual: path(plain.prev, D).join() !== path(safe.prev, D).join() ? line(path(plain.prev, D)) : null,
      parking: { x: park[0], y: park[1], name: 'a flyover', kind: 'flyover' }, dryM: null, usualM: null,
    },
    run: null,
  }
}
