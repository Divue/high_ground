// Offline chip in Tonight (forecast) mode, desktop 1440x900, production build.
import { chromium } from '/home/tekiru/Desktop/highground/web/node_modules/@playwright/test/index.mjs'
const base = process.argv[2] ?? 'http://127.0.0.1:4173/'
const out = '/home/tekiru/Desktop/highground/review/design/offline_nav'
const b = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
await p.goto(base + '?motion=off')
await p.evaluate(async () => { await navigator.serviceWorker.ready })
await p.reload()
await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
await p.waitForSelector('.panel.left', { timeout: 90000 })
await p.waitForTimeout(4000)
await p.screenshot({ path: `${out}/o01_tonight_online.png` })
console.log('online card:', (await p.$eval('.panel.left', (e) => e.innerText)).slice(0, 600).replace(/\n+/g, ' | '))
const save = p.getByRole('button', { name: 'Save for offline' })
if (await save.count()) {
  await save.click()
  await p.waitForSelector('text=Saved for offline', { timeout: 180000 })
  await ctx.setOffline(true)
  await p.reload()
  await p.waitForSelector('.panel.left', { timeout: 60000 })
  await p.waitForTimeout(4000)
  await p.screenshot({ path: `${out}/o02_tonight_offline.png` })
  console.log('offline chip:', await p.$eval('.offline-chip', (e) => e.innerText).catch(() => '(no chip)'))
  console.log('offline card:', (await p.$eval('.panel.left', (e) => e.innerText)).slice(0, 700).replace(/\n+/g, ' | '))
} else console.log('no Save for offline button in Tonight mode')
await b.close()
