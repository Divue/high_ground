// Repro: open the demo URL, wait for the answer card, click "Tonight" in the replay row -> app goes blank.
import { createRequire } from 'node:module'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; page.on('pageerror', (e) => errs.push(String(e)))
await page.goto('http://127.0.0.1:5173/?replay=michaung2023', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.readout', { timeout: 180000 })
await page.waitForTimeout(2000)
await page.click('.seg.tight button:has-text("Tonight")')
await page.waitForTimeout(2000)
console.log(JSON.stringify({ errors: errs, nav_buttons: await page.locator('nav button').count(), panels: await page.locator('.panel').count(), body_text: (await page.evaluate(() => document.body.innerText)).slice(0, 200) }))
await page.screenshot({ path: '/home/tekiru/Desktop/highground/review/qa/80_crash_after_tonight.png' })
await browser.close()
