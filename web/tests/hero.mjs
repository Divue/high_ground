// Hero-flow check with Playwright (headless Chromium, software WebGL).
// Usage: node tests/hero.mjs [baseUrl] [outDir]
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:5173/'
const out = process.argv[3] ?? '../review/p5'
const address = process.env.HG_ADDRESS ?? 'Velachery'
fs.mkdirSync(out, { recursive: true })

const gpuArgs = process.env.HG_SWIFTSHADER
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
const browser = await chromium.launch({ channel: process.env.HG_CHANNEL ?? 'chromium', args: gpuArgs })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

const results = {}
page.setDefaultTimeout(60_000)
const step = async (name, fn) => {
  const t0 = Date.now()
  try { await fn(); results[name] = { ok: true, ms: Date.now() - t0 } } catch (e) { results[name] = { ok: false, error: String(e) } }
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 120_000 }).catch((e) => { results[name + '_shot'] = String(e).slice(0, 120) })
}

await step('01_load', async () => {
  await page.goto(base + (process.env.HG_QUERY ?? ''), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.panel.left', { timeout: 90_000 })
})
await step('02_answer_default', async () => {
  await page.waitForSelector('.readout', { timeout: 60_000 })
})
await step('03_search', async () => {
  await page.fill('.search input', address)
  await page.waitForSelector('.suggest li', { timeout: 20_000 })
  await page.click('.suggest li >> nth=0')
  await page.waitForTimeout(6000)
  await page.waitForSelector('.readout', { timeout: 30_000 })
})
await step('04_route', async () => {
  const btn = page.locator('button:has-text("when to leave")').first()
  await btn.click()
  await page.waitForSelector('text=/Move your car to|No dry way out|Leave by|No route to/', { timeout: 90_000 })
  await page.waitForTimeout(1500)
})
await step('05_subscribe', async () => {
  await page.click('button:has-text("Email me if this changes")')
  await page.fill('#email', process.env.HG_EMAIL ?? 'test@example.com')
  if (process.env.HG_SUBMIT) {
    await page.click('button:has-text("Subscribe")')
    await page.waitForSelector('[role=status]', { timeout: 30_000 })
  }
})
// frame rate while the water animates
results.fps = await page.evaluate(() => new Promise((res) => {
  let n = 0
  const t0 = performance.now()
  const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(Math.round(n / 3)) }
  requestAnimationFrame(tick)
}))
for (const [name, hash] of [['06_whatif', 'whatif'], ['07_proof', 'proof'], ['08_hospitals', 'hospitals'], ['09_about', 'about']]) {
  await step(name, async () => {
    await page.evaluate((h) => { window.location.hash = h }, hash)
    await page.waitForTimeout(4500)
  })
}
results.renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2')
  const d = gl?.getExtension('WEBGL_debug_renderer_info')
  return gl ? String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'no webgl2'
})
const answer = await page.evaluate(() => document.querySelector('.readout')?.textContent ?? null)
results.errors = errors.slice(0, 20)
results.answer = answer
fs.writeFileSync(`${out}/hero_results.json`, JSON.stringify(results, null, 1))
console.log(JSON.stringify(results, null, 1))
await browser.close()
const failed = Object.entries(results).filter(([, v]) => v && typeof v === 'object' && 'ok' in v && !v.ok)
process.exit(failed.length ? 1 : 0)
