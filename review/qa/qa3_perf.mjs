// QA run 3: performance on an idle machine. Load sequence (FCP/LCP, title, card, rise), idle rAF fps and
// map redraws per second on a still map, scrubbing, panning, time-lapse; long frames, long tasks, GPU busy.
// Run from web/: node ../review/qa/qa3_perf.mjs [run]
import { createRequire } from 'node:module'
import fs from 'node:fs'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const base = 'http://127.0.0.1:5173/'
const out = '/home/tekiru/Desktop/highground/review/qa/run3'
const RUN = process.argv[2] ?? 'michaung2023'
fs.mkdirSync(out, { recursive: true })

// ---- GPU busy for chromium processes (amdgpu fdinfo, ns of gfx engine time per DRM client)
function gpuSnap() {
  const snap = new Map()
  for (const pid of fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    let cmd = ''
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8') } catch { continue }
    if (!/ms-playwright|chrome-linux|headless_shell/.test(cmd)) continue
    let fds = []
    try { fds = fs.readdirSync(`/proc/${pid}/fdinfo`) } catch { continue }
    for (const fd of fds) {
      let t = ''
      try { t = fs.readFileSync(`/proc/${pid}/fdinfo/${fd}`, 'utf8') } catch { continue }
      const g = t.match(/drm-engine-gfx:\s*(\d+)/), c = t.match(/drm-client-id:\s*(\d+)/)
      if (g && c) snap.set(`${pid}:${c[1]}`, Math.max(snap.get(`${pid}:${c[1]}`) ?? 0, Number(g[1])))
    }
  }
  return { t: process.hrtime.bigint(), snap }
}
const gpuBusy = (a, b) => {
  let ns = 0
  for (const [k, v] of b.snap) if (a.snap.has(k)) ns += v - a.snap.get(k)
  return +(100 * ns / Number(b.t - a.t)).toFixed(1)
}

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const R = { run: RUN, console: [], page_errors: [], failed_requests: [], http_errors: [], phases: {} }
async function newPage(ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...ctxOpts })
  const page = await ctx.newPage()
  page.setDefaultTimeout(120_000)
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') R.console.push(`${m.type()}: ${m.text()}`.slice(0, 300)) })
  page.on('pageerror', (e) => R.page_errors.push(String(e).slice(0, 300)))
  page.on('requestfailed', (r) => R.failed_requests.push(`${r.failure()?.errorText} ${r.url()}`.slice(0, 200)))
  page.on('response', (r) => { if (r.status() >= 400) R.http_errors.push(`${r.status()} ${r.url()}`.slice(0, 200)) })
  await page.addInitScript(() => {
    window.__ft = []
    const tick = (t) => { window.__ft.push(t); requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    window.__lt = []
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true }) } catch {}
    window.__lcp = 0
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true }) } catch {}
    window.__mark = {}
    // map redraw counter: MapLibre 'render' events (counted once the map exists)
    window.__mr = 0
    const hook = setInterval(() => { if (window.__map) { window.__map.on('render', () => window.__mr++); clearInterval(hook) } }, 5)
  })
  return { ctx, page }
}
const stats = (page, a, b) => page.evaluate(([a, b]) => {
  const f = window.__ft.filter((t) => t >= a && t <= b)
  if (f.length < 2) return null
  const d = []; for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1])
  const s = [...d].sort((x, y) => x - y)
  const lt = window.__lt.filter(([t]) => t >= a && t <= b)
  return {
    span_s: +((b - a) / 1000).toFixed(1), fps: +(1000 * (f.length - 1) / (f[f.length - 1] - f[0])).toFixed(1),
    p50_ms: +s[Math.floor(s.length * 0.5)].toFixed(1), p95_ms: +s[Math.floor(s.length * 0.95)].toFixed(1), worst_ms: Math.round(s[s.length - 1]),
    frames_gt_25ms: d.filter((x) => x > 25).length, frames_gt_50ms: d.filter((x) => x > 50).length, frames_gt_100ms: d.filter((x) => x > 100).length,
    long_tasks: lt.length, long_task_ms: Math.round(lt.reduce((s, [, x]) => s + x, 0)), worst_task_ms: Math.round(Math.max(0, ...lt.map(([, x]) => x))),
  }
}, [a, b])
const now = (page) => page.evaluate(() => performance.now())
const counters = (page) => page.evaluate(() => ({ water: window.__mv?.water?.renders ?? null, map: window.__mr, rain: window.__mv?.water?.rain ? +window.__mv.water.rain.level.toFixed(3) : null }))
async function phase(page, name, fn) {
  const c0 = await counters(page), g0 = gpuSnap(), a = await now(page)
  const extra = await fn()
  const b = await now(page), g1 = gpuSnap(), c1 = await counters(page)
  const s = (b - a) / 1000
  R.phases[name] = { ...(await stats(page, a, b)), map_redraws_per_s: +((c1.map - c0.map) / s).toFixed(1),
    water_renders_per_s: c1.water != null && c0.water != null ? +((c1.water - c0.water) / s).toFixed(1) : null,
    rain_level: c1.rain, gpu_busy_pct: gpuBusy(g0, g1), ...(extra ?? {}) }
  console.log(name, JSON.stringify(R.phases[name]))
}

// ================================================================ 1. load sequence, replay
{
  const { ctx, page } = await newPage()
  const g0 = gpuSnap()
  const t0 = Date.now()
  await page.goto(`${base}?replay=${RUN}`, { waitUntil: 'domcontentloaded' })
  R.t_domcontentloaded_ms = Date.now() - t0
  await page.waitForSelector('.intro-title', { timeout: 60_000 }).catch(() => {})
  R.t_title_ms = Date.now() - t0
  R.title_text = await page.locator('.intro-title').textContent().catch(() => null)
  await page.screenshot({ path: `${out}/p01_title.png` })
  await page.waitForFunction(() => window.__mv?.water, null, { timeout: 120_000 })
  R.t_map_ready_ms = Date.now() - t0
  R.title_text_after_data = await page.locator('.intro-title').textContent().catch(() => null)
  await page.waitForTimeout(2200)
  await page.screenshot({ path: `${out}/p02_descent.png` })
  await page.waitForSelector('.readout', { timeout: 180_000 })
  R.t_answer_card_ms = Date.now() - t0
  const tCard = await now(page)
  await page.waitForFunction(() => (document.querySelector('.readout')?.getAttribute('aria-label') ?? '').includes('at the peak'), null, { timeout: 60_000 }).catch(() => { R.rise_note_timeout = true })
  R.t_at_peak_ms = Date.now() - t0
  const tPeak = await now(page)
  await page.waitForFunction(() => { const d = document.querySelector('.decision'); return !d || (d.textContent.length > 0 && !d.textContent.includes('Working out')) }, null, { timeout: 120_000 }).catch(() => { R.decision_timeout = true })
  R.t_decision_ms = Date.now() - t0
  const tDec = await now(page)
  await page.screenshot({ path: `${out}/p03_card_settled.png` })
  R.paint = await page.evaluate(() => ({ fcp: Math.round(performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? -1), lcp: Math.round(window.__lcp) }))
  R.renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return gl ? String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none' })
  R.phases.load_to_card = await stats(page, 0, tCard)
  R.phases.rise_card_to_peak = await stats(page, tCard, tPeak)
  R.phases.peak_to_decision = await stats(page, tPeak, tDec)
  R.gpu_busy_load_pct = gpuBusy(g0, gpuSnap())
  R.transfer = await page.evaluate(() => { const e = performance.getEntriesByType('resource'); return { requests: e.length, kB: Math.round(e.reduce((s, x) => s + (x.transferSize || 0), 0) / 1024), slowest: e.sort((a, b) => b.duration - a.duration).slice(0, 5).map((x) => `${Math.round(x.duration)}ms ${x.name.replace(location.origin, '')}`) } })
  console.log('load', JSON.stringify({ t: [R.t_title_ms, R.t_map_ready_ms, R.t_answer_card_ms, R.t_at_peak_ms, R.t_decision_ms], paint: R.paint, renderer: R.renderer }))
  console.log('phases', JSON.stringify([R.phases.load_to_card, R.phases.rise_card_to_peak, R.phases.peak_to_decision]))

  // ============================================================ 2. idle on a still map (rain as the hyetograph says)
  await page.waitForTimeout(3000)
  await phase(page, 'idle_still_map_8s', async () => { await page.waitForTimeout(8000) })
  // force rain on (as during the opening) to measure the rain overlay's cost on a still map
  await page.evaluate(() => window.__mv.water.setRain(0.8))
  await page.waitForTimeout(1500)
  await phase(page, 'idle_still_map_rain_on_8s', async () => { await page.waitForTimeout(8000) })
  await page.evaluate(() => window.__mv.water.setRain(0))
  await page.waitForTimeout(1500)
  await phase(page, 'idle_still_map_rain_off_8s', async () => { await page.waitForTimeout(8000) })

  // ============================================================ 3. scrubbing the timeline (input every 50 ms, all hours)
  // warm: let the preloader fetch frames first, then scrub
  await page.waitForTimeout(6000)
  await phase(page, 'scrub_timeline_6s', async () => {
    const n = await page.evaluate(async () => {
      const el = document.querySelector('.timeline input[type=range]')
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const max = Number(el.max); let k = 0
      const t0 = performance.now()
      while (performance.now() - t0 < 6000) {
        const h = 1 + (k % (2 * max - 2) < max ? k % (2 * max - 2) : 2 * max - 2 - (k % (2 * max - 2)))
        set.call(el, String(Math.max(1, Math.min(max, h)))); el.dispatchEvent(new Event('input', { bubbles: true })); k++
        await new Promise((r) => setTimeout(r, 50))
      }
      return k
    })
    return { inputs: n }
  })
  await page.screenshot({ path: `${out}/p04_after_scrub.png` })
  // ============================================================ 4. real mouse drag of the slider thumb
  await phase(page, 'scrub_mouse_drag_4s', async () => {
    const bb = await page.locator('.timeline input[type=range]').boundingBox()
    await page.mouse.move(bb.x + 4, bb.y + bb.height / 2); await page.mouse.down()
    for (let k = 0; k <= 80; k++) { await page.mouse.move(bb.x + 4 + (bb.width - 8) * (k <= 40 ? k / 40 : (80 - k) / 40), bb.y + bb.height / 2); await page.waitForTimeout(40) }
    await page.mouse.up()
  })
  // ============================================================ 5. panning the map
  await phase(page, 'pan_drag_4s', async () => {
    await page.mouse.move(1000, 500); await page.mouse.down()
    for (let k = 0; k < 100; k++) { await page.mouse.move(1000 - 300 * Math.sin(k / 16), 500 + 120 * Math.sin(k / 10)); await page.waitForTimeout(35) }
    await page.mouse.up()
  })
  await page.waitForTimeout(1500)
  await phase(page, 'zoom_wheel_3s', async () => {
    await page.mouse.move(1000, 450)
    for (let k = 0; k < 30; k++) { await page.mouse.wheel(0, k < 15 ? 120 : -120); await page.waitForTimeout(90) }
  })
  await page.waitForTimeout(2000)
  await phase(page, 'idle_after_interaction_5s', async () => { await page.waitForTimeout(5000) })

  // ============================================================ 6. time-lapse
  const btn = page.getByRole('button', { name: 'Watch the whole storm' })
  if (await btn.count()) {
    await phase(page, 'timelapse_full', async () => {
      const ta = Date.now()
      await btn.click()
      await page.waitForSelector('text=Back to my street', { timeout: 120_000 })
      return { playback_s: +((Date.now() - ta) / 1000).toFixed(1) }
    })
    await page.screenshot({ path: `${out}/p05_timelapse_end.png` })
  } else R.timelapse_button_missing = true
  await ctx.close()
}

// ================================================================ 7. dry default (live forecast 0 mm)
{
  const { ctx, page } = await newPage()
  const t0 = Date.now()
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.panel.left', { timeout: 180_000 })
  R.dry_t_panel_ms = Date.now() - t0
  const tp = await now(page)
  R.phases.dry_load_to_panel = await stats(page, 0, tp)
  R.dry_paint = await page.evaluate(() => ({ fcp: Math.round(performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? -1), lcp: Math.round(window.__lcp) }))
  await page.waitForTimeout(4000)
  await phase(page, 'dry_idle_8s', async () => { await page.waitForTimeout(8000) })
  await page.screenshot({ path: `${out}/p06_dry_default.png` })
  await ctx.close()
}

fs.writeFileSync(`${out}/qa3_perf_${RUN}.json`, JSON.stringify(R, null, 1))
console.log(JSON.stringify({ errors: R.page_errors, console: R.console.slice(0, 20), failed: R.failed_requests.slice(0, 20), http: R.http_errors.slice(0, 20) }, null, 1))
await browser.close()
