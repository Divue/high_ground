// QA run 4: the opening on a replay link. Samples every 100 ms for 25 s: title line (text, opacity), camera
// (zoom/pitch/center), movestart count (single flight?), timeline hour + clock, readout number + note, glyph,
// legend text. Also first-contentful-paint and card time. Screenshots at 0.5/2/5/9/13/20 s.
// Run from web/: node ../review/qa/qa4_opening.mjs [run]
import { createRequire } from 'node:module'
import fs from 'node:fs'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const run = process.argv[2] ?? 'michaung2023'
const out = '/home/tekiru/Desktop/highground/review/qa/run4'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
const t0 = Date.now()
await page.goto(`http://127.0.0.1:5173/?replay=${run}`, { waitUntil: 'commit' })
const shots = [500, 2000, 5000, 9000, 13000, 20000]
const S = []
await page.waitForFunction(() => document.readyState !== 'loading', null, { timeout: 30000 }).catch(() => {})
await page.evaluate(() => { window.__moves = 0; const hook = () => { if (window.__map) { window.__map.on('movestart', () => window.__moves++) } else setTimeout(hook, 20) }; hook() })
while (Date.now() - t0 < 25000) {
  const s = await page.evaluate(() => {
    const ti = document.querySelector('.intro-title'); const m = window.__map; const r = document.querySelector('.readout')
    return { title: ti?.textContent ?? null, titleOp: ti ? getComputedStyle(ti).opacity : null,
      cam: m ? [+m.getZoom().toFixed(2), Math.round(m.getPitch()), Math.round(m.getBearing())] : null, moves: window.__moves ?? null,
      h: document.querySelector('.timeline input[type=range]')?.value ?? null, now: document.querySelector('.timeline .now')?.textContent ?? null,
      n: r?.querySelector('span')?.textContent ?? null, label: r?.getAttribute('aria-label') ?? null, when: document.querySelector('.when')?.textContent ?? null,
      glyph: document.querySelector('.glyph')?.getAttribute('aria-label')?.match(/Water at (\d+)/)?.[1] ?? null,
      legend: document.querySelector('.legend')?.innerText?.replace(/\s+/g, ' ') ?? null, street: document.querySelector('.street')?.textContent ?? null }
  })
  S.push({ t: Date.now() - t0, ...s })
  const due = shots.find((x) => x <= Date.now() - t0)
  if (due !== undefined) { shots.splice(shots.indexOf(due), 1); await page.screenshot({ path: `${out}/o_${run}_${String(due).padStart(5, '0')}.png` }) }
  await page.waitForTimeout(100)
}
const paint = await page.evaluate(() => performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]))
const firstCard = S.find((s) => s.n !== null)
const res = { run, paint, first_card_ms: firstCard?.t ?? null, first_peak_ms: S.find((s) => (s.label ?? '').includes('at the peak'))?.t ?? null,
  moves_total: S[S.length - 1].moves, titles: [...new Set(S.map((s) => s.title))], legend: S[S.length - 1].legend,
  hours_seq: S.filter((s, i) => s.h && (i === 0 || s.h !== S[i - 1].h)).map((s) => `${s.t}:${s.h}(${(s.now ?? '').replace(/ /g, ' ')}) n=${s.n}`),
  cams: S.filter((_, i) => i % 15 === 0).map((s) => `${s.t}:${JSON.stringify(s.cam)} title=${s.titleOp}`), final: S[S.length - 1], errs }
fs.writeFileSync(`${out}/qa4_opening_${run}.json`, JSON.stringify({ res, S }, null, 1))
console.log(JSON.stringify(res, null, 1))
await browser.close()
