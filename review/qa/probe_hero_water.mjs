// QA probe: hero view of Arumugam Road at the peak hour. Is water drawn at the user's street?
// Same camera at pitch 0, at pitch 62 (the hero camera), and at pitch 62 with MapLibre terrain switched off.
import { createRequire } from 'node:module'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://127.0.0.1:5173/?replay=michaung2023', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.readout', { timeout: 180000 })
await page.fill('.search input', 'Arumugam Road'); await page.waitForSelector('.suggest li')
await page.locator('.suggest li').first().dispatchEvent('mousedown')
await page.waitForSelector('text=/Move your car to/', { timeout: 180000 })
await page.waitForTimeout(6000)
console.log(await page.locator('.readout').getAttribute('aria-label'), await page.locator('.timeline .now').textContent())
const P = [80.2137, 12.9633]
const shots = [['hero_default', null], ['pitch0', { center: P, zoom: 15.2, pitch: 0, bearing: -18 }], ['pitch62', { center: P, zoom: 15.2, pitch: 62, bearing: -18 }], ['pitch62_no_terrain', { center: P, zoom: 15.2, pitch: 62, bearing: -18, noTerrain: true }]]
for (const [name, cam] of shots) {
  if (cam) await page.evaluate((c) => { if (c.noTerrain) window.__map.setTerrain(null); window.__map.jumpTo(c) }, cam)
  await page.waitForTimeout(5000)
  // where is the user's marker on screen, and what colour is under it?
  const px = await page.evaluate((p) => { const q = window.__map.project(p); return [Math.round(q.x), Math.round(q.y)] }, P)
  await page.screenshot({ path: `/home/tekiru/Desktop/highground/review/qa/72_arumugam_${name}.png` })
  console.log(name, 'marker at', px)
}
await browser.close()
