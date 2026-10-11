// QA run 3: attribute the opening's long tasks (CDP CPU profile) and bisect the GPU cost of panning by layer.
// Run from web/: node ../review/qa/qa3_profile.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const out = '/home/tekiru/Desktop/highground/review/qa/run3'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(120_000)
await page.addInitScript(() => {
  window.__ft = []; const tick = (t) => { window.__ft.push(t); requestAnimationFrame(tick) }; requestAnimationFrame(tick)
  window.__lt = []
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]) }).observe({ type: 'longtask', buffered: true }) } catch {}
  window.__ev = {}
  const hook = setInterval(() => { if (window.__map) { clearInterval(hook); window.__map.once('load', () => { window.__ev.map_load = performance.now() }); window.__map.once('idle', () => { window.__ev.map_first_idle = performance.now() }); window.__map.once('render', () => { window.__ev.map_first_render = performance.now() }) } }, 2)
})
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
await cdp.send('Profiler.start')
await page.goto('http://127.0.0.1:5173/?replay=michaung2023', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => (document.querySelector('.readout')?.getAttribute('aria-label') ?? '').includes('at the peak'), null, { timeout: 120_000 })
const { profile } = await cdp.send('Profiler.stop')
const R = {}
R.events = await page.evaluate(() => ({ ...Object.fromEntries(Object.entries(window.__ev).map(([k, v]) => [k, Math.round(v)])), card: Math.round(performance.now()) }))
R.long_tasks = await page.evaluate(() => window.__lt)
// self time per function
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
const dt = profile.timeDeltas
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i])
  const f = n.callFrame
  const key = `${f.functionName || '(anon)'} ${f.url.replace(/^.*\/(node_modules\/\.vite\/deps\/|src\/)/, '$1').split('?')[0]}:${f.lineNumber}`
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000)
}
R.top_self_ms = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${Math.round(v)} ms  ${k}`)
// by file
const byFile = new Map()
for (const [k, v] of self) { const file = k.split(' ').slice(1).join(' ').split(':')[0] || '(native)'; byFile.set(file, (byFile.get(file) ?? 0) + v) }
R.by_file_ms = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${Math.round(v)} ms  ${k}`)
console.log(JSON.stringify(R, null, 1))

// ---------------------------------------------------------------- GPU bisect while panning (street view)
await page.waitForTimeout(8000)
const fpsPan = async () => {
  const a = await page.evaluate(() => performance.now())
  await page.mouse.move(1000, 500); await page.mouse.down()
  for (let k = 0; k < 70; k++) { await page.mouse.move(1000 - 250 * Math.sin(k / 12), 500 + 100 * Math.sin(k / 9)); await page.waitForTimeout(35) }
  await page.mouse.up()
  const b = await page.evaluate(() => performance.now())
  return page.evaluate(([a, b]) => { const f = window.__ft.filter((t) => t >= a && t <= b); const d = []; for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]); d.sort((x, y) => x - y); return { fps: +(1000 * (f.length - 1) / (f[f.length - 1] - f[0])).toFixed(1), p50: +d[d.length >> 1].toFixed(1) } }, [a, b])
}
const set = (fn) => page.evaluate(fn)
R.bisect = {}
R.bisect.all = await fpsPan()
await set(() => window.__map.setLayoutProperty('flood-water', 'visibility', 'none')); R.bisect.no_water = await fpsPan()
await set(() => window.__map.setLayoutProperty('flood-water', 'visibility', 'visible'))
await set(() => window.__map.setLayoutProperty('buildings-3d', 'visibility', 'none')); R.bisect.no_buildings = await fpsPan()
await set(() => window.__map.setTerrain(null)); R.bisect.no_buildings_no_terrain = await fpsPan()
await set(() => window.__map.setLayoutProperty('buildings-3d', 'visibility', 'visible')); R.bisect.no_terrain = await fpsPan()
await set(() => window.__map.setLayoutProperty('flood-water', 'visibility', 'none')); R.bisect.no_terrain_no_water = await fpsPan()
await set(() => { window.__map.setLayoutProperty('buildings-3d', 'visibility', 'none') }); R.bisect.basemap_only = await fpsPan()
await set(() => { window.__map.setLayoutProperty('flood-water', 'visibility', 'visible'); window.__map.setLayoutProperty('buildings-3d', 'visibility', 'visible'); window.__map.setTerrain({ source: 'terrain', exaggeration: 1.5 }) })
await set(() => window.__mv.water.setRain(0)); await page.waitForTimeout(2000); R.bisect.all_rain_off = await fpsPan()
R.layers = await page.evaluate(() => window.__map.getStyle().layers.map((l) => l.id).join(','))
R.pixel_ratio = await page.evaluate(() => [window.devicePixelRatio, window.__map.getPixelRatio()])
console.log(JSON.stringify(R.bisect, null, 1))
fs.writeFileSync(`${out}/qa3_profile.json`, JSON.stringify(R, null, 1))
await browser.close()
