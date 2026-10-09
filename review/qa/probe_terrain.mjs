// QA probe: which terrain URLs the map requests, what they return, and whether terrain elevation is live.
import { createRequire } from 'node:module'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const reqs = []
page.on('response', async (r) => { if (r.url().includes('/terrain/')) reqs.push(`${r.status()} ${r.headers()['content-type']} ${r.url().replace('http://127.0.0.1:5173', '')}`) })
page.on('requestfailed', (r) => { if (r.url().includes('/terrain/')) reqs.push(`FAILED ${r.failure()?.errorText} ${r.url().replace('http://127.0.0.1:5173', '')}`) })
await page.goto('http://127.0.0.1:5173/?replay=michaung2023#about', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.panel.about', { timeout: 180000 })
await page.evaluate(() => window.__map.jumpTo({ center: [80.2209, 12.9791], zoom: 14, pitch: 60 }))
await page.waitForTimeout(8000)
const info = await page.evaluate(() => {
  const m = window.__map
  const src = m.getStyle().sources.terrain
  return { tiles: src.tiles, terrain: !!m.getTerrain(), elevVelachery: m.queryTerrainElevation([80.2209, 12.9791]), elevGuindy: m.queryTerrainElevation([80.2206, 13.0067]),
    hospitalsLayer: !!m.getLayer('hospitals'), hospitalsLabel: !!m.getLayer('hospitals-label') }
})
console.log(JSON.stringify(info))
const c = {}; for (const r of reqs) { const k = r.replace(/\/\d+\/\d+\/\d+\.png/, '/N/N/N.png'); c[k] = (c[k] ?? 0) + 1 }
console.log(JSON.stringify(c, null, 1))
await page.screenshot({ path: '/home/tekiru/Desktop/highground/review/qa/70_terrain_probe.png' })
await browser.close()
