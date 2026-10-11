// QA run 4: load ?replay=<run>, sample the card every 2 s for 60 s, report errors, screenshot at the end.
import { createRequire } from 'node:module'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const run = process.argv[2] ?? 'michaung2023'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 300) + ' | ' + (e.stack ?? '').split('\n').slice(1, 3).join(' ')))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 300)) })
const t0 = Date.now()
await page.goto(`http://127.0.0.1:5173/?replay=${run}`)
const S = []
while (Date.now() - t0 < 60000) {
  S.push(await page.evaluate(() => ({ t: 0, label: document.querySelector('.readout')?.getAttribute('aria-label') ?? null, shown: document.querySelector('.readout span')?.textContent ?? null,
    h: document.querySelector('.timeline input[type=range]')?.value ?? null, street: document.querySelector('.street')?.textContent ?? null, title: document.querySelector('.intro-title')?.textContent ?? null,
    cam: window.__map ? [+window.__map.getZoom().toFixed(2), Math.round(window.__map.getPitch()), Math.round(window.__map.getBearing())] : null })).then((s) => ({ ...s, t: Date.now() - t0 })).catch((e) => ({ t: Date.now() - t0, err: String(e).slice(0, 100) })))
  await page.waitForTimeout(2000)
}
await page.screenshot({ path: `/home/tekiru/Desktop/highground/review/qa/run4/probe_load_${run}.png` })
console.log(JSON.stringify({ S: S.map((s) => `${s.t}:${s.label}|${s.shown}|h${s.h}|${JSON.stringify(s.cam)}|${s.title ? 'title' : ''}${s.err ?? ''}`), errors }, null, 1))
await browser.close()
