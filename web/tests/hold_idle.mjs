// Open the replay, wait for the answer card, then hold the page still for HOLD ms.
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto((process.env.BASE ?? 'http://127.0.0.1:5173/') + (process.argv[2] ?? '?replay=michaung2023'))
await page.waitForSelector('.readout', { timeout: 90_000 })
console.log('READY', Date.now())
await page.waitForTimeout(Number(process.env.HOLD ?? 25000))
await browser.close()
