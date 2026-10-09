// Which layer costs the GPU? Measures map frame time with layers toggled, at the hero view.
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://127.0.0.1:5173/?replay=michaung2023')
await page.waitForSelector('.readout', { timeout: 90_000 })
await page.waitForTimeout(4000)
// force continuous repaints and count rendered frames over 3 s
const measure = (label) => page.evaluate(async (label) => {
  const m = window.__map
  let n = 0; const on = () => { n++; m.triggerRepaint() }
  m.on('render', on); m.triggerRepaint()
  await new Promise((r) => setTimeout(r, 3000))
  m.off('render', on)
  return `${label.padEnd(34)} ${(n / 3).toFixed(1)} fps`
}, label)
const ids = await page.evaluate(() => window.__map.getStyle().layers.map((l) => l.id))
const set = (pred, vis) => page.evaluate(([p, v]) => { const m = window.__map; for (const l of m.getStyle().layers) if (new RegExp(p).test(l.id)) m.setLayoutProperty(l.id, 'visibility', v) }, [pred, vis])
console.log(await measure('everything'))
await set('^flood-water$', 'none'); console.log(await measure('no water (three.js layer)')); await set('^flood-water$', 'visible')
await page.evaluate(() => window.__mv.water?.setRain?.(0)); await page.waitForTimeout(1500); console.log(await measure('no rain')); 
await set('building', 'none'); console.log(await measure('no rain, no buildings')); await set('building', 'visible')
await page.evaluate(() => window.__map.setTerrain(null)); console.log(await measure('no rain, no terrain'))
await set('^flood-water$', 'none'); await set('building', 'none'); console.log(await measure('basemap only, flat'))
console.log('layers:', ids.length, ids.filter((i) => /build|flood|hosp|park|route/.test(i)).join(' '))
await browser.close()
