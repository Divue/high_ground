// (a) roads named Subway/Underpass: are they flagged as tunnels (closed in rain, never "high ground")?
// (b) card depth vs the route's own depth at the start, same street, same hour.
import { launch, open, DEV } from './lib.mjs'
const b = await launch()
const { page } = await open(b)
await page.goto(DEV + '?replay=michaung2023&motion=off')
await page.waitForSelector('.readout', { timeout: 120000 })
const out = await page.evaluate(async () => {
  const nav = await import('/src/lib/nav.ts'), streets = await import('/src/lib/streets.ts'), data = await import('/src/lib/data.ts')
  const N = await nav.loadNav(); const g = N.g
  const E = g.edges.length / 2
  const sub = { named: 0, flagged: 0, examples: new Set() }
  for (let e = 0; e < E; e++) if (/subway|underpass/i.test(N.names[e] || '')) { sub.named++; if (N.flags[e] & nav.F_TUNNEL) sub.flagged++; else sub.examples.add(N.names[e]) }
  const places = await data.loadPlaces()
  const mix = [{ run: 'michaung2023', w: 1 }]
  const D = await nav.Depths.load(mix, E)
  const rows = []
  for (const name of ['Velachery Main Road', 'Arumugam Road', 'Kakkan Nagar Main Road']) {
    const p = places.find((x) => x[0] === name)
    const seg = await streets.nearestSegment(p[1], p[2])
    const ans = await streets.segmentValues(seg, mix)
    const h = ans.peakHour
    const r = await nav.navigate({ from: [p[1], p[2]], mode: 'two_wheeler', kind: 'parking', mix, hour: h })
    const first = r.route ? r.route.edges.slice(0, 3).map((e) => `${N.names[e] || '(unnamed)'} ${Math.round(Math.max(D.at(h)[e], D.at(h + 1)[e]))} cm`) : []
    rows.push({ name, card: `${seg.name}: ${ans.seriesCm[h - 1]} cm at hour ${h} (peak ${ans.maxCm})`, nav: `startCm ${r.startCm}, ok ${r.ok}, max on route ${r.route?.maxCm}, first edges: ${first.join(', ')}` })
  }
  return { sub: { ...sub, examples: [...sub.examples].slice(0, 12) }, rows }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
