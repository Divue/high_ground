// node tests/shot.mjs <url> <out.png> [waitMs]
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(process.argv[2])
await page.waitForTimeout(Number(process.argv[4] ?? 16000))
await page.screenshot({ path: process.argv[3], timeout: 120000 })
await browser.close()
