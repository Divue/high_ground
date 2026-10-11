// Real-time recording of the offline flow for the demo video (1920x1080 WebM), with a beat log
// so the edit can cut to each moment:  node tests/record_offline.mjs http://127.0.0.1:4175/ <out_dir>
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:4175/'
const out = process.argv[3] ?? '../review/p5/footage/offline_rt'
mkdirSync(out, { recursive: true })
const b = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'] })
// one recorded context: the setup at the start is cut out in the edit using the beat log
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: out, size: { width: 1920, height: 1080 } } })
const page = await ctx.newPage()
const t0 = Date.now()
const beats = []
const beat = (name) => { beats.push({ name, s: (Date.now() - t0) / 1000 }); console.log(name, ((Date.now() - t0) / 1000).toFixed(1)) }
const url = `${base}app?replay=michaung2023&motion=off`
await page.goto(url)
await page.evaluate(async () => { await navigator.serviceWorker.ready })
await page.reload()
await page.waitForSelector('.readout', { timeout: 90000 })
await page.waitForTimeout(2500)
beat('card')
await page.getByRole('button', { name: 'Save for offline' }).click()
beat('save_click')
await page.waitForSelector('text=Saved for offline', { timeout: 180000 })
beat('saved')
await page.waitForTimeout(2500)
await ctx.setOffline(true)
await page.reload()
await page.waitForSelector('.offline-chip', { timeout: 60000 })
await page.waitForSelector('.readout', { timeout: 60000 })
beat('offline_card')
await page.waitForTimeout(4000)
await page.getByRole('button', { name: /Take me (there|to dry ground)/ }).first().click()
await page.waitForSelector('.go-result:not(.stale)', { timeout: 60000 })
beat('offline_route')
await page.waitForTimeout(4500)
await page.getByRole('button', { name: 'Preview the drive' }).click()
beat('preview')
await page.waitForTimeout(5000)
await page.getByRole('button', { name: 'End' }).click()
await page.getByRole('button', { name: /^Back to .* cm$/ }).click()
await page.waitForTimeout(800)
await page.getByRole('button', { name: 'Help numbers' }).click()
beat('help')
await page.waitForTimeout(4000)
await page.locator('.sheet').getByRole('button', { name: 'Close' }).click()
await page.getByRole('button', { name: 'My flood plan' }).click()
await page.waitForSelector('.plan-img', { timeout: 30000 })
beat('plan')
await page.waitForTimeout(5000)
beat('end')
const v = page.video()
await ctx.close()
const path = await v.path()
writeFileSync(`${out}/beats.json`, JSON.stringify({ video: path, beats }, null, 1))
console.log('video', path)
await b.close()
