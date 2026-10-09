// QA: load performance + hero flow on several places + search edge cases + offline API behaviour.
// Run from web/: node ../review/qa/qa_hero.mjs
import { createRequire } from 'node:module'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
import fs from 'node:fs'

const base = 'http://127.0.0.1:5173/'
const out = '/home/tekiru/Desktop/highground/review/qa'
const PLACES = (process.env.QA_PLACES ?? 'Velachery|Arumugam Road|Pallikaranai|Kotturpuram|Saidapet|T. Nagar|Anna Nagar').split('|')

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(60_000)
const R = { console_errors: [], page_errors: [], failed_requests: [], http_errors: [] }
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') R.console_errors.push(`${m.type()}: ${m.text()}`.slice(0, 300)) })
page.on('pageerror', (e) => R.page_errors.push(String(e).slice(0, 300)))
page.on('requestfailed', (r) => R.failed_requests.push(`${r.failure()?.errorText} ${r.url()}`.slice(0, 300)))
page.on('response', (r) => { if (r.status() >= 400) R.http_errors.push(`${r.status()} ${r.url()}`.slice(0, 300)) })

// frame timestamps from the very first script
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
  return { fps: +(1000 * (f.length - 1) / (f[f.length - 1] - f[0])).toFixed(1), frames: f.length, long_frames_gt50ms: long, worst_ms: Math.round(worst) }
}, [a, b])
const now = () => page.evaluate(() => performance.now())

// ---------------------------------------------------------------- load
const t0 = Date.now()
await page.goto(base + '?replay=michaung2023', { waitUntil: 'domcontentloaded' })
R.t_domcontentloaded_ms = Date.now() - t0
await page.waitForFunction(() => !document.querySelector('.loading') || !document.querySelector('.loading').textContent.includes('Loading'), null, { timeout: 120_000 })
R.t_map_ready_ms = Date.now() - t0
await page.screenshot({ path: `${out}/01_map_ready.png` })
await page.waitForSelector('.panel.left', { timeout: 120_000 })
R.t_panel_ms = Date.now() - t0
await page.waitForSelector('.readout', { timeout: 120_000 })
R.t_answer_ms = Date.now() - t0
const tEnd = await now()
R.paint = await page.evaluate(() => ({ fcp: Math.round(performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? -1), lcp: Math.round(window.__lcp) }))
R.fps_load_sequence = await fpsBetween(0, tEnd)
R.renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return gl ? String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none' })
await page.waitForTimeout(3000)
await page.screenshot({ path: `${out}/02_default_answer.png` })

const card = async () => page.evaluate(() => {
  const q = (s) => document.querySelector(s)?.textContent?.trim() ?? null
  const panel = document.querySelector('.panel.left')
  const smalls = [...panel.querySelectorAll('.muted.small, .small')].map((e) => e.textContent.trim())
  return {
    street: q('.street'), readout: document.querySelector('.readout')?.getAttribute('aria-label') ?? null,
    when: q('.when'), band: q('.band'), decision: q('.decision'),
    at: smalls.find((s) => s.startsWith('At ')) ?? null,
    nearby: smalls.find((s) => s.includes('streets within')) ?? null,
    parking: [...panel.querySelectorAll('.park')].map((e) => e.textContent.trim()),
    route: [...panel.querySelectorAll('p.small.muted')].map((e) => e.textContent.trim()).find((s) => s.startsWith('Dry route') || s.startsWith('No route')) ?? null,
    no_parking: smalls.find((s) => s.startsWith('No mapped flyover')) ?? null,
    alert: q('[role=alert]'), timeline_now: q('.timeline .now'), scenario: smalls[0] ?? null,
  }
})
R.default = await card()

// ---------------------------------------------------------------- places
R.places = []
for (const [i, addr] of PLACES.entries()) {
  const r = { q: addr }
  try {
    await page.fill('.search input', '')
    await page.fill('.search input', addr)
    await page.waitForSelector('.suggest li', { timeout: 20_000 })
    r.suggestions = await page.locator('.suggest li').allTextContents()
    await page.locator('.suggest li').first().dispatchEvent('mousedown')
    const tp = Date.now()
    await page.waitForTimeout(1500)
    await page.waitForSelector('.readout, [role=alert]', { timeout: 60_000 })
    // wait for the decision to settle (if any)
    await page.waitForFunction(() => { const d = document.querySelector('.decision'); return !d || !d.textContent.includes('Working out') }, null, { timeout: 180_000 }).catch(() => { r.decision_timeout = true })
    await page.waitForTimeout(4500)  // fly + rise
    r.ms_to_settle = Date.now() - tp
    Object.assign(r, await card())
    // try "when to leave" on the first parking when no decision was computed automatically
    if (!r.route && r.parking.length) {
      const b = page.locator('button.linkbtn').first()
      if (await b.count()) {
        await b.click()
        await page.waitForFunction(() => [...document.querySelectorAll('p.small.muted')].some((e) => /^(Dry route|No route)/.test(e.textContent.trim())), null, { timeout: 180_000 }).catch(() => { r.route_timeout = true })
        Object.assign(r, { route_after_click: (await card()).route, at_after_route: (await card()).at })
      }
    }
  } catch (e) { r.error = String(e).slice(0, 300) }
  await page.screenshot({ path: `${out}/place_${i + 1}_${addr.replace(/\W+/g, '_')}.png` }).catch(() => {})
  R.places.push(r)
  console.log(JSON.stringify(r))
}

// ---------------------------------------------------------------- scrubbing fps on the last flooded place (Arumugam Road)
try {
  await page.fill('.search input', 'Arumugam Road')
  await page.waitForSelector('.suggest li')
  await page.locator('.suggest li').first().dispatchEvent('mousedown')
  await page.waitForTimeout(9000)
  const a = await now()
  await page.evaluate(async () => {
    const el = document.querySelector('.timeline input[type=range]')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const max = Number(el.max)
    for (let k = 0; k < 40; k++) {
      set.call(el, String(1 + (k * 3) % max)); el.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 100))
    }
  })
  R.fps_scrubbing = await fpsBetween(a, await now())
  // consistency: scrub to specific hours and read "At <time>: n cm" and the timeline label
  R.scrub_samples = []
  for (const h of [1, 5, 10, 31, 45, 54]) {
    await page.evaluate((h) => {
      const el = document.querySelector('.timeline input[type=range]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(h)); el.dispatchEvent(new Event('input', { bubbles: true }))
    }, h)
    await page.waitForTimeout(400)
    const c = await card()
    R.scrub_samples.push({ h, at: c.at, now: c.timeline_now, readout: c.readout, when: c.when })
  }
  await page.screenshot({ path: `${out}/scrub_arumugam.png` })
  const b = await now()
  await page.waitForTimeout(3000)
  R.fps_idle_after = await fpsBetween(b, await now())
} catch (e) { R.scrub_error = String(e).slice(0, 300) }

// ---------------------------------------------------------------- search edge cases
R.search_edge = []
for (const q of ['Madurai', 'xqzvplk', 'T Nagar', 'T.Nagar', 'Pondy Bazaar', 'IIT Madras', 'Ve']) {
  await page.fill('.search input', '')
  await page.fill('.search input', q)
  await page.waitForTimeout(1500)
  const s = await page.locator('.suggest li').allTextContents()
  const src = await page.locator('.search .source').textContent().catch(() => null)
  R.search_edge.push({ q, suggestions: s, source: src })
  if (q === 'xqzvplk') await page.screenshot({ path: `${out}/search_gibberish.png` })
  if (q === 'T Nagar') await page.screenshot({ path: `${out}/search_t_nagar.png` })
}
// press Enter on gibberish
await page.fill('.search input', 'xqzvplk'); await page.waitForTimeout(800); await page.press('.search input', 'Enter'); await page.waitForTimeout(800)
R.gibberish_enter_alert = await page.locator('[role=alert]').textContent().catch(() => null)
// Madurai: pick its first suggestion
await page.fill('.search input', 'Madurai'); await page.waitForSelector('.suggest li')
await page.locator('.suggest li').first().dispatchEvent('mousedown'); await page.waitForTimeout(9000)
R.madurai_pick = await card()
await page.screenshot({ path: `${out}/search_madurai.png` })

// ---------------------------------------------------------------- subscribe offline
try {
  await page.fill('.search input', 'Arumugam Road'); await page.waitForSelector('.suggest li')
  await page.locator('.suggest li').first().dispatchEvent('mousedown'); await page.waitForTimeout(8000)
  await page.click('button:has-text("Email me if this changes")')
  await page.fill('#email', 'not-an-email')
  await page.click('button:has-text("Subscribe")')
  await page.waitForTimeout(800)
  R.subscribe_invalid = { validity: await page.$eval('#email', (e) => e.validationMessage), status: await page.locator('form [role=status]').textContent().catch(() => null) }
  await page.fill('#email', 'qa@example.com')
  await page.click('button:has-text("Subscribe")')
  await page.waitForSelector('form [role=status]', { timeout: 15_000 })
  R.subscribe_offline = await page.locator('form [role=status]').textContent()
  R.subscribe_button = await page.locator('form button').textContent()
  await page.screenshot({ path: `${out}/subscribe_offline.png` })
} catch (e) { R.subscribe_error = String(e).slice(0, 300) }

// ---------------------------------------------------------------- assistant offline
try {
  await page.click('.panel.right.collapsed')
  await page.waitForSelector('.assistant')
  await page.click('.assistant .seg button >> nth=0')
  await page.waitForTimeout(1500)
  R.assistant_offline = await page.locator('.assistant .msg.bot').allTextContents()
  await page.fill('.assistant input', 'Someone is trapped, water rising inside my house')
  await page.press('.assistant input', 'Enter')
  await page.waitForTimeout(1500)
  R.assistant_offline_emergency = await page.locator('.assistant .msg.bot').allTextContents()
  await page.screenshot({ path: `${out}/assistant_offline.png` })
} catch (e) { R.assistant_error = String(e).slice(0, 300) }

fs.writeFileSync(`${out}/qa_hero_results.json`, JSON.stringify(R, null, 1))
console.log(JSON.stringify({ ...R, places: undefined }, null, 1))
await browser.close()
