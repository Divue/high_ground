// Production preview: load timing, the opening flight, rain, errors.
import { chromium } from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:4173/'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
const t0 = Date.now()
await page.goto(base + '?replay=michaung2023')
const cam = []
let card = null
for (let i = 0; i < 24 && card === null; i++) {
  await page.waitForTimeout(500)
  cam.push(await page.evaluate(() => window.__map ? +window.__map.getZoom().toFixed(1) : null))
  if (await page.locator('.readout').count()) card = Date.now() - t0
}
await page.waitForTimeout(6000)
await page.screenshot({ path: '../review/p5-dev/prod_hero.png' })
console.log(JSON.stringify({ card_ms: card, zoom_every_500ms: cam, errors }))
await browser.close()
