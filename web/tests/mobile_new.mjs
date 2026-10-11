// Phone-size check of the offline and navigation UI (390x844).
import { chromium, devices } from '@playwright/test'
import { mkdirSync } from 'node:fs'
const base = process.argv[2] ?? 'http://127.0.0.1:5173/'
const out = process.argv[3] ?? '../review/p5-dev/mobile_new'
mkdirSync(out, { recursive: true })
const b = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } })
const p = await ctx.newPage()
const errors = []
p.on('pageerror', (e) => errors.push(String(e)))
await p.goto(base + '?replay=michaung2023&motion=off')
await p.waitForSelector('.readout', { timeout: 90000 })
await p.waitForTimeout(1500)
await p.screenshot({ path: `${out}/01_card.png` })
await p.getByRole('button', { name: 'Take me to dry ground' }).click()
await p.waitForSelector('.go-result:not(.stale)', { timeout: 60000 })
await p.waitForTimeout(1500)
await p.screenshot({ path: `${out}/02_go.png` })
await p.getByRole('button', { name: 'Preview the drive' }).click()
await p.waitForTimeout(3000)
await p.screenshot({ path: `${out}/03_live.png` })
await p.getByRole('button', { name: 'End' }).click()
await p.getByRole('button', { name: 'Help numbers' }).click()
await p.waitForTimeout(500)
await p.screenshot({ path: `${out}/04_help.png` })
await p.locator('.sheet').getByRole('button', { name: 'Close' }).click()
await p.getByRole('button', { name: 'My flood plan' }).click()
await p.waitForSelector('.plan-img', { timeout: 20000 })
await p.waitForTimeout(500)
await p.screenshot({ path: `${out}/05_plan.png` })
console.log('errors', errors)
await b.close()
