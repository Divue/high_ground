import { chromium } from '@playwright/test'
const out = process.argv[3]
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const t0 = Date.now()
await page.goto(process.argv[2])
for (const t of (process.env.TIMES ?? '3,6,9,13,18').split(',').map(Number)) {
  await page.waitForTimeout(Math.max(0, t * 1000 - (Date.now() - t0)))
  await page.screenshot({ path: `${out}/opening_${String(t).padStart(2, '0')}s.png`, timeout: 60000 })
}
await browser.close()
