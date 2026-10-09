// QA run 2: load performance + hero flow on six places + consistency checks + scrubbing fps.
// Run from web/: node ../review/qa/qa_hero.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')

const base = 'http://127.0.0.1:5173/'
const out = '/home/tekiru/Desktop/highground/review/qa'
const PLACES = (process.env.QA_PLACES ?? 'Velachery|Pallikaranai|Kotturpuram|T. Nagar|Anna Nagar|Arumugam Road').split('|')

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(90_000)
const R = { console: [], page_errors: [], failed_requests: [], http_errors: [] }
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') R.console.push(`${m.type()}: ${m.text()}`.slice(0, 300)) })
page.on('pageerror', (e) => R.page_errors.push(String(e).slice(0, 300)))
page.on('requestfailed', (r) => R.failed_requests.push(`${r.failure()?.errorText} ${r.url()}`.slice(0, 200)))
page.on('response', (r) => { if (r.status() >= 400) R.http_errors.push(`${r.status()} ${r.url()}`.slice(0, 200)) })

await page.addInitScript(() => {
  window.__ft = []
  const tick = (t) => { window.__ft.push(t); requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  window.__lcp = 0
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true }) } catch {}
})
const fpsBetween = (a, b) => page.evaluate(([a, b]) => {
  const f = window.__ft.filter((t) => t >= a && t <= b)
  if (f.length < 2) return null
  let long = 0, worst = 0
  for (let i = 1; i < f.length; i++) { const d = f[i] - f[i - 1]; if (d > 50) long++; worst = Math.max(worst, d) }
  return { fps: +(1000 * (f.length - 1) / (f[f.length - 1] - f[0])).toFixed(1), frames: f.length, long_frames_gt50ms: long, worst_ms: Math.round(worst), span_s: +((b - a) / 1000).toFixed(1) }
}, [a, b])
const now = () => page.evaluate(() => performance.now())

const card = () => page.evaluate(async () => {
  const q = (s) => document.querySelector(s)?.textContent?.trim() ?? null
  const panel = document.querySelector('.panel.left')
  const smalls = panel ? [...panel.querySelectorAll('.small')].map((e) => e.textContent.trim()) : []
  const m = window.__map
  const lineLen = async (id) => {
    const s = m?.getSource(id)
    if (!s) return null
    const d = s.getData ? await s.getData() : s._data
    const g = d?.geometry ?? d?.features?.[0]?.geometry
    return g?.coordinates?.length ?? 0
  }
  return {
    street: q('.street'), readout: document.querySelector('.readout')?.getAttribute('aria-label') ?? null,
    when: q('.when'), band: q('.band'), decision: q('.decision'),
    at: smalls.find((s) => s.startsWith('At ')) ?? null,
    nearby: smalls.find((s) => s.includes('streets within')) ?? null,
    parking: [...(panel?.querySelectorAll('.park') ?? [])].map((e) => e.textContent.trim()),
    no_parking: smalls.find((s) => s.startsWith('No mapped flyover')) ?? null,
    flyover_note: smalls.some((s) => s.startsWith('Check local traffic')),
    alert: q('.panel.left [role=alert]'), timeline_now: q('.timeline .now'),
    marker: document.querySelector('.tl-marker')?.textContent?.trim() ?? null,
    marker_left: document.querySelector('.tl-marker')?.style.left ?? null,
    slider: document.querySelector('.timeline input[type=range]') ? { v: document.querySelector('.timeline input[type=range]').value, max: document.querySelector('.timeline input[type=range]').max } : null,
    scenario: smalls[0] ?? null, subscribe_btn: [...(panel?.querySelectorAll('button') ?? [])].some((b) => b.textContent === 'Email me if this changes'),
    route_safe_pts: await lineLen('route-safe'), route_normal_pts: await lineLen('route-normal'),
    camera: m ? { c: m.getCenter().toArray().map((x) => +x.toFixed(4)), z: +m.getZoom().toFixed(2) } : null,
  }
})

// ---------------------------------------------------------------- load sequence
const t0 = Date.now()
await page.goto(base + '?replay=michaung2023', { waitUntil: 'domcontentloaded' })
R.t_domcontentloaded_ms = Date.now() - t0
await page.waitForFunction(() => !!document.querySelector('.map canvas'), null, { timeout: 120_000 })
R.t_canvas_ms = Date.now() - t0
await page.waitForSelector('.panel.left', { timeout: 180_000 })
R.t_panel_ms = Date.now() - t0
await page.screenshot({ path: `${out}/01_panel_appears.png` })
await page.waitForSelector('.readout', { timeout: 180_000 })
R.t_answer_card_ms = Date.now() - t0
const tEnd = await now()
R.paint = await page.evaluate(() => ({ fcp: Math.round(performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? -1), lcp: Math.round(window.__lcp) }))
R.fps_load_sequence = await fpsBetween(0, tEnd)
R.renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return gl ? String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none' })
await page.waitForFunction(() => { const d = document.querySelector('.decision'); return !d || !d.textContent.includes('Working out') && d.textContent.length > 0 }, null, { timeout: 240_000 }).catch(() => { R.default_decision_timeout = true })
await page.waitForTimeout(2500)
R.default = await card()
await page.screenshot({ path: `${out}/02_default_velachery.png` })
console.log('load', JSON.stringify({ t: [R.t_canvas_ms, R.t_panel_ms, R.t_answer_card_ms], paint: R.paint, fps: R.fps_load_sequence, renderer: R.renderer }))

// ---------------------------------------------------------------- places
R.places = []
for (const [i, addr] of PLACES.entries()) {
  const r = { q: addr }
  try {
    await page.fill('.search input', '')
    await page.fill('.search input', addr)
    await page.waitForSelector('.suggest li', { timeout: 30_000 })
    r.suggestions = await page.locator('.suggest li').allTextContents()
    await page.locator('.suggest li').first().dispatchEvent('mousedown')
    const tp = Date.now()
    await page.waitForSelector('.readout, .panel.left [role=alert]', { timeout: 90_000 })
    r.ms_to_card = Date.now() - tp
    await page.waitForTimeout(800)
    const hasDecision = await page.locator('.decision').count()
    if (hasDecision) {
      await page.waitForFunction(() => { const d = document.querySelector('.decision'); return d && d.textContent.length > 0 && !d.textContent.includes('Working out') }, null, { timeout: 240_000 }).catch(() => { r.decision_timeout = true })
      r.ms_to_decision = Date.now() - tp
    }
    await page.waitForTimeout(4000)  // fly + rise
    Object.assign(r, await card())
    await page.screenshot({ path: `${out}/place_${i + 1}_${addr.replace(/\W+/g, '_')}.png` })
    // no automatic decision: try "when to leave" on the first parking option
    if (!hasDecision && r.parking.length) {
      const b = page.locator('button.linkbtn').first()
      if (await b.count()) {
        const tb = Date.now()
        await b.click()
        await page.waitForFunction(() => !document.querySelector('button.linkbtn[disabled]'), null, { timeout: 240_000 }).catch(() => { r.route_click_timeout = true })
        await page.waitForTimeout(1200)
        const c = await card()
        r.after_when_to_leave = { ms: Date.now() - tb, route_safe_pts: c.route_safe_pts, marker: c.marker, decision: c.decision, parking: c.parking }
      }
    }
    // click the leave-by marker: depth at the leave-by hour
    if (await page.locator('.tl-marker').count()) {
      await page.locator('.tl-marker').click()
      await page.waitForTimeout(600)
      r.at_leave_by = (await card()).at
      r.now_at_leave_by = (await card()).timeline_now
    }
  } catch (e) { r.error = String(e).slice(0, 300) }
  R.places.push(r)
  console.log(JSON.stringify(r))
}

// ---------------------------------------------------------------- Arumugam Road: scrub fps + hour-by-hour consistency
try {
  // place 6 is Arumugam Road; make sure we are on it
  const a = await now()
  await page.evaluate(async () => {
    const el = document.querySelector('.timeline input[type=range]')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const max = Number(el.max)
    for (let k = 0; k < 50; k++) {
      set.call(el, String(1 + (k * 3) % max)); el.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 80))
    }
  })
  R.fps_scrubbing = await fpsBetween(a, await now())
  R.scrub_samples = []
  for (const h of [1, 4, 5, 6, 10, 31, 45, 54]) {
    await page.evaluate((h) => {
      const el = document.querySelector('.timeline input[type=range]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(h)); el.dispatchEvent(new Event('input', { bubbles: true }))
    }, h)
    await page.waitForTimeout(500)
    const c = await card()
    R.scrub_samples.push({ h, at: c.at, now: c.timeline_now, readout: c.readout })
  }
  await page.screenshot({ path: `${out}/scrub_arumugam_h54.png` })
  const b = await now()
  await page.waitForTimeout(4000)
  R.fps_idle = await fpsBetween(b, await now())
  // camera pan fps (map interaction)
  const c0 = await now()
  await page.mouse.move(900, 450); await page.mouse.down()
  for (let k = 0; k < 30; k++) { await page.mouse.move(900 - k * 10, 450 + (k % 5)); await page.waitForTimeout(30) }
  await page.mouse.up()
  R.fps_pan = await fpsBetween(c0, await now())
} catch (e) { R.scrub_error = String(e).slice(0, 300) }

// ---------------------------------------------------------------- subscribe form (offline)
try {
  await page.click('button:has-text("Email me if this changes")')
  R.subscribe_label = await page.locator('form label').textContent()
  await page.fill('#email', 'not-an-email')
  await page.click('form button:has-text("Subscribe")')
  await page.waitForTimeout(600)
  R.subscribe_invalid = await page.$eval('#email', (e) => e.validationMessage)
  await page.fill('#email', 'qa@example.com')
  await page.click('form button:has-text("Subscribe")')
  await page.waitForSelector('form [role=status]', { timeout: 15_000 })
  R.subscribe_offline = await page.locator('form [role=status]').textContent()
  R.subscribe_sms_note = await page.locator('form p.muted').last().textContent()
  await page.screenshot({ path: `${out}/subscribe_offline.png` })
} catch (e) { R.subscribe_error = String(e).slice(0, 300) }

fs.writeFileSync(`${out}/qa_hero_results.json`, JSON.stringify(R, null, 1))
console.log(JSON.stringify({ ...R, places: undefined, default: R.default }, null, 1))
await browser.close()
