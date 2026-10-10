// Same street from several camera angles: the water should look consistent. Also checks rain is visible.
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
await page.goto('http://127.0.0.1:5173/?replay=michaung2023')
await page.waitForSelector('.readout', { timeout: 90_000 })
await page.waitForTimeout(12000)
const views = [[0, -18], [40, -18], [62, -18], [75, -18], [62, 90], [62, 200]]
for (const [pitch, bearing] of views) {
  await page.evaluate(([p, b]) => window.__map.jumpTo({ pitch: p, bearing: b }), [pitch, bearing])
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `../review/p5-dev/angle_p${pitch}_b${bearing}.png` })
}
console.log(JSON.stringify({ errors }))
await browser.close()
