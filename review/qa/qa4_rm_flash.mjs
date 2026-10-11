// QA run 4: reduced motion. After picking a street, record the readout on every animation frame for 1.5 s.
// Expected: the final peak number straight away (no count, no flash of another value).
import { createRequire } from 'node:module'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const base = process.env.QA_BASE ?? 'http://127.0.0.1:5173/'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
const page = await ctx.newPage()
await page.goto(`${base}?replay=michaung2023`)
await page.waitForSelector('.readout', { timeout: 150_000 }); await page.waitForTimeout(3000)
const out = {}
for (const q of ['Arumugam Road', 'Alaiamman Koil Street', 'Kotturpuram']) {
  await page.fill('.search input', q); await page.waitForSelector('.suggest li')
  await page.evaluate(() => { window.__rec = []; const t0 = performance.now(); const f = () => { const r = document.querySelector('.readout'); window.__rec.push([Math.round(performance.now() - t0), document.querySelector('.street')?.textContent ?? null, r?.querySelector('span')?.textContent ?? null, r?.getAttribute('aria-label') ?? null]); if (performance.now() - t0 < 4000) requestAnimationFrame(f) }; requestAnimationFrame(f) })
  await page.locator('.suggest li').first().dispatchEvent('mousedown')
  await page.waitForTimeout(4500)
  const rec = await page.evaluate(() => window.__rec)
  const withStreet = rec.filter((r) => r[1] && r[1].startsWith(q.split(' ')[0]))
  const fin = withStreet[withStreet.length - 1]
  out[q] = { final: fin, frames_with_new_street: withStreet.length, frames_not_final: withStreet.filter((r) => r[2] !== fin[2]).map((r) => r.slice(0, 3)).slice(0, 6), old_street_frames: rec.filter((r) => r[1] && !r[1].startsWith(q.split(' ')[0])).length }
}
console.log(JSON.stringify(out, null, 1))
await browser.close()
