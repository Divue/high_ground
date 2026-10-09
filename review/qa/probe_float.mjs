// QA probe: is the water plane aligned with the ground? Same spot top-down and pitched, zoomed in.
import { createRequire } from 'node:module'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://127.0.0.1:5173/?replay=michaung2023#about', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.panel.about', { timeout: 180000 })
await page.evaluate(() => { document.querySelector('.panel.about').style.display = 'none' })
const P = [80.2137, 12.9633]
const elev = await page.evaluate(([lon, lat]) => {
  const mv = window.__mv, m = mv.meta, R = 20037508.342789244
  const x = lon * R / 180, y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) * R / Math.PI
  const [l, b, r, t] = m.bbox_mercator
  const c = Math.floor((x - l) / (r - l) * m.width), rr = Math.floor((t - y) / (t - b) * m.height)
  return { elev_m: mv.water.elev?.[rr * m.width + c] ?? null, terrain_query: window.__map.queryTerrainElevation([lon, lat]) }
}, P)
console.log(JSON.stringify(elev))
for (const [pitch, name] of [[0, 'top'], [70, 'pitched']]) {
  await page.evaluate(([c, p]) => {
    window.__map.jumpTo({ center: c, zoom: 16.5, pitch: p, bearing: 0 })
    window.__mv.setGeoJSON('here', { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })
  }, [P, pitch])
  await page.waitForTimeout(6000)
  await page.screenshot({ path: `/home/tekiru/Desktop/highground/review/qa/71_water_${name}.png` })
}
await browser.close()
