// node tests/shot.mjs <url> <out.png> [waitMs]
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const [vw, vh] = (process.env.HG_VIEW ?? '1440x900').split('x').map(Number)
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: process.env.HG_VIEW ? 2 : 1 })
await page.goto(process.argv[2])
await page.waitForTimeout(Number(process.argv[4] ?? 16000))
await page.screenshot({ path: process.argv[3], timeout: 120000 })
await browser.close()
