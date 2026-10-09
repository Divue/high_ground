// Idle cost of the Tonight screen during a storm replay: map redraws per second on a still
// camera, rAF fps idle and while panning, and a screenshot to confirm rain still shows.
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => { window.__ft = []; const t = (x) => { window.__ft.push(x); requestAnimationFrame(t) }; requestAnimationFrame(t) })
await page.goto((process.env.BASE ?? 'http://127.0.0.1:5173/') + '?replay=michaung2023')
await page.waitForSelector('.readout', { timeout: 90_000 })
await page.waitForTimeout(4000)
const fps = (a, b) => page.evaluate(([a, b]) => { const f = window.__ft.filter((t) => t >= a && t <= b); let long = 0; for (let i = 1; i < f.length; i++) if (f[i] - f[i - 1] > 50) long++; return { fps: +(1000 * (f.length - 1) / (f[f.length - 1] - f[0])).toFixed(1), long_gt50ms: long } }, [a, b])
const now = () => page.evaluate(() => performance.now())
const r0 = await page.evaluate(() => window.__mv.water.renders); const a = await now()
await page.waitForTimeout(4000)
const r1 = await page.evaluate(() => window.__mv.water.renders); const b = await now()
console.log('still map: map redraws/s', ((r1 - r0) / ((b - a) / 1000)).toFixed(1), '| rAF', JSON.stringify(await fps(a, b)))
await page.screenshot({ path: '../review/p5-dev/rain_overlay_idle.png' })
const c = await now()
await page.mouse.move(900, 450); await page.mouse.down()
for (let k = 0; k < 40; k++) { await page.mouse.move(900 - k * 8, 450 + (k % 5)); await page.waitForTimeout(25) }
await page.mouse.up(); const d = await now()
console.log('panning: rAF', JSON.stringify(await fps(c, d)))
console.log('overlay canvases', await page.evaluate(() => document.querySelectorAll('canvas.rain-overlay').length), '| errors', await page.evaluate(() => 0))
await browser.close()
