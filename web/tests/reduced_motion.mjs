// A device that asks for reduced motion (like GNOME with animations off): the offer appears,
// "Play animations" turns everything on (rain, flight), and the choice is remembered.
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
const page = await ctx.newPage()
const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
await page.goto('http://127.0.0.1:5173/?replay=michaung2023')
await page.waitForSelector('.motion-offer', { timeout: 30_000 })
await page.screenshot({ path: '../review/p5-dev/motion_offer.png' })
await page.click('text=Play animations')
await page.waitForLoadState('load')
const t0 = Date.now()
const camera = []
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(1500)
  camera.push(await page.evaluate(() => window.__map ? { z: +window.__map.getZoom().toFixed(2), p: Math.round(window.__map.getPitch()) } : null))
}
const offerGone = !(await page.locator('.motion-offer').count())
const reduced = await page.evaluate(() => document.documentElement.classList.contains('reduce-motion'))
await page.screenshot({ path: '../review/p5-dev/motion_on.png' })
console.log(JSON.stringify({ offerGone, reduced, camera, ms: Date.now() - t0, errors }))
await browser.close()
