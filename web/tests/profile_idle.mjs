// Profile the main thread while the map sits idle after the answer card appears.
// node tests/profile_idle.mjs [query]   -> prints top self-time functions and rAF fps
import { chromium } from '@playwright/test'
const q = process.argv[2] ?? '?replay=michaung2023'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => { window.__ft = []; const t = (x) => { window.__ft.push(x); requestAnimationFrame(t) }; requestAnimationFrame(t) })
await page.goto('http://127.0.0.1:5173/' + q)
await page.waitForSelector('.readout', { timeout: 90_000 })
await page.waitForTimeout(Number(process.env.SETTLE ?? 3000))
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
const t0 = await page.evaluate(() => performance.now())
await cdp.send('Profiler.start'); await page.waitForTimeout(5000)
const { profile } = await cdp.send('Profiler.stop')
const t1 = await page.evaluate(() => performance.now())
const fps = await page.evaluate(([a, b]) => { const f = window.__ft.filter((t) => t >= a && t <= b); return +(1000 * (f.length - 1) / (f[f.length - 1] - f[0])).toFixed(1) }, [t0, t1])
const byId = new Map(profile.nodes.map((n) => [n.id, n])); const self = new Map()
const dt = profile.timeDeltas; let total = 0
profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0]}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); total += dt[i] ?? 0 })
console.log('rAF fps', fps, '| profiled ms', Math.round(total / 1000))
;[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).forEach(([k, v]) => console.log(String(Math.round(v / 1000)).padStart(6), 'ms ', k.slice(0, 110)))
await browser.close()
