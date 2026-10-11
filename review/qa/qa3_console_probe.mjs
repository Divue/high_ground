// QA run 3: capture the stack of console.error(Error) calls (Vite's wrapper hides the origin).
import { createRequire } from 'node:module'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', async (m) => {
  if (m.type() !== 'error') return
  const parts = []
  for (const a of m.args()) parts.push(await a.evaluate((e) => (e && e.stack) ? `${e.name}: ${e.message} | ${e.stack.split('\n').slice(0, 6).join(' <- ')}` : JSON.stringify(e)?.slice(0, 300)).catch(() => '?'))
  logs.push({ t: Date.now(), text: m.text(), parts })
})
const t0 = Date.now()
await page.goto('http://127.0.0.1:5173/?replay=michaung2023', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.readout', { timeout: 120_000 })
await page.waitForTimeout(8000)
await page.getByRole('button', { name: 'Watch the whole storm' }).click()
await page.waitForSelector('text=Back to my street', { timeout: 90_000 })
await page.click('text=Back to my street'); await page.waitForTimeout(4000)
for (const q of ['Arumugam Road', 'Madipakkam', 'Anna Nagar']) {
  await page.fill('.search input', q); await page.waitForSelector('.suggest li'); await page.locator('.suggest li').first().dispatchEvent('mousedown'); await page.waitForTimeout(9000)
}
console.log(JSON.stringify(logs.map((l) => ({ s: Math.round((l.t - t0) / 1000), ...l })), null, 1))
await browser.close()
