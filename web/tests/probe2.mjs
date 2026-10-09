import { chromium } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text().slice(0, 300)) })
await page.goto(process.argv[2] ?? 'http://127.0.0.1:5173/#whatif')
await page.waitForTimeout(12000)
const info = await page.evaluate(() => {
  const w = window.__mv?.water
  if (!w) return { keys: Object.keys(window.__mv ?? {}), meta: !!window.__mv?.meta, sameMap: window.__mv?.map === window.__map, layers: window.__map.getStyle().layers.map(l => l.id).filter(id => !id.includes('_')).slice(-15), hasWater: !!window.__map.getLayer('water') }
  let nz = 0, mx = 0
  for (const v of w.bufB) { if (v > 0) nz++; if (v > mx) mx = v }
  const u = w.water.material.uniforms
  return { renders: w.renders, nonzeroB: nz, maxB: mx, mixT: u.mixT.value, rise: u.rise.value, opacity: u.opacity.value, zPerMeter: u.zPerMeter.value,
    elevSample: Array.from(w.elev.slice(500000, 500005)), visible: w.water.visible, layerOrder: window.__map.getStyle().layers.map(l => l.id).slice(-12) }
})
console.log(JSON.stringify(info, null, 1))
await page.screenshot({ path: '/tmp/claude-1000/-home-tekiru-Desktop-highground/55f88bdc-6229-41e3-9e51-dd1ae875e719/scratchpad/probe.png' })
await browser.close()
