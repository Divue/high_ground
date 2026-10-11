// 6. Directions sanity over many trips, calling the app's own router + directions in the dev server
// (navigateAsync, the same code GoPanel uses). Checks: instruction points lie on the drawn line, in
// order; left/right agrees with the line's geometry at that point; odd phrasing; distances add up.
import { launch, open, DEV, OUT, sleep, save } from './lib.mjs'
import { readFileSync } from 'node:fs'
const places = JSON.parse(readFileSync('/home/tekiru/Desktop/highground/web/dist/data/places.json', 'utf8')).filter((p) => p[3] === 'street')
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const named = ['Velachery Main Road', 'Arumugam Road', 'Kakkan Nagar Main Road'].map((n) => places.find((p) => p[0] === n))
const T_NAGAR = ['T Nagar (station)', 80.23006, 13.03448]
const origins = [...named.map((p) => [p[0], p[1], p[2]]), T_NAGAR]
while (origins.length < 22) { const p = places[Math.floor(rnd() * places.length)]; if (p[1] > 80.15 && p[1] < 80.30 && p[2] > 12.9 && p[2] < 13.15) origins.push([p[0], p[1], p[2]]) }
const b = await launch()
const { page, log } = await open(b)
await page.goto(DEV + '?replay=michaung2023&motion=off')
await page.waitForSelector('.readout', { timeout: 120000 })
const out = await page.evaluate(async ({ origins }) => {
  const { navigateAsync } = await import('/src/lib/navClient.ts')
  const R = 6371000, rad = Math.PI / 180
  const dist = (a, b) => { const k = Math.cos(((a[1] + b[1]) / 2) * rad); return R * rad * Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) }
  const bear = (a, b) => { const k = Math.cos(a[1] * rad); return Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) / rad }
  const norm = (d) => ((d + 540) % 360) - 180
  const results = []
  const combos = []
  for (const o of origins) for (const mode of ['foot', 'two_wheeler', 'car']) for (const kind of ['parking', 'hospital', 'high'])
    combos.push({ o, mode, kind, mix: [{ run: 'michaung2023', w: 1 }], hour: 30 })
  // a second storm/hour for the named origins
  for (const o of origins.slice(0, 4)) for (const mode of ['two_wheeler', 'car']) for (const kind of ['parking', 'hospital', 'high'])
    combos.push({ o, mode, kind, mix: [{ run: 'dec2015_reservoir', w: 1 }], hour: 8 })
  for (const c of combos) {
    const t0 = performance.now()
    let a
    try { a = await navigateAsync({ from: [c.o[1], c.o[2]], mode: c.mode, kind: c.kind, mix: c.mix, hour: c.hour }) }
    catch (e) { results.push({ o: c.o[0], mode: c.mode, kind: c.kind, err: String(e) }); continue }
    const ms = Math.round(performance.now() - t0)
    const r = a.res
    const row = { o: c.o[0], run: c.mix[0].run, mode: c.mode, kind: c.kind, ms, ok: r.ok, dest: r.dest?.name, startCm: r.startCm, opensAt: r.opensAt,
      lenM: r.route ? Math.round(r.route.lengthM) : null, maxCm: r.route?.maxCm, avoided: r.avoided, nSteps: a.steps.length, issues: [], steps: a.steps.map((s) => s.text) }
    if (r.route) {
      const C = r.route.coords
      const cum = [0]; for (let i = 1; i < C.length; i++) cum.push(cum[i - 1] + dist(C[i - 1], C[i]))
      // start of route vs searched point
      row.startOffM = Math.round(dist([c.o[1], c.o[2]], C[0]))
      let lastIdx = 0
      a.steps.forEach((s, i) => {
        let bi = 0, bd = Infinity
        for (let j = 0; j < C.length; j++) { const d = dist(s.at, C[j]); if (d < bd) { bd = d; bi = j } }
        if (bd > 5) row.issues.push(`step ${i} "${s.text}" is ${Math.round(bd)} m off the line`)
        if (bi < lastIdx) row.issues.push(`step ${i} "${s.text}" is out of order along the line`)
        lastIdx = bi
        const m = /\b(left|right)\b/.exec(s.text)
        if (m && i > 0 && i < a.steps.length - 1 && !/roundabout/.test(s.text)) {
          let j0 = bi; while (j0 > 0 && cum[bi] - cum[j0] < 15) j0--
          let j1 = bi; while (j1 < C.length - 1 && cum[j1] - cum[bi] < 15) j1++
          if (j0 < bi && j1 > bi) {
            const d = norm(bear(C[bi], C[j1]) - bear(C[j0], C[bi]))
            const said = m[1] === 'left' ? -1 : 1
            if (Math.abs(d) > 25 && Math.sign(d) !== said) row.issues.push(`step ${i} says "${s.text}" but the line turns ${d < 0 ? 'left' : 'right'} (${Math.round(d)}°)`)
            if (Math.abs(d) < 8) row.issues.push(`step ${i} says "${s.text}" but the line goes straight (${Math.round(d)}°)`)
          }
        }
        if (/^Continue straight/.test(s.text) || /^Continue onto/.test(s.text)) {
          let j0 = bi; while (j0 > 0 && cum[bi] - cum[j0] < 15) j0--
          let j1 = bi; while (j1 < C.length - 1 && cum[j1] - cum[bi] < 15) j1++
          if (j0 < bi && j1 > bi) { const d = norm(bear(C[bi], C[j1]) - bear(C[j0], C[bi])); if (Math.abs(d) > 45) row.issues.push(`step ${i} "${s.text}" but the line turns ${Math.round(d)}°`) }
        }
        if (/fourth|fifth|th exit/.test(s.text)) row.issues.push(`odd count: "${s.text}"`)
        if (/U-turn/.test(s.text)) row.issues.push(`U-turn: "${s.text}"`)
        if (i > 0 && s.text === a.steps[i - 1].text && !/^(Turn|Take|Bear)/.test(s.text)) row.issues.push(`repeated: "${s.text}"`)
        const prevName = /onto (.+)$|on (.+)$/.exec(a.steps[i - 1]?.text ?? '')
        const curName = /onto (.+)$/.exec(s.text)
        if (i > 0 && prevName && curName && (prevName[1] ?? prevName[2]) === curName[1]) row.issues.push(`same road twice in a row: "${a.steps[i - 1].text}" -> "${s.text}"`)
        if (i > 0 && i < a.steps.length - 1 && s.distM < 20 && a.steps[i + 1] && !/Arrive/.test(a.steps[i + 1].text)) row.tiny = (row.tiny ?? 0) + 1
      })
      const sum = a.steps.reduce((x, s) => x + s.distM, 0)
      if (Math.abs(sum - r.route.lengthM) > Math.max(30, 0.05 * r.route.lengthM)) row.issues.push(`step distances add to ${Math.round(sum)} m, route is ${Math.round(r.route.lengthM)} m`)
      row.stepsPerKm = Math.round((a.steps.length / Math.max(0.2, r.route.lengthM / 1000)) * 10) / 10
    }
    results.push(row)
  }
  return results
}, { origins })
save('t6a_sweep.json', out)
const ok = out.filter((r) => r.ok), nr = out.filter((r) => r.ok === false), er = out.filter((r) => r.err)
console.log('plans', out.length, 'routes', ok.length, 'no-route', nr.length, 'errors', er.length)
console.log('ms: median', ok.concat(nr).map((r) => r.ms).sort((a, b) => a - b)[Math.floor(out.length / 2)], 'max', Math.max(...out.map((r) => r.ms ?? 0)))
const issues = ok.flatMap((r) => r.issues.map((i) => `${r.o} | ${r.run} ${r.mode} ${r.kind}: ${i}`))
console.log('issues', issues.length)
const kinds = {}; for (const i of issues) { const k = i.split(': ').slice(1).join(': ').replace(/".*?"/g, '"…"').replace(/\d+/g, 'N'); kinds[k] = (kinds[k] ?? 0) + 1 }
console.log(JSON.stringify(kinds, null, 1))
console.log(issues.slice(0, 40).join('\n'))
console.log('stepsPerKm max', Math.max(...ok.map((r) => r.stepsPerKm)), 'tiny-step routes', ok.filter((r) => (r.tiny ?? 0) >= 3).length)
console.log('far starts (>150 m from searched point):', ok.filter((r) => r.startOffM > 150).map((r) => `${r.o} ${r.startOffM} m`).slice(0, 10))
console.log('errors', er.slice(0, 5), 'pageErrors', log.pageErrors.slice(0, 5))
await b.close()
