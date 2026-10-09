// 390x844 phone view of a screen, after the opening settles.
import { chromium } from '@playwright/test'
const [q = '?replay=michaung2023', name = 'mobile_tonight'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`http://127.0.0.1:5173/${q}`)
await page.waitForTimeout(16000)
await page.screenshot({ path: `../review/p5-dev/${name}.png` })
console.log(JSON.stringify({ name, errors }))
await browser.close()
