// Detail for odd directions: step distances, the real turn angle at each step, and for "Take the Nth"
// the side roads that were counted (with their road class: 5 = service, e.g. driveways/parking aisles).
import { launch, open, DEV, OUT, save } from './lib.mjs'
const trips = [
  ['Chari Avenue', 'two_wheeler', 'parking'], ['Velachery Main Road', 'two_wheeler', 'parking'], ['T Nagar', 'foot', 'parking'],
  ['Ethiraj Salai', 'car', 'parking'], ['Kakkan Nagar Main Road', 'two_wheeler', 'hospital'], ['SINGARA GARDEN 8TH STREET', 'two_wheeler', 'parking'],
]
const b = await launch()
const { page } = await open(b)
await page.goto(DEV + '?replay=michaung2023&motion=off')
await page.waitForSelector('.readout', { timeout: 120000 })
const out = await page.evaluate(async ({ trips }) => {
  const nav = await import('/src/lib/nav.ts'), dir = await import('/src/lib/directions.ts'), data = await import('/src/lib/data.ts')
  const places = await data.loadPlaces()
  const N = await nav.loadNav(); const g = N.g
  const R = 6371000, rad = Math.PI / 180
  const dist = (a, b) => { const k = Math.cos(((a[1] + b[1]) / 2) * rad); return R * rad * Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) }
  const bear = (a, b) => { const k = Math.cos(a[1] * rad); return Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) / rad }
  const norm = (d) => ((d + 540) % 360) - 180
  const res = []
  for (const [name, mode, kind] of trips) {
    const p = places.find((x) => x[0] === name || x[0] === (name === 'T Nagar' ? 'T Nagar' : name))
    const r = await nav.navigate({ from: [p[1], p[2]], mode, kind, mix: [{ run: 'michaung2023', w: 1 }], hour: 30 })
    if (!r.route) { res.push({ name, mode, kind, noRoute: true }); continue }
    const steps = dir.directions(N, r.route, r.dest.name)
    const C = r.route.coords; const cum = [0]; for (let i = 1; i < C.length; i++) cum.push(cum[i - 1] + dist(C[i - 1], C[i]))
    const rows = steps.map((s, i) => {
      let bi = 0, bd = Infinity; for (let j = 0; j < C.length; j++) { const d = dist(s.at, C[j]); if (d < bd) { bd = d; bi = j } }
      let j0 = bi; while (j0 > 0 && cum[bi] - cum[j0] < 15) j0--
      let j1 = bi; while (j1 < C.length - 1 && cum[j1] - cum[bi] < 15) j1++
      const ang = j0 < bi && j1 > bi ? Math.round(norm(bear(C[bi], C[j1]) - bear(C[j0], C[bi]))) : null
      // for "Take the Nth": node at the step, and the route nodes before it on the previous leg
      return `${String(Math.round(cum[bi])).padStart(5)} m  ${s.text}  [next ${Math.round(s.distM)} m, line turns ${ang}°]`
    })
    // side roads counted for each "Take the Nth" step: walk the route nodes back to the previous step
    const sideInfo = []
    steps.forEach((s, i) => {
      const m = /Take the (\w+) (left|right)/.exec(s.text); if (!m) return
      const side = m[2] === 'left' ? -1 : 1
      const atNode = r.route.nodes.findIndex((n) => Math.abs(g.nodes[2 * n] - s.at[0]) < 1e-6 && Math.abs(g.nodes[2 * n + 1] - s.at[1]) < 1e-6)
      const prevAt = steps[i - 1].at
      const startNode = r.route.nodes.findIndex((n) => Math.abs(g.nodes[2 * n] - prevAt[0]) < 1e-6 && Math.abs(g.nodes[2 * n + 1] - prevAt[1]) < 1e-6)
      const counted = []
      for (let k = Math.max(1, startNode + 1); k < atNode; k++) {
        const u = r.route.nodes[k], ein = r.route.edges[k - 1], eout = r.route.edges[k]
        const inH = bear([g.nodes[2 * r.route.nodes[k - 1]], g.nodes[2 * r.route.nodes[k - 1] + 1]], [g.nodes[2 * u], g.nodes[2 * u + 1]])
        for (let j = g.adjStart[u]; j < g.adjStart[u + 1]; j++) {
          const e = g.adjEdge[j]; if (e === ein || e === eout) continue
          const v = g.adjNode[j]
          const d = norm(bear([g.nodes[2 * u], g.nodes[2 * u + 1]], [g.nodes[2 * v], g.nodes[2 * v + 1]]) - inH)
          if (side * d > 30 && side * d < 150) { counted.push(`cls ${g.cls[e]} ${N.names[e] || '(unnamed)'} ${Math.round(g.len[e])} m`); break }
        }
      }
      sideInfo.push({ step: s.text, counted })
    })
    res.push({ name, mode, kind, dest: r.dest.name, len: Math.round(r.route.lengthM), rows, sideInfo })
  }
  return res
}, { trips })
save('t6b_detail.json', out)
for (const t of out) {
  console.log(`\n=== ${t.name} | ${t.mode} -> ${t.kind}: ${t.dest} ${t.len} m`)
  if (t.rows) console.log(t.rows.join('\n'))
  for (const s of t.sideInfo ?? []) console.log(`   "${s.step}" counted: ${s.counted.join('; ')}`)
}
await b.close()
