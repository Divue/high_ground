// Rain must still animate on a still map: two screenshots 150 ms apart should differ only by rain.
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto((process.env.BASE ?? 'http://127.0.0.1:5173/') + '?replay=michaung2023')
await page.waitForSelector('.readout', { timeout: 90_000 })
await page.waitForTimeout(4000)
const clip = { x: 420, y: 160, width: 600, height: 500 }
await page.screenshot({ clip, path: '../review/p5-dev/rain_a.png' })
await page.waitForTimeout(150)
await page.screenshot({ clip, path: '../review/p5-dev/rain_b.png' })
// compare with: python3 tests/rain_diff.py
await page.screenshot({ path: '../review/p5-dev/rain_overlay_closeup.png', clip })
await browser.close()
