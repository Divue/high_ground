// Same view with the water layer on and off, to judge how visible the water is.
import { chromium } from '@playwright/test'
const [run = 'dec2015_reservoir', hour = '14', name = 'wide'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`http://127.0.0.1:5173/?replay=${run}`)
await page.waitForSelector('.readout', { timeout: 90_000 })
await page.waitForTimeout(6000)
await page.evaluate(async (h) => {
  const mv = window.__mv
  await mv.showWide()
  await mv.showMix([{ run: new URLSearchParams(location.search).get('replay'), w: 1 }], Number(h), 0)
}, hour)
await page.waitForTimeout(2500)
await page.screenshot({ path: `../review/p5-dev/water_on_${name}.png` })
await page.evaluate(() => window.__map.setLayoutProperty('flood-water', 'visibility', 'none'))
await page.waitForTimeout(1200)
await page.screenshot({ path: `../review/p5-dev/water_off_${name}.png` })
await browser.close()
