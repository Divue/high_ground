// Re-run directions.ts's own side-street count (same code path, copied) for "Take the fifth right" on Ethiraj Salai.
import { launch, open, DEV } from './lib.mjs'
const b = await launch()
const { page } = await open(b)
await page.goto(DEV + '?replay=michaung2023&motion=off')
await page.waitForSelector('.readout', { timeout: 120000 })
const out = await page.evaluate(async () => {
  const nav = await import('/src/lib/nav.ts'), geo = await import('/src/lib/geo.ts'), data = await import('/src/lib/data.ts')
  const N = await nav.loadNav(); const g = N.g
  const p = (await data.loadPlaces()).find((x) => x[0] === 'Ethiraj Salai')
  const r = await nav.navigate({ from: [p[1], p[2]], mode: 'car', kind: 'parking', mix: [{ run: 'michaung2023', w: 1 }], hour: 30 })
  const bearing = (a, b) => { const k = Math.cos((a[1] * Math.PI) / 180); return (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI }
  const norm = (d) => ((d + 540) % 360) - 180
  const headingAt = (coords, fromEnd) => { const pts = fromEnd ? [...coords].reverse() : coords; let acc = 0, j = 1
    for (; j < pts.length; j++) { acc += geo.distM(pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1]); if (acc >= 15) break }
    const a = pts[0], b = pts[Math.min(j, pts.length - 1)]; return fromEnd ? bearing(b, a) : bearing(a, b) }
  const edgeCoords = (e, from) => { const pts = []; for (let k = g.geomOff[e]; k < g.geomOff[e + 1]; k++) pts.push([g.geom[2 * k], g.geom[2 * k + 1]]); if (g.edges[2 * e] !== from) pts.reverse(); return pts }
  // first leg = route edges until the name changes (Ethiraj Salai)
  const rows = []
  for (let i = 1; i < r.route.nodes.length - 1; i++) {
    const u = r.route.nodes[i]
    const inH = headingAt(edgeCoords(r.route.edges[i - 1], r.route.nodes[i - 1]), true)
    const sides = []
    for (let j = g.adjStart[u]; j < g.adjStart[u + 1]; j++) {
      const e = g.adjEdge[j]; if (e === r.route.edges[i - 1] || e === r.route.edges[i]) continue
      sides.push(`${Math.round(norm(headingAt(edgeCoords(e, u), false) - inH))}° cls${g.cls[e]} ${N.names[e] || '(unnamed)'} ${Math.round(g.len[e])} m`)
    }
    rows.push(`node ${i} on ${N.names[r.route.edges[i - 1]] || '(unnamed)'} -> ${N.names[r.route.edges[i]] || '(unnamed)'}: ${sides.join(' | ') || '-'}`)
  }
  return rows
})
console.log(out.join('\n'))
await b.close()
