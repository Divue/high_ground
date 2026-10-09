// Design critic round 2. node review/design/r2_capture.mjs <WxH> <prefix>
import { createRequire } from 'node:module'
const require = createRequire('/home/tekiru/Desktop/highground/web/package.json')
const { chromium } = require('@playwright/test')
const [vw, vh] = (process.argv[2] ?? '1440x900').split('x').map(Number)
const pre = process.argv[3] ?? String(vw)
const out = '/home/tekiru/Desktop/highground/review/design/r2'
const base = 'http://127.0.0.1:5173/'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: vw, height: vh } })
page.setDefaultTimeout(90_000)
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const shot = (n) => page.screenshot({ path: `${out}/${pre}_${n}.png`, timeout: 120_000 }).catch((e) => console.log('shot fail', n, String(e).slice(0, 100)))
const t0 = Date.now()
await page.goto(base + '?replay=michaung2023', { waitUntil: 'domcontentloaded' })
for (const t of [3, 8, 14, 18]) {
  await page.waitForTimeout(Math.max(0, t * 1000 - (Date.now() - t0)))
  await shot(`01_load_${String(t).padStart(2, '0')}s`)
}
await page.waitForSelector('.readout').catch(() => {})
await page.waitForTimeout(Math.max(0, 26000 - (Date.now() - t0)))
await shot('02_tonight_velachery_26s')
const card = page.locator('.panel.left').first()
await card.screenshot({ path: `${out}/${pre}_02b_card_velachery.png` }).catch(() => {})
// search
await page.click('.search input')
await page.keyboard.type('Arumugam Road', { delay: 60 })
await page.waitForTimeout(1500)
await shot('03_suggest')
await page.keyboard.press('ArrowDown')
await page.keyboard.press('Enter')
await page.waitForTimeout(4000)
await shot('04_arumugam_mid')
await page.waitForTimeout(10000)
await shot('04_arumugam')
await card.screenshot({ path: `${out}/${pre}_04b_card_arumugam.png` }).catch(() => {})
// what if
await page.evaluate(() => { window.location.hash = 'whatif' })
await page.waitForTimeout(4000)
await shot('05_whatif_200')
await page.focus('.big-range')
await page.keyboard.press('End')
await page.waitForTimeout(5000)
await shot('06_whatif_400')
for (const [n, h] of [['07_proof', 'proof'], ['08_hospitals', 'hospitals'], ['09_about', 'about']]) {
  await page.evaluate((x) => { window.location.hash = x }, h)
  await page.waitForTimeout(6000)
  await shot(n)
}
console.log(JSON.stringify({ pre, total_s: Math.round((Date.now() - t0) / 1000), errors: errors.slice(0, 10) }))
await browser.close()
