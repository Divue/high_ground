import { chromium } from '@playwright/test'
const out = process.argv[3] ?? '/tmp'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
await page.goto((process.argv[2] ?? 'http://127.0.0.1:5173/') + '#proof')
await page.waitForSelector('.strip', { timeout: 120000 })
await page.waitForTimeout(5000)
await page.screenshot({ path: `${out}/proof_split.png`, timeout: 120000 })
await page.click('button:has-text("Detail: ANUGA")')
await page.waitForTimeout(4000)
await page.screenshot({ path: `${out}/proof_anuga.png`, timeout: 120000 })
await page.click('button:has-text("Detail: fast model")')
await page.waitForTimeout(3000)
await page.screenshot({ path: `${out}/proof_fast.png`, timeout: 120000 })
console.log('errors', errs)
await browser.close()
