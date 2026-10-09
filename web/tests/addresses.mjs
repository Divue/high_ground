// Hero flow on five Chennai addresses: search -> fly -> answer card with depth + parking.
// Usage: node tests/addresses.mjs <baseUrl> <outDir>   (HG_QUERY='?replay=michaung2023' to replay a storm)
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:5173/'
const out = process.argv[3] ?? '../review/p5'
const query = process.env.HG_QUERY ?? '?replay=michaung2023'
const ADDRESSES = (process.env.HG_ADDRESSES ?? 'Velachery|T. Nagar|Saidapet|Pallikaranai|Mylapore').split('|')
fs.mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(60_000)
await page.goto(base + query)
await page.waitForSelector('.panel.left', { timeout: 120_000 })
const results = []
for (const [i, addr] of ADDRESSES.entries()) {
  const r = { address: addr }
  try {
    await page.fill('.search input', '')
    await page.fill('.search input', addr)
    await page.waitForSelector('.suggest li', { timeout: 30_000 })
    r.picked = await page.locator('.suggest li').first().textContent()
    await page.locator('.suggest li').first().dispatchEvent('mousedown')
    await page.waitForTimeout(7000)
    r.street = await page.locator('.street').first().textContent({ timeout: 20_000 })
    r.depth = await page.locator('.readout').first().getAttribute('aria-label')
    r.when = await page.locator('.when').first().textContent()
    r.band = await page.locator('.band').first().textContent()
    r.parking = (await page.locator('.park b').allTextContents()).slice(0, 2)
    r.ok = !!(r.street && r.depth)
  } catch (e) { r.ok = false; r.error = String(e).slice(0, 200) }
  await page.screenshot({ path: `${out}/address_${i + 1}.png`, timeout: 120_000 }).catch(() => {})
  results.push(r)
  console.log(JSON.stringify(r))
}
fs.writeFileSync(`${out}/addresses_results.json`, JSON.stringify(results, null, 1))
await browser.close()
process.exit(results.every((r) => r.ok) ? 0 : 1)
