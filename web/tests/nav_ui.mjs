// "Take me to dry ground" on the hero street: screenshots for each mode and destination.
//   node tests/nav_ui.mjs http://127.0.0.1:5173/ ../review/p5-dev/nav
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
const base = process.argv[2] ?? 'http://127.0.0.1:5173/'
const out = process.argv[3] ?? '../review/p5-dev/nav'
const vw = Number(process.env.VW ?? 1440), vh = Number(process.env.VH ?? 900)
mkdirSync(out, { recursive: true })
const b = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: vw, height: vh } })
const errors = []
p.on('pageerror', (e) => errors.push(String(e)))
await p.goto(base + '?replay=michaung2023&motion=off')
await p.waitForSelector('.readout', { timeout: 90000 })
await p.waitForTimeout(1500)
await p.getByRole('button', { name: 'Take me to dry ground' }).click()
const shot = async (name) => {
  await p.waitForSelector('.go-result:not(.stale)', { timeout: 60000 })
  await p.waitForTimeout(1600)
  await p.screenshot({ path: `${out}/${name}.png` })
  const txt = await p.$eval('.go', (el) => el.innerText)
  console.log(`--- ${name}\n${txt.slice(0, 900)}`)
}
await shot(`01_two_wheeler_parking_${vw}`)
await p.getByRole('button', { name: 'On foot' }).click(); await p.waitForTimeout(400)
await p.getByRole('button', { name: 'High ground' }).click(); await shot(`02_foot_high_${vw}`)
await p.getByRole('button', { name: 'Car', exact: true }).click(); await p.waitForTimeout(400)
await p.getByRole('button', { name: 'Hospital', exact: true }).click(); await shot(`03_car_hospital_${vw}`)
console.log('errors', errors)
await b.close()
