// Screenshot the answer card for a place under a replay (after the rise and count-up finish).
import { chromium } from '@playwright/test'
const [run = 'michaung2023', query = 'Arumugam Road', name = 'card'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`http://127.0.0.1:5173/?replay=${run}`)
await page.waitForSelector('.readout', { timeout: 90_000 })
if (query !== '-') {
  await page.fill('input[type=search], .search input', query)
  await page.waitForTimeout(1200)
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
}
await page.waitForTimeout(1500)
await page.screenshot({ path: `../review/p5-dev/${name}_counting.png`, clip: { x: 0, y: 60, width: 400, height: 520 } })
await page.waitForTimeout(9000)
await page.screenshot({ path: `../review/p5-dev/${name}.png`, clip: { x: 0, y: 60, width: 400, height: 760 } })
console.log(JSON.stringify({ readout: await page.locator('.readout').textContent(), errors }))
await browser.close()
