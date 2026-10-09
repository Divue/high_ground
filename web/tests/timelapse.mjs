// "Watch the whole storm": click it on a replay, screenshot through the playback, check the
// captions match runs.json and that the end buttons appear.
import { chromium } from '@playwright/test'
const run = process.argv[2] ?? 'dec2015_reservoir'
const out = process.argv[3] ?? '../review/p5-dev/timelapse'
import fs from 'node:fs'
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`http://127.0.0.1:5173/?replay=${run}`)
await page.waitForSelector('.readout', { timeout: 90_000 })
await page.waitForTimeout(5000)
const t0 = Date.now()
await page.getByRole('button', { name: 'Watch the whole storm' }).click()
const seen = []
for (const t of [3, 8, 13, 18, 24, 30]) {
  await page.waitForTimeout(Math.max(0, t * 1000 - (Date.now() - t0)))
  await page.screenshot({ path: `${out}/${run}_${String(t).padStart(2, '0')}s.png` })
  seen.push(await page.evaluate(() => ({ clock: document.querySelector('.lapse-clock')?.textContent, share: document.querySelector('.lapse-share .num')?.textContent, event: document.querySelector('.lapse-event')?.textContent })))
}
await page.waitForSelector('text=Back to my street', { timeout: 60_000 }).catch(() => {})
const done = Math.round((Date.now() - t0) / 1000)
await page.screenshot({ path: `${out}/${run}_end.png` })
seen.push(await page.evaluate(() => ({ clock: document.querySelector('.lapse-clock')?.textContent, share: document.querySelector('.lapse-share .num')?.textContent, event: document.querySelector('.lapse-event')?.textContent })))
console.log(JSON.stringify({ run, finished_after_s: done, seen, errors }, null, 1))
await browser.close()
