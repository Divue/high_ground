// Records raw demo footage (WebM, 1440x900) following the 3-minute script in CLAUDE.md.
// Usage: node tests/record_demo.mjs <baseUrl> <outDir>
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:5173/'
const out = process.argv[3] ?? '../review/p5/video'
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
const page = await ctx.newPage()
page.setDefaultTimeout(90_000)
const wait = (ms) => page.waitForTimeout(ms)
const typeSlow = async (sel, text) => { await page.click(sel); for (const ch of text) { await page.keyboard.type(ch); await wait(90) } }

// 0:15 load sequence with Cyclone Michaung replayed as tonight
await page.goto(base + '?replay=michaung2023')
await page.waitForSelector('.readout', { timeout: 150_000 })
await wait(4000)
// Tonight flow on a Velachery address
await typeSlow('.search input', process.env.HG_DEMO_ADDRESS ?? 'Velachery')
await page.waitForSelector('.suggest li')
await wait(800)
await page.locator('.suggest li').first().dispatchEvent('mousedown')
await wait(9000)
// scrub the night
const slider = page.locator('.timeline input[type=range]')
const box = await slider.boundingBox()
if (box) {
  for (let f = 0.05; f <= 0.6; f += 0.05) { await page.mouse.click(box.x + box.width * f, box.y + box.height / 2); await wait(450) }
}
await wait(1500)
const routeBtn = page.locator('button:has-text("when to leave")').first()
if (await routeBtn.count()) { await routeBtn.click(); await wait(6000) }
await page.click('button:has-text("Email me if this changes")')
await typeSlow('#email', 'resident@example.com')
await wait(2500)
// What if: drag to 400 mm
await page.click('nav >> text=What if')
await wait(4000)
const r = page.locator('.big-range')
const rb = await r.boundingBox()
if (rb) { for (let f = 0.43; f <= 1.0; f += 0.03) { await page.mouse.click(rb.x + rb.width * f, rb.y + rb.height / 2); await wait(220) } }
await wait(3500)
// Hospitals
await page.click('nav >> text=Hospitals')
await wait(5000)
await page.locator('.hlist li').first().click()
await wait(5000)
// Proof: swipe
await page.click('nav >> text=Proof')
await wait(5000)
const h = await page.locator('.proof-handle').boundingBox()
if (h) {
  await page.mouse.move(h.x + 1, h.y + h.height / 2); await page.mouse.down()
  for (let x = h.x; x > 300; x -= 30) { await page.mouse.move(x, h.y + h.height / 2); await wait(60) }
  for (let x = 300; x < 1150; x += 30) { await page.mouse.move(x, h.y + h.height / 2); await wait(60) }
  await page.mouse.up()
}
await wait(5000)
// About the model
await page.click('nav >> text=About the model')
await wait(6000)
await ctx.close()
await browser.close()
const files = fs.readdirSync(out).filter((f) => f.endsWith('.webm'))
console.log('recorded', files.map((f) => `${out}/${f}`).join(', '))
