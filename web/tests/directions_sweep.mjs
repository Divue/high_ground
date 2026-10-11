// Directions sanity on many trips (dev server): no "fourth/fifth" counts, no back-to-back
// turns a few metres apart, no route through a named subway in rain.
//   node tests/directions_sweep.mjs http://127.0.0.1:5173/
import { chromium } from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:5173/'
const b = await chromium.launch()
const p = await b.newPage()
await p.goto(base + '?motion=off')
const out = await p.evaluate(async () => {
  const nav = await import('/src/lib/nav.ts')
  const { directions } = await import('/src/lib/directions.ts')
  const data = await nav.loadNav()
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const stats = { trips: 0, steps: 0, ordinal4plus: 0, shortTurn: 0, subway: 0, examples: [] }
  const modes = ['foot', 'two_wheeler', 'car'], kinds = ['parking', 'hospital', 'high']
  for (let i = 0; i < 60; i++) {
    const r = await nav.navigate({ from: [80.18 + rnd() * 0.1, 12.93 + rnd() * 0.17], mode: modes[i % 3], kind: kinds[(i / 3 | 0) % 3],
      mix: [{ run: i % 2 ? 'michaung2023' : 'dec2015_reservoir', w: 1 }], hour: 1 + Math.floor(rnd() * 20) })
    if (!r.route) continue
    stats.trips++
    const st = directions(data, r.route, r.dest.name)
    stats.steps += st.length
    st.forEach((s, k) => {
      if (/fourth|fifth/.test(s.text)) stats.ordinal4plus++
      if (k > 0 && k < st.length - 1 && s.distM < 12 && /Turn|Take|Bear/.test(st[k + 1]?.text ?? '')) { stats.shortTurn++; if (stats.examples.length < 4) stats.examples.push(`${s.text} (${Math.round(s.distM)} m) -> ${st[k + 1].text}`) }
    })
    for (const e of r.route.edges) if (/subway|underpass/i.test(data.names[e] ?? '')) stats.subway++
  }
  return stats
})
console.log(JSON.stringify(out, null, 1))
await b.close()
