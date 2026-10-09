// Repro: stale street JSON — readout (max) disagrees with the hourly series the timeline shows.
import { createRequire } from 'node:module'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
for (const run of ['fengal2024', 'michaung2023']) {
  await page.goto(`http://127.0.0.1:5173/?replay=${run}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.readout', { timeout: 180000 })
  await page.fill('.search input', 'Loop Road'); await page.waitForSelector('.suggest li')
  const sugg = await page.locator('.suggest li').allTextContents()
  await page.locator('.suggest li', { hasText: /^Loop Road, Chennai$/ }).first().dispatchEvent('mousedown')
  await page.waitForFunction(() => document.querySelector('.street')?.textContent === 'Loop Road', null, { timeout: 60000 })
  await page.waitForFunction(() => { const d = document.querySelector('.decision'); return !d || (d.textContent && !d.textContent.includes('Working')) }, null, { timeout: 180000 }).catch(() => {})
  await page.waitForTimeout(4000)
  const r = await page.evaluate(() => {
    const sm = [...document.querySelectorAll('.panel.left .small')].map((e) => e.textContent.trim())
    return { readout: document.querySelector('.readout').getAttribute('aria-label'), when: document.querySelector('.when').textContent, band: document.querySelector('.band').textContent,
      decision: document.querySelector('.decision')?.textContent ?? null, at: sm.find((s) => s.startsWith('At ')), now: document.querySelector('.timeline .now').textContent }
  })
  console.log(run, JSON.stringify(sugg.slice(0, 3)), JSON.stringify(r))
  await page.screenshot({ path: `/home/tekiru/Desktop/highground/review/qa/19_loop_road_${run}.png` })
}
await browser.close()
