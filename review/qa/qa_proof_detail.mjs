// QA: Proof Detail buttons. proof.json currently has anuga: null (ANUGA v3 still running), so the
// request is intercepted and the v2 agreement block (runs_v2/anuga/.../agreement.json) is injected, read-only.
import { createRequire } from 'node:module'
import fs from 'node:fs'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const ag = JSON.parse(fs.readFileSync('/home/tekiru/Desktop/highground/data/out/runs_v2/anuga/design_200_mean/agreement.json', 'utf8'))
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; page.on('pageerror', (e) => errs.push(String(e)))
await page.route('**/data/proof.json', async (route) => {
  const r = await route.fetch(); const j = await r.json()
  j.anuga = { cell_agreement: ag.cell_agreement ?? ag.agreement, csi: ag.csi, depth_corr: ag.depth_corr, anuga_wet_share: ag.anuga_wet_share, fast_wet_share: ag.fast_wet_share, triangles: ag.triangles ?? 103159, note: 'injected by QA' }
  await route.fulfill({ response: r, json: j })
})
await page.goto('http://127.0.0.1:5173/?replay=michaung2023#proof', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.strip', { timeout: 180000 })
await page.waitForTimeout(3000)
const R = {}
R.anuga_text = await page.locator('.proof-bottom .small p').first().textContent().catch(() => null)
for (const [b, k] of [['Detail: ANUGA', 'anuga'], ['Detail: fast model', 'fast'], ['2015 split view', 'split']]) {
  await page.click(`button:has-text("${b}")`)
  await page.waitForTimeout(5000)
  R[k] = { label: await page.locator('.proof-label').allTextContents(), detail_layer: await page.evaluate(() => !!window.__map.getLayer('detail')), handle: await page.locator('.proof-handle').count(), center_card: await page.locator('.proof-center').count(), pressed: await page.locator('.proof-bottom .seg button[aria-pressed=true]').allTextContents() }
  await page.screenshot({ path: `/home/tekiru/Desktop/highground/review/qa/34_proof_detail_${k}.png` })
}
// leave Proof while in detail view: does the detail layer get cleaned up?
await page.click('button:has-text("Detail: ANUGA")'); await page.waitForTimeout(3000)
await page.click('nav button:has-text("Tonight")'); await page.waitForTimeout(4000)
R.after_leave = { detail_layer: await page.evaluate(() => !!window.__map.getLayer('detail')), readout: await page.locator('.readout').getAttribute('aria-label').catch(() => null) }
R.errors = errs
console.log(JSON.stringify(R, null, 1))
await page.screenshot({ path: '/home/tekiru/Desktop/highground/review/qa/35_after_leaving_proof_detail.png' })
await browser.close()
