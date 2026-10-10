// Offline gate: save a street for offline, cut the network, reload, and check HighGround still
// opens and answers from the phone. Run against the production build (the service worker is
// only registered there):  node tests/offline.mjs http://127.0.0.1:4173/ ../review/p5-dev/offline
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:4173/'
const out = process.argv[3] ?? '../review/p5-dev/offline'
mkdirSync(out, { recursive: true })
const url = `${base}?replay=michaung2023&motion=off`
const results = []
const step = async (name, fn) => {
  const t0 = Date.now()
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('OK  ', name, Date.now() - t0, 'ms') }
  catch (e) { results.push({ name, ok: false, err: String(e).slice(0, 300) }); console.log('FAIL', name, String(e).slice(0, 300)) }
}

const browser = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await step('first load registers the service worker', async () => {
  await page.goto(url)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()           // now the page is controlled by the worker
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
})
await step('answer card appears online', async () => {
  await page.waitForSelector('.readout', { timeout: 60000 })
})
await step('save for offline completes', async () => {
  await page.getByRole('button', { name: 'Save for offline' }).click()
  await page.waitForSelector('text=Saved for offline', { timeout: 180000 })
  await page.screenshot({ path: `${out}/01_saved.png` })
})
const usage = await page.evaluate(async () => {
  const names = await caches.keys()
  const out = {}
  for (const n of names) out[n] = (await (await caches.open(n)).keys()).length
  const e = await navigator.storage.estimate()
  return { caches: out, usageMB: Math.round(e.usage / 1e5) / 10 }
})
console.log('storage', JSON.stringify(usage))

await step('offline reload opens the app', async () => {
  await ctx.setOffline(true)
  await page.reload()
  await page.waitForSelector('.readout', { timeout: 60000 })
  await page.waitForSelector('.offline-chip', { timeout: 15000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${out}/02_offline_card.png` })
})
await step('offline: low-power map draws streets by depth', async () => {
  const n = await page.evaluate(() => {
    const m = window.__map
    return m.querySourceFeatures('depth-streets').length
  })
  if (!n) throw new Error('no depth streets drawn')
  console.log('     depth-street features', n)
})
await step('offline: basemap tiles come from the saved pack', async () => {
  const ok = await page.evaluate(() => window.__map.isSourceLoaded('protomaps'))
  if (!ok) throw new Error('basemap source not loaded')
})
await step('offline: flood plan draws', async () => {
  await page.getByRole('button', { name: 'My flood plan' }).click()
  await page.waitForSelector('.plan-img', { timeout: 20000 })
  await page.screenshot({ path: `${out}/03_plan.png` })
  const src = await page.$eval('.plan-img', (i) => i.src)
  const b = await page.evaluate(async (s) => (await (await fetch(s)).blob()).size, src)
  console.log('     plan image bytes', b)
  await page.getByRole('button', { name: 'Close' }).click()
})
await step('offline: help numbers', async () => {
  await page.getByRole('button', { name: 'Help numbers' }).click()
  await page.waitForSelector('.numbers a[href="tel:112"]')
  await page.screenshot({ path: `${out}/04_help.png` })
  await page.getByRole('button', { name: 'Close' }).click()
})
await step('offline: search a saved-area street', async () => {
  const box = page.getByRole('combobox').or(page.locator('input[type=search], .search input')).first()
  await box.fill('Velachery Main Road')
  await page.waitForTimeout(800)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(4000)
  await page.screenshot({ path: `${out}/05_search_offline.png` })
})
await ctx.setOffline(false)
console.log('page errors', errors.length, errors.slice(0, 3))
console.log(JSON.stringify({ ok: results.every((r) => r.ok), results, usage }, null, 1))
await browser.close()
process.exit(results.every((r) => r.ok) ? 0 : 1)
