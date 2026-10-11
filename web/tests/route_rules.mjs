// Navigation rules, checked on the real graph and storms (dev server, imports the modules directly):
// a route never uses an edge at or over the mode's limit at the hour it is reached (with the one-hour
// look-ahead), never runs against a one-way street in a vehicle, never uses an underpass in rain;
// "no route" answers quickly. Also times the searches.
//   node tests/route_rules.mjs http://127.0.0.1:5173/
import { chromium } from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:5173/'
const b = await chromium.launch()
const p = await b.newPage()
await p.goto(base + '?motion=off')
const out = await p.evaluate(async () => {
  const nav = await import('/src/lib/nav.ts')
  const data = await nav.loadNav()
  const { g, flags } = data
  const E = g.edges.length / 2
  const runs = [['michaung2023'], ['dec2015_reservoir'], ['design_200_mean', 'design_300_mean']]
  const modes = ['foot', 'two_wheeler', 'car']
  const kinds = ['parking', 'hospital', 'high']
  // deterministic pseudo-random starts inside the city
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const bad = [], times = [], counts = { ok: 0, none: 0 }
  for (let i = 0; i < 36; i++) {
    const mix = runs[i % runs.length].map((run, k, a) => ({ run, w: a.length > 1 ? 0.5 : 1 }))
    const mode = modes[i % 3], kind = kinds[Math.floor(i / 3) % 3]
    const from = [80.18 + rnd() * 0.1, 12.93 + rnd() * 0.17]
    const hour = 1 + Math.floor(rnd() * 20)
    const t0 = performance.now()
    const r = await nav.navigate({ from, mode, kind, mix, hour })
    times.push(Math.round(performance.now() - t0))
    if (!r.ok) { counts.none++; continue }
    counts.ok++
    const d = await nav.Depths.load(mix, E)
    const m = nav.MODES[mode]
    // re-walk the route with its own clock
    let t = 0
    r.route.edges.forEach((e, k) => {
      const u = r.route.nodes[k]
      const hr = hour + t / 3600
      const D = Math.max(d.at(hr)[e], d.at(hr + 1)[e])
      if (D >= m.block) bad.push({ i, rule: 'depth', e, D, block: m.block })
      if (flags[e] & 8) bad.push({ i, rule: 'tunnel', e })
      if (m.oneway) {
        const fwd = g.edges[2 * e] === u
        if ((flags[e] & 1 && !fwd) || (flags[e] & 2 && fwd)) bad.push({ i, rule: 'oneway', e })
      }
      t += g.len[e] / (m.kmh / 3.6)
    })
  }
  times.sort((a, b) => a - b)
  return { bad: bad.slice(0, 10), nbad: bad.length, counts, median_ms: times[times.length >> 1], max_ms: times[times.length - 1] }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
process.exit(out.nbad ? 1 : 0)
