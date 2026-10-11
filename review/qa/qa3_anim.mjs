// QA run 3: camera animated inside the page (no CDP input), per layer configuration, at the hero street view
// and at the What-if city view. Separates the GPU frame cost from Playwright input dispatch.
import { createRequire } from 'node:module'
import fs from 'node:fs'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const R = {}
for (const [label, vp] of [['1440x900', { width: 1440, height: 900 }], ['1920x1080', { width: 1920, height: 1080 }]]) {
  const page = await browser.newPage({ viewport: vp })
  await page.goto('http://127.0.0.1:5173/?replay=michaung2023', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => (document.querySelector('.readout')?.getAttribute('aria-label') ?? '').includes('at the peak'), null, { timeout: 120_000 })
  await page.waitForTimeout(6000)
  const anim = (cfg) => page.evaluate(async (cfg) => {
    const m = window.__map
    m.setLayoutProperty('flood-water', 'visibility', cfg.water ? 'visible' : 'none')
    m.setLayoutProperty('buildings-3d', 'visibility', cfg.buildings ? 'visible' : 'none')
    m.setTerrain(cfg.terrain ? { source: 'terrain', exaggeration: 1.5 } : null)
    window.__mv.water.setRain(cfg.rain ? 0.8 : 0)
    if (cfg.view) m.jumpTo(cfg.view)
    await new Promise((r) => setTimeout(r, 1500))
    await new Promise((r) => { if (m.areTilesLoaded()) r(); else m.once('idle', r) })
    const c = m.getCenter()
    const ft = []
    let stop = false
    const tick = (t) => { ft.push(t); if (!stop) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    // slow orbit + pan, 4 s, MapLibre's own animation loop
    m.easeTo({ center: [c.lng + 0.004, c.lat + 0.002], bearing: m.getBearing() + 30, duration: 4000, easing: (t) => t })
    await new Promise((r) => setTimeout(r, 4100))
    stop = true
    m.jumpTo({ center: c, bearing: m.getBearing() - 30 })
    const d = []; for (let i = 1; i < ft.length; i++) d.push(ft[i] - ft[i - 1])
    const s = [...d].sort((a, b) => a - b)
    return { fps: +(1000 * (ft.length - 1) / (ft[ft.length - 1] - ft[0])).toFixed(1), p50: +s[s.length >> 1].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), gt50: d.filter((x) => x > 50).length }
  }, cfg)
  const street = { center: [80.21951, 12.96762], zoom: 15.2, pitch: 62, bearing: -18 }
  const city = { center: [80.215, 13.03], zoom: 11.3, pitch: 45, bearing: -10 }
  const all = { water: true, buildings: true, terrain: true, rain: false }
  R[label] = {
    street_all: await anim({ ...all, view: street }),
    street_all_rain: await anim({ ...all, rain: true, view: street }),
    street_no_water: await anim({ ...all, water: false, view: street }),
    street_no_buildings: await anim({ ...all, buildings: false, view: street }),
    street_no_terrain: await anim({ ...all, terrain: false, view: street }),
    street_basemap_only: await anim({ water: false, buildings: false, terrain: false, rain: false, view: street }),
    street_pitch0_all: await anim({ ...all, view: { ...street, pitch: 0 } }),
    city_all: await anim({ ...all, view: city }),
    city_basemap_only: await anim({ water: false, buildings: false, terrain: false, rain: false, view: city }),
  }
  console.log(label, JSON.stringify(R[label], null, 0))
  await page.close()
}
fs.writeFileSync('/home/tekiru/Desktop/highground/review/qa/run3/qa3_anim.json', JSON.stringify(R, null, 1))
await browser.close()
