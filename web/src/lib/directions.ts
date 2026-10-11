// Turn-by-turn directions in plain English from a route on our road graph (no routing server).
// Consecutive pieces of the same road are merged; at each change of road the turn is classed by
// the heading change (GraphHopper's thresholds: <11° continue, <40° slight, <103° turn, else sharp,
// 160–200° U-turn). Most small Chennai streets have no name in OpenStreetMap, so unnamed turns are
// counted ("take the 2nd left").
import type { NavData, NavRoute } from './nav'
import { F_ROUNDABOUT } from './nav'
import { distM, fmtDistance } from './geo'

export interface Step {
  text: string
  distM: number           // distance to the next instruction
  at: [number, number]    // where the manoeuvre happens
  icon: 'start' | 'straight' | 'slight-left' | 'slight-right' | 'left' | 'right' | 'sharp-left' | 'sharp-right' | 'uturn' | 'roundabout' | 'arrive'
}

const bearing = (a: [number, number], b: [number, number]) => {
  const k = Math.cos((a[1] * Math.PI) / 180)
  return (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI
}
const norm = (d: number) => ((d + 540) % 360) - 180
const ORD = ['first', 'second', 'third', 'fourth', 'fifth']
const CARD = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/** Heading over the first (or last) ~25 m of a polyline (shorter windows read kinks as turns). */
function headingAt(coords: [number, number][], fromEnd: boolean, over = 25): number {
  const pts = fromEnd ? [...coords].reverse() : coords
  let acc = 0, j = 1
  for (; j < pts.length; j++) { acc += distM(pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1]); if (acc >= over) break }
  const a = pts[0], b = pts[Math.min(j, pts.length - 1)]
  return fromEnd ? bearing(b, a) : bearing(a, b)
}

interface Leg { edges: number[]; nodes: number[]; coords: [number, number][]; len: number; name: string; ref: string; cls: number; round: boolean; bridge: boolean }

function edgeCoords(nav: NavData, e: number, from: number): [number, number][] {
  const g = nav.g
  const pts: [number, number][] = []
  for (let k = g.geomOff[e]; k < g.geomOff[e + 1]; k++) pts.push([g.geom[2 * k], g.geom[2 * k + 1]])
  if (g.edges[2 * e] !== from) pts.reverse()
  return pts
}

export function directions(nav: NavData, r: NavRoute, destName: string): Step[] {
  const { g, names, refs, flags, bridge } = nav
  if (!r.edges.length) return [{ text: `You are at ${destName}`, distM: 0, at: r.coords[0], icon: 'arrive' }]
  // 1. legs: runs of the same road
  const legs: Leg[] = []
  r.edges.forEach((e, i) => {
    const from = r.nodes[i]
    const c = edgeCoords(nav, e, from)
    const name = names[e] ?? '', ref = refs[e] ?? '', round = !!(flags[e] & F_ROUNDABOUT)
    const last = legs[legs.length - 1]
    const same = last && (last.round && round
      || (!last.round && !round && (name ? last.name === name : !last.name && !ref && last.cls === g.cls[e]
        && Math.abs(norm(headingAt(c, false) - headingAt(last.coords, true))) < 30)))
    if (same) {
      last.edges.push(e); last.nodes.push(r.nodes[i + 1]); last.coords.push(...c.slice(1)); last.len += g.len[e]
      last.bridge = last.bridge && !!bridge[e]
    } else {
      legs.push({ edges: [e], nodes: [from, r.nodes[i + 1]], coords: c, len: g.len[e], name, ref, cls: g.cls[e], round, bridge: !!bridge[e] })
    }
  })
  // a stretch shorter than 15 m (a jog across a junction) is no instruction of its own: fold it into
  // the next stretch, so "turn right, then turn left 10 m later" becomes one manoeuvre
  for (let i = 1; i < legs.length - 1; i++) {
    const l = legs[i]
    if (l.len < 15 && !l.round && !legs[i + 1].round) {
      const n = legs[i + 1]
      n.edges.unshift(...l.edges); n.nodes = [...l.nodes.slice(0, -1), ...n.nodes]; n.coords = [...l.coords.slice(0, -1), ...n.coords]; n.len += l.len
      legs.splice(i, 1); i--
    }
  }
  const label = (l: Leg) => l.name || l.ref

  // side streets on one side of a leg, before its end (for "take the 2nd left")
  const sideCount = (l: Leg, side: -1 | 1) => {
    let n = 0
    for (let i = 1; i < l.nodes.length - 1; i++) {
      const u = l.nodes[i]
      const inH = headingAt(edgeCoords(nav, l.edges[i - 1], l.nodes[i - 1]), true)
      for (let j = g.adjStart[u]; j < g.adjStart[u + 1]; j++) {
        const e = g.adjEdge[j]
        // only real side streets count: not driveways and service lanes
        if (e === l.edges[i - 1] || e === l.edges[i] || g.cls[e] >= 5) continue
        const d = norm(headingAt(edgeCoords(nav, e, u), false) - inH)
        if (side * d > 30 && side * d < 150) { n++; break }
      }
    }
    return n
  }

  const steps: Step[] = []
  const first = legs[0]
  const h0 = (headingAt(first.coords, false) + 360) % 360
  steps.push({ text: `Head ${CARD[Math.round(h0 / 45) % 8]}${label(first) ? ` on ${label(first)}` : ''}`, distM: first.len, at: first.coords[0], icon: 'start' })
  for (let i = 1; i < legs.length; i++) {
    const prev = legs[i - 1], cur = legs[i]
    const at = cur.coords[0]
    if (cur.round) {
      // count the exits passed, then name the road you leave on
      let exits = 0
      for (let k = 1; k < cur.nodes.length; k++) {
        const u = cur.nodes[k]
        for (let j = g.adjStart[u]; j < g.adjStart[u + 1]; j++) if (!(flags[g.adjEdge[j]] & F_ROUNDABOUT)) { exits++; break }
      }
      const next = legs[i + 1]
      steps.push({ text: `At the roundabout, take the ${ORD[Math.max(0, Math.min(exits, 5) - 1)] ?? `${exits}th`} exit${next && label(next) ? ` onto ${label(next)}` : ''}`,
        distM: cur.len + (next?.len ?? 0), at, icon: 'roundabout' })
      if (next) i++
      continue
    }
    const d = norm(headingAt(cur.coords, false) - headingAt(prev.coords, true))
    const ad = Math.abs(d), side: -1 | 1 = d < 0 ? -1 : 1
    const lr = side < 0 ? 'left' : 'right'
    const onto = label(cur) ? ` onto ${label(cur)}` : ''
    let text: string, icon: Step['icon']
    if (ad < 11) {
      text = label(cur) ? `Continue onto ${label(cur)}` : 'Continue straight'; icon = 'straight'
      if (!label(cur) && !label(prev)) { steps[steps.length - 1].distM += cur.len; continue }
    } else if (ad < 40) { text = `Bear ${lr}${onto}`; icon = side < 0 ? 'slight-left' : 'slight-right' }
    else if (ad < 103) {
      if (onto) text = `Turn ${lr}${onto}`
      // counting past the third side street is more confusing than helpful
      else { const n = sideCount(prev, side) + 1; text = n > 1 && n <= 3 ? `Take the ${ORD[n - 1]} ${lr}` : `Turn ${lr}` }
      icon = side < 0 ? 'left' : 'right'
    } else if (ad < 160) { text = `Turn sharp ${lr}${onto}`; icon = side < 0 ? 'sharp-left' : 'sharp-right' }
    else { text = 'Make a U-turn'; icon = 'uturn' }
    if (cur.bridge && cur.cls <= 3 && cur.len > 150 && !/flyover|bridge/i.test(label(cur))) text += ' (flyover)'
    steps.push({ text, distM: cur.len, at, icon })
  }
  steps.push({ text: `Arrive at ${destName}`, distM: 0, at: r.coords[r.coords.length - 1], icon: 'arrive' })
  return steps
}

/** "in 200 m" style distance for an instruction. */
export const stepDistance = (m: number) => fmtDistance(m)
