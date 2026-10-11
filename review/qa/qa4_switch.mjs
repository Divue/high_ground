// QA run 4: storm switching on a searched street. Arumugam Road, then Michaung -> 2015 -> Fengal -> Michaung -> Tonight.
// After each switch (12 s), read the card + timeline and compare with the model files (expected values passed in).
// Run from web/: node ../review/qa/qa4_switch.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const out = '/home/tekiru/Desktop/highground/review/qa/run4'
const srcM = () => { if (process.env.QA_BASE) return 0; let m = 0; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const q = `${d}/${f.name}`; if (f.isDirectory()) walk(q); else m = Math.max(m, fs.statSync(q).mtimeMs) } }; walk('/home/tekiru/Desktop/highground/web/src'); return m }
const m0 = srcM()
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })
let reloads = 0; page.on('load', () => reloads++)
await page.goto((process.env.QA_BASE ?? 'http://127.0.0.1:5173/') + '?replay=michaung2023')
await page.waitForSelector('.readout', { timeout: 150_000 }); await page.waitForTimeout(12000)  // working-tree builds may word the peak note differently
await page.fill('.search input', 'Arumugam Road'); await page.waitForSelector('.suggest li'); await page.locator('.suggest li').first().dispatchEvent('mousedown')
const read = () => page.evaluate(() => ({ readout: document.querySelector('.readout')?.getAttribute('aria-label') ?? null, shown: document.querySelector('.readout span')?.textContent ?? null,
  when: document.querySelector('.when')?.textContent?.replace(/ /g, ' ') ?? null, decision: document.querySelector('.decision')?.textContent ?? null,
  marker: document.querySelector('.tl-marker')?.textContent ?? null, now: document.querySelector('.timeline .now')?.textContent?.replace(/ /g, ' ') ?? null,
  slider: document.querySelector('.timeline input[type=range]') ? [+document.querySelector('.timeline input[type=range]').value, +document.querySelector('.timeline input[type=range]').max] : null,
  line: [...document.querySelectorAll('.panel.left .small')].map((e) => e.textContent)[1] ?? null, street: document.querySelector('.street')?.textContent ?? null,
  h2: document.querySelector('.panel.left h2')?.textContent ?? null }))
const R = []
await page.waitForTimeout(14000)
R.push({ step: 'michaung (search)', ...(await read()) }); await page.screenshot({ path: `${out}/sw_${process.env.QA_TAG ?? "dev"}_0_michaung.png` })
for (const [label, key] of [['2015', 'dec2015'], ['Fengal 2024', 'fengal'], ['Michaung 2023', 'michaung_again'], ['Tonight', 'tonight']]) {
  await page.getByRole('group', { name: 'Replay a storm' }).getByRole('button', { name: label, exact: true }).click()
  const samples = []
  for (let k = 0; k < 24; k++) { await page.waitForTimeout(500); samples.push(await read()) }
  R.push({ step: label, ...samples[samples.length - 1], during: samples.filter((_, i) => i % 3 === 0).map((s) => `${s.shown}|${s.slider?.join('/')}|${s.now}`) })
  await page.screenshot({ path: `${out}/sw_${process.env.QA_TAG ?? "dev"}_${key}.png` })
}
const contaminated = srcM() !== m0  // web/src edited while the test ran (HMR)
fs.writeFileSync(`${out}/qa4_switch_${process.env.QA_TAG ?? "dev"}.json`, JSON.stringify({ R, errors, reloads, contaminated }, null, 1))
console.log(JSON.stringify({ R, errors, reloads, contaminated }, null, 1))
await browser.close()
