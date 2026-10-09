import { chromium } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const logs = []
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 200)))
page.on('requestfailed', (r) => logs.push('FAILED ' + r.url().slice(0, 150) + ' ' + r.failure()?.errorText))
page.on('response', (r) => { if (r.status() >= 400 || r.url().includes('pmtiles')) logs.push(r.status() + ' ' + r.url().slice(0, 150) + ' ' + (r.headers()['content-type'] ?? '')) })
await page.goto(process.argv[2] ?? 'http://127.0.0.1:5173/#about')
await page.waitForTimeout(15000)
const info = await page.evaluate(() => {
  const m = window.__map
  if (!m) return 'no map'
  return { canvas: [m.getCanvas().clientWidth, m.getCanvas().clientHeight], container: getComputedStyle(m.getContainer()).position, loaded: m.loaded(), styleLoaded: m.isStyleLoaded(), zoom: m.getZoom(), center: m.getCenter(),
    pm: m.isSourceLoaded('protomaps'), terrain: m.isSourceLoaded('terrain'),
    features: m.queryRenderedFeatures().length, layers: m.getStyle().layers.length }
})
console.log(JSON.stringify(info))
console.log(logs.slice(0, 40).join('\n'))
await page.screenshot({ path: '/tmp/claude-1000/-home-tekiru-Desktop-highground/55f88bdc-6229-41e3-9e51-dd1ae875e719/scratchpad/probe.png' })
await browser.close()
