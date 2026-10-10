// Screenshot What if, Proof and Hospitals as a user opens them from the nav; report console errors.
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
await page.goto('http://127.0.0.1:5173/?replay=michaung2023')
await page.waitForSelector('.readout', { timeout: 90_000 }).catch(() => errors.push('no readout'))
await page.waitForTimeout(3000)
for (const name of ['What if', 'Proof', 'Hospitals']) {
  await page.getByRole('button', { name, exact: true }).click()
  await page.waitForTimeout(5000)
  const panels = await page.evaluate(() => [...document.querySelectorAll('.panel')].map((p) => { const r = p.getBoundingClientRect(); const cs = getComputedStyle(p); return `${p.className}: ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} op=${cs.opacity} vis=${cs.visibility}` }))
  console.log(name, JSON.stringify(panels))
  await page.screenshot({ path: `../review/p5-dev/now_${name.replace(' ', '_')}.png` })
}
console.log('errors', JSON.stringify(errors))
await browser.close()
