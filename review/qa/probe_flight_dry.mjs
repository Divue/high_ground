// QA probe: (1) when the opening flight starts/ends and fps during it; (2) "when to leave" on a dry street.
import { createRequire } from 'node:module'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => {
  window.__ft = []; const tick = (t) => { window.__ft.push(t); requestAnimationFrame(tick) }; requestAnimationFrame(tick)
  const iv = setInterval(() => { const m = window.__map; if (!m) return; clearInterval(iv)
    m.once('load', () => { window.__load = performance.now() })
    m.on('movestart', () => { if (!window.__fs && window.__load) window.__fs = performance.now() })
    m.on('moveend', () => { if (window.__fs && !window.__fe) window.__fe = performance.now() }) }, 5)
})
await page.goto('http://127.0.0.1:5173/?replay=michaung2023', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.readout', { timeout: 180000 })
const R = await page.evaluate(() => {
  const f = window.__ft.filter((t) => t >= window.__fs && t <= window.__fe)
  let long = 0; for (let i = 1; i < f.length; i++) if (f[i] - f[i - 1] > 50) long++
  return { map_load_ms: Math.round(window.__load), flight_start_ms: Math.round(window.__fs), flight_end_ms: Math.round(window.__fe), answer_ms: Math.round(performance.now()),
    flight_fps: +(1000 * (f.length - 1) / (f[f.length - 1] - f[0])).toFixed(1), flight_long_frames: long }
})
console.log(JSON.stringify(R))
await page.screenshot({ path: '/home/tekiru/Desktop/highground/review/qa/03_flight_landed.png' })
// dry street + when to leave
await page.fill('.search input', 'T. Nagar'); await page.waitForSelector('.suggest li')
await page.locator('.suggest li').first().dispatchEvent('mousedown')
await page.waitForSelector('.readout'); await page.waitForTimeout(6000)
await page.locator('button.linkbtn').first().click()
await page.waitForFunction(() => !document.querySelector('button.linkbtn[disabled]'), null, { timeout: 180000 })
await page.waitForTimeout(3000)
console.log(JSON.stringify(await page.evaluate(async () => ({
  when: document.querySelector('.when')?.textContent, band: document.querySelector('.band')?.textContent,
  decision: document.querySelector('.decision')?.textContent ?? null, marker: document.querySelector('.tl-marker')?.textContent ?? null,
  panel_mentions_leave: document.querySelector('.panel.left').innerText.toLowerCase().includes('leave'),
  route_pts: (await window.__map.getSource('route-safe').getData())?.geometry?.coordinates?.length ?? 0 }))))
await page.screenshot({ path: '/home/tekiru/Desktop/highground/review/qa/17_dry_street_when_to_leave.png' })
// Anna Nagar: how long is the route to the nearest dry flyover?
await page.fill('.search input', 'Anna Nagar'); await page.waitForSelector('.suggest li')
await page.locator('.suggest li').first().dispatchEvent('mousedown')
await page.waitForSelector('.readout'); await page.waitForTimeout(6000)
await page.locator('button.linkbtn').first().click()
await page.waitForFunction(() => !document.querySelector('button.linkbtn[disabled]'), null, { timeout: 180000 })
await page.waitForTimeout(3000)
console.log(JSON.stringify(await page.evaluate(async () => {
  const len = (c) => { let d = 0; for (let i = 1; i < c.length; i++) { const k = Math.cos(c[i][1] * Math.PI / 180); d += Math.hypot((c[i][0] - c[i - 1][0]) * 111320 * k, (c[i][1] - c[i - 1][1]) * 110540) } return Math.round(d) }
  const s = await window.__map.getSource('route-safe').getData(), n = await window.__map.getSource('route-normal').getData()
  return { park: document.querySelector('.park')?.textContent, marker: document.querySelector('.tl-marker')?.textContent, safe_m: len(s?.geometry?.coordinates ?? []), normal_m: len(n?.geometry?.coordinates ?? []) }
})))
await page.screenshot({ path: '/home/tekiru/Desktop/highground/review/qa/18_anna_nagar_route.png' })
await browser.close()
