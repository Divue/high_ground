// Live directions: the preview drive, then emulated GPS along the route, then off the route
// (it must plan again from there).   node tests/nav_live.mjs http://127.0.0.1:5173/ ../review/p5-dev/nav
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
const base = process.argv[2] ?? 'http://127.0.0.1:5173/'
const out = process.argv[3] ?? '../review/p5-dev/nav'
mkdirSync(out, { recursive: true })
const b = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['geolocation'], geolocation: { longitude: 80.2195, latitude: 12.9676, accuracy: 10 } })
const p = await ctx.newPage()
const errors = []
p.on('pageerror', (e) => errors.push(String(e)))
await p.goto(base + '?replay=michaung2023&motion=off')
await p.waitForSelector('.readout', { timeout: 90000 })
await p.getByRole('button', { name: 'Take me to dry ground' }).click()
await p.waitForSelector('.go-result:not(.stale)', { timeout: 60000 })
await p.waitForTimeout(1200)
const live = async () => p.$eval('.nav-live', (el) => el.innerText.replace(/\n+/g, ' | ')).catch(() => '(none)')

// 1. preview
await p.getByRole('button', { name: 'Preview the drive' }).click()
await p.waitForTimeout(2500)
console.log('preview t+2.5s:', await live())
await p.screenshot({ path: `${out}/10_preview_a.png` })
await p.waitForTimeout(6000)
console.log('preview t+8.5s:', await live())
await p.screenshot({ path: `${out}/11_preview_b.png` })
await p.getByRole('button', { name: 'End' }).click()

// 2. GPS along the route
const coords = await p.evaluate(() => window.__map.getSource('route-safe').serialize().data.geometry.coordinates)
console.log('route vertices', coords.length)
await p.getByRole('button', { name: 'Start', exact: true }).click()
const n = coords.length
for (const f of [0, 0.15, 0.3, 0.45]) {
  const [lon, lat] = coords[Math.floor(f * (n - 1))]
  await ctx.setGeolocation({ longitude: lon, latitude: lat, accuracy: 8 })
  await p.waitForTimeout(1500)
  console.log(`gps at ${Math.round(f * 100)}%:`, await live())
}
await p.screenshot({ path: `${out}/12_gps.png` })
// 3. off the route: 300 m away, three fixes
const [lon0, lat0] = coords[Math.floor(0.45 * (n - 1))]
for (let k = 0; k < 4; k++) {
  await ctx.setGeolocation({ longitude: lon0 + 0.003, latitude: lat0 + 0.002 + k * 1e-5, accuracy: 8 })
  await p.waitForTimeout(1300)
}
await p.waitForTimeout(3000)
const coords2 = await p.evaluate(() => window.__map.getSource('route-safe').serialize().data.geometry.coordinates)
console.log('after going off route:', await live())
console.log('replanned:', JSON.stringify(coords2[0]) !== JSON.stringify(coords[0]), 'new start', coords2[0])
await p.screenshot({ path: `${out}/13_reroute.png` })
console.log('errors', errors)
await b.close()
