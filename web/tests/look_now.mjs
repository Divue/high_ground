// Hero view + console errors + two frames 300 ms apart (does the water move?) + fps while flowing.
import { chromium } from '@playwright/test'
const q = process.argv[2] ?? '?replay=michaung2023'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 300)}`) })
await page.addInitScript(() => { window.__ft = []; const t = (x) => { window.__ft.push(x); requestAnimationFrame(t) }; requestAnimationFrame(t) })
await page.goto('http://127.0.0.1:5173/' + q)
await page.waitForSelector('.readout', { timeout: 90_000 }).catch(() => errors.push('no readout'))
await page.waitForTimeout(12000)
await page.screenshot({ path: '../review/p5-dev/look_hero.png' })
const a = await page.evaluate(() => performance.now()); const r0 = await page.evaluate(() => window.__mv.water.renders)
await page.waitForTimeout(4000)
const b = await page.evaluate(() => performance.now()); const r1 = await page.evaluate(() => window.__mv.water.renders)
const fps = await page.evaluate(([a, b]) => { const f = window.__ft.filter((t) => t >= a && t <= b); return +(1000 * (f.length - 1) / (f[f.length - 1] - f[0])).toFixed(1) }, [a, b])
console.log(JSON.stringify({ map_redraws_per_s: +((r1 - r0) / ((b - a) / 1000)).toFixed(1), raf_fps: fps, errors: errors.slice(0, 8) }))
await browser.close()
