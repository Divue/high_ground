// QA run 4: same as b2_routes.mjs with a larger random sample (4000 candidate places; output b2_routes_<run>_r<N>.json).
// QA run 4, B2: drive the app's own routing code (Vite-served /src modules) for many streets per replay.
// For each place: nearest segment + values (as the card), nearest dry parking (as Tonight), leaveByPlan
// (as the decision), then an exhaustive hour-by-hour check of the "open hours form a prefix" assumption,
// the route's max edge depth at the leave-by hour, and detour ratio vs the normal route.
// Run from web/: node ../review/qa/b2_routes.mjs [runs] ; env QA_RANDOM=40 QA_EXHAUSTIVE=1
import { createRequire } from 'node:module'
import fs from 'node:fs'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const base = 'http://127.0.0.1:5173/'
const out = '/home/tekiru/Desktop/highground/review/qa/run4'
const RUNS = (process.argv[2] ?? 'michaung2023,dec2015_reservoir,fengal2024').split(',')
const NAMED = ['Velachery', 'Pallikaranai', 'Kotturpuram', 'T. Nagar', 'Anna Nagar', 'Arumugam Road', 'Kakkan Nagar Main Road',
  'Dhandeeswaram Nagar 8th', 'Saidapet', 'Madipakkam', 'Adyar',
  // pre==1 (wet before the storm)
  'Alaiamman Koil Street', 'Bounty Acres Rd', 'Brightpathplayschool', 'Kavimani Street', 'Srinivasapuram Road', 'Crematoriam Approach Street',
  'Thiru Nagar', 'AGS Colony Main Road', 'Blackberry Street', 'Link Road', 'Sakthi Nagar Extension', 'Marudupandi Street', 'Beach Road',
  'Karunanidhi Beach Road', 'Ethiraj Salai', 'Khader Nawaz Khan Road', 'Phipps Road', 'Radhakrishnan Aven', 'Tanu Enterprises',
  // not pre but >= 15 cm at hour 1
  'Jayaraman Street', '5th Cross Lane', 'Adam Street', 'Durairaj Nagar', 'St George Gate', 'Uttamar Gandhi Salai', 'ICF Road']
const NRAND = +(process.env.QA_RANDOM ?? 40)
const EXH = process.env.QA_EXHAUSTIVE !== '0'

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)))
await page.goto(`${base}?replay=fengal2024`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
for (const run of RUNS) {
  const t0 = Date.now()
  const res = await page.evaluate(async ({ run, NAMED, NRAND, EXH }) => {
    const R = await import('/src/lib/routing.ts')
    const S = await import('/src/lib/streets.ts')
    const D = await import('/src/lib/data.ts')
    const G = await import('/src/lib/geo.ts')
    const places = await D.loadPlaces()
    const parking = await D.loadParking()
    const g = await R.loadGraph()
    const mix = [{ run, w: 1 }]
    const first = (q) => {
      const ql = q.toLowerCase()
      const rank = ([n, , , kind]) => (n.toLowerCase().startsWith(ql) ? 0 : 2) + (kind === 'street' ? 1 : 0)
      return places.filter(([n]) => n.toLowerCase().includes(ql)).sort((a, b) => rank(a) - rank(b) || a[0].length - b[0].length)[0]
    }
    // seeded random street places
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const streets = places.filter((p) => p[3] === 'street')
    const randoms = Array.from({ length: 4000 }, () => streets[Math.floor(rnd() * streets.length)])
    const tests = [...NAMED.map((q) => ({ q, p: first(q), kind: 'named' })), ...randoms.map((p) => ({ q: p[0], p, kind: 'random' }))]
    const outR = []
    let nRand = 0
    for (const t of tests) {
      if (!t.p) { outR.push({ q: t.q, missing: true }); continue }
      if (t.kind === 'random' && nRand >= NRAND) continue
      const [name, lon, lat] = t.p
      const seg = await S.nearestSegment(lon, lat)
      if (!seg || seg.distanceM > 600) { outR.push({ q: t.q, kind: t.kind, noseg: true }); continue }
      const a = await S.segmentValues(seg, mix)
      if (t.kind === 'random' && !a.hoursTo15) continue
      if (t.kind === 'random') nRand++
      const flags = parking.dry[run] ?? []
      const opts = parking.candidates.map((c, i) => ({ ...c, d: G.distM(lon, lat, c.lon, c.lat), ok: flags[i] === 1 }))
        .filter((c) => c.ok).sort((x, y) => x.d - y.d).filter((c, i, arr) => arr.findIndex((o) => o.name === c.name) === i).slice(0, 3)
      const r = { q: t.q, kind: t.kind, lon, lat, street: seg.name, seg: seg.id, segDist: Math.round(seg.distanceM), max: a.maxCm, t15: a.hoursTo15, peakH: a.peakHour,
        pre: a.preWet, h1: a.seriesCm[0], parking: opts.map((o) => `${o.name} (${o.kind}) ${Math.round(o.d)} m`) }
      if (a.hoursTo15 && opts.length) {
        const until = Math.max(1, a.hoursTo15 - 1)
        const p0 = performance.now()
        const plan = await R.leaveByPlan([lon, lat], [opts[0].lon, opts[0].lat], mix, until, 30)
        r.plan_ms = Math.round(performance.now() - p0)
        r.until = until
        r.leaveBy = plan.leaveByHour
        r.normal_m = plan.normal ? Math.round(plan.normal.lengthM) : null
        r.safe_m = plan.route ? Math.round(plan.route.lengthM) : null
        r.ratio = plan.normal && plan.route ? +(plan.route.lengthM / Math.max(1, plan.normal.lengthM)).toFixed(2) : null
        r.ui = plan.route && plan.leaveByHour ? `Move your car to ${opts[0].name} by hour ${plan.leaveByHour}` : `No dry way out to ${opts[0].name} before your street floods.`
        r.leave_ge_t15 = plan.leaveByHour != null && plan.leaveByHour >= a.hoursTo15
        if (plan.route) {
          const dl = await R.edgeDepthAtHour(g, mix, plan.leaveByHour)
          r.route_max_edge_cm_at_leave = Math.max(0, ...plan.route.edges.map((e) => dl[e]))
          const dpk = await R.edgeDepthAtHour(g, mix, a.peakHour ?? a.hoursTo15)
          r.route_edges_ge30_at_peak = plan.route.edges.filter((e) => dpk[e] >= 30).length
          if (!plan.route.coords.length) { r.zero_length_route = true } else {
          const s0 = plan.route.coords[0]
          r.route_start_from_place_m = Math.round(G.distM(lon, lat, s0[0], s0[1]))
          const e0 = plan.route.coords[plan.route.coords.length - 1]
          r.route_end_from_parking_m = Math.round(G.distM(opts[0].lon, opts[0].lat, e0[0], e0[1]))
          }
        }
        if (plan.normal) {
          const d15 = await R.edgeDepthAtHour(g, mix, a.hoursTo15)
          r.normal_edges_ge30_at_t15 = plan.normal.edges.filter((e) => d15[e] >= 30).length
        }
        if (EXH) {
          // ground truth: is a (non-absurd) route open at each hour 1..until?
          const s = R.nearestNode(g, lon, lat), tt = R.nearestNode(g, opts[0].lon, opts[0].lat)
          const normal = plan.normal
          const open = []
          for (let h = 1; h <= until; h++) {
            const dep = await R.edgeDepthAtHour(g, mix, h)
            const rr = R.astar(g, s, tt, dep, 30)
            const ok = !!rr && !(normal && rr.lengthM > Math.max(3 * normal.lengthM, normal.lengthM + 4000))
            open.push(ok ? 1 : 0)
          }
          const lastOpen = open.lastIndexOf(1) + 1 || null
          r.open_hours = open.join('')
          r.true_last_open = lastOpen
          r.prefix_ok = lastOpen === plan.leaveByHour
          // with the street's 15 cm hour as the deadline the user can't leave later than until anyway
        }
      }
      outR.push(r)
    }
    return outR
  }, { run, NAMED, NRAND, EXH })
  fs.writeFileSync(`${out}/b2_routes_${run}_r${NRAND}.json`, JSON.stringify(res, null, 1))
  const withPlan = res.filter((r) => r.until)
  console.log(run, `${Math.round((Date.now() - t0) / 1000)} s`, 'tested', res.length, 'with plan', withPlan.length,
    'no-route', withPlan.filter((r) => r.leaveBy == null).length, 'leave>=t15', withPlan.filter((r) => r.leave_ge_t15).length,
    'prefix-wrong', withPlan.filter((r) => r.prefix_ok === false).length, 'ratio>2', withPlan.filter((r) => r.ratio > 2).length)
}
await browser.close()
