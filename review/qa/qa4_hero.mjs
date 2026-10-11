// QA run 4 (copy of qa3_hero.mjs, output run4, pre-wet note captured): the hero flow on many places across the three replays. For each place: the rise (readout,
// glyph and slider sampled every 100 ms), the settled card, parking (+ "1 more"), the leave-by decision and
// marker, then every hour scrubbed and read back ("At ...: N cm" and the timeline clock).
// Run from web/: node ../review/qa/qa4_hero.mjs [runs comma-separated]
import { createRequire } from 'node:module'
import fs from 'node:fs'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const base = process.env.QA_BASE ?? 'http://127.0.0.1:5173/'
const out = '/home/tekiru/Desktop/highground/review/qa/run4'
const RUNS = (process.argv[2] ?? 'michaung2023,dec2015_reservoir,fengal2024').split(',')
const PLACES = (process.env.QA_PLACES ?? 'Pallikaranai|Kotturpuram|T. Nagar|Anna Nagar|Arumugam Road|Dhandeeswaram Nagar 8th|Kakkan Nagar Main Road|Saidapet|Madipakkam').split('|')
fs.mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ALL = { console: [], page_errors: [], failed_requests: [], http_errors: [], results: [] }

const card = (page) => page.evaluate(async () => {
  const q = (s) => document.querySelector(s)?.textContent?.trim() ?? null
  const panel = document.querySelector('.panel.left')
  const smalls = panel ? [...panel.querySelectorAll('.small')].map((e) => e.textContent.trim()) : []
  const m = window.__map
  const src = async (id) => { const s = m?.getSource(id); if (!s) return null; const d = await s.getData(); return d }
  const here = await src('here')
  const rs = await src('route-safe'), rn = await src('route-normal'), pk = await src('parking')
  const sl = document.querySelector('.timeline input[type=range]')
  return {
    street: q('.street'), readout_label: document.querySelector('.readout')?.getAttribute('aria-label') ?? null,
    readout_shown: document.querySelector('.readout span')?.textContent ?? null,
    readout_style: document.querySelector('.readout')?.style.fontVariationSettings ?? null,
    when: q('.when'), band: q('.band'), decision: q('.decision'),
    glyph: document.querySelector('.glyph')?.getAttribute('aria-label') ?? null,
    at: smalls.find((s) => s.startsWith('At ')) ?? null,
    nearby: smalls.find((s) => s.includes('streets within')) ?? null,
    parking: [...(panel?.querySelectorAll('.park') ?? [])].map((e) => e.textContent.trim()),
    more_btn: [...(panel?.querySelectorAll('button.linkbtn') ?? [])].map((b) => b.textContent.trim()),
    no_parking: smalls.find((s) => s.startsWith('No mapped flyover')) ?? null,
    route_note: smalls.find((s) => s.startsWith('Your street stays dry') || s.startsWith('No practical')) ?? null,
    flyover_note: smalls.some((s) => s.startsWith('Check local traffic')),
    alert: q('.panel.left [role=alert]'), pre_note: smalls.find((s) => s.startsWith('Low ground')) ?? null,
    scenario_line: smalls[0] ?? null,
    timeline_now: q('.timeline .now'), timeline_rain: q('.timeline .muted.small'), ticks: [...document.querySelectorAll('.timeline .ticks span')].map((s) => s.textContent),
    slider: sl ? { v: +sl.value, max: +sl.max } : null,
    marker: document.querySelector('.tl-marker')?.textContent?.trim() ?? null,
    marker_left: document.querySelector('.tl-marker')?.style.left ?? null,
    watch_btn: !!document.querySelector('.timeline .small-btn'),
    subscribe_btn: [...(panel?.querySelectorAll('button') ?? [])].some((b) => b.textContent === 'Email me if this changes'),
    subscribe_visible: (() => { const b = [...(panel?.querySelectorAll('button') ?? [])].find((x) => x.textContent === 'Email me if this changes'); if (!b) return null; const r = b.getBoundingClientRect(), pr = panel.getBoundingClientRect(); return r.bottom <= Math.min(innerHeight, pr.bottom) && r.top >= pr.top })(),
    here: here?.geometry?.coordinates ?? null,
    route_safe_pts: rs?.geometry?.coordinates?.length ?? 0, route_normal_pts: rn?.geometry?.coordinates?.length ?? 0,
    parking_pins: pk?.features?.map((f) => f.properties.name) ?? [],
    camera: m ? { c: m.getCenter().toArray().map((x) => +x.toFixed(4)), z: +m.getZoom().toFixed(2), p: Math.round(m.getPitch()) } : null,
  }
})

// sample the rise: readout shown number, glyph, slider value, note, every 100 ms until "at the peak" (or 12 s)
const sampleRise = (page) => page.evaluate(async () => {
  const s = []
  const t0 = performance.now()
  while (performance.now() - t0 < 12000) {
    const r = document.querySelector('.readout')
    const sl = document.querySelector('.timeline input[type=range]')
    s.push({ t: Math.round(performance.now() - t0), n: r ? +r.querySelector('span').textContent : null, label: r?.getAttribute('aria-label') ?? null,
      glyph: document.querySelector('.glyph')?.getAttribute('aria-label')?.match(/Water at (\d+)/)?.[1] ?? null, h: sl ? +sl.value : null, now: document.querySelector('.timeline .now')?.textContent ?? null })
    if (r?.getAttribute('aria-label')?.includes('at the peak') && s.length > 3) break
    if (r && !r.querySelector('.note') && s.length > 50 && s.slice(-10).every((x) => x.h === s[s.length - 1].h)) break
    await new Promise((res) => setTimeout(res, 100))
  }
  return s
})

const settle = async (page) => {
  await page.waitForFunction(() => { const d = document.querySelector('.decision'); return !d || (d.textContent.length > 0 && !d.textContent.includes('Working out')) }, null, { timeout: 240_000 }).catch(() => 'timeout')
}

// read every hour back from the UI
const scrubAll = (page) => page.evaluate(async () => {
  const el = document.querySelector('.timeline input[type=range]')
  if (!el) return null
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  const out = []
  for (let h = 1; h <= +el.max; h++) {
    set.call(el, String(h)); el.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
    const at = [...document.querySelectorAll('.panel.left .small')].map((e) => e.textContent.trim()).find((s) => s.startsWith('At '))
    out.push({ h, now: document.querySelector('.timeline .now')?.textContent, at: at ?? null, readout: document.querySelector('.readout span')?.textContent,
      rain: document.querySelector('.timeline .muted.small')?.textContent })
  }
  return out
})

for (const run of RUNS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(120_000)
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') ALL.console.push(`${run} ${m.type()}: ${m.text()}`.slice(0, 300)) })
  page.on('pageerror', (e) => ALL.page_errors.push(`${run} ${String(e).slice(0, 300)}`))
  page.on('requestfailed', (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) ALL.failed_requests.push(`${run} ${r.failure()?.errorText} ${r.url()}`.slice(0, 200)) })
  page.on('response', (r) => { if (r.status() >= 400) ALL.http_errors.push(`${run} ${r.status()} ${r.url()}`.slice(0, 200)) })
  await page.goto(`${base}?replay=${run}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.readout', { timeout: 180_000 })
  // opening default place (Velachery)
  const list = ['(opening) Velachery', ...PLACES]
  for (const [i, q] of list.entries()) {
    const r = { run, q }
    try {
      if (i > 0) {
        await page.fill('.search input', '')
        await page.fill('.search input', q)
        await page.waitForSelector('.suggest li', { timeout: 30_000 })
        r.picked = (await page.locator('.suggest li').first().textContent())
        await page.locator('.suggest li').first().dispatchEvent('mousedown')
        await page.waitForSelector('.readout, .panel.left [role=alert]', { timeout: 90_000 })
      }
      r.rise = await sampleRise(page)
      await settle(page)
      await page.waitForTimeout(1200)
      r.card = await card(page)
      await page.screenshot({ path: `${out}/h_${run}_${i}_${q.replace(/\W+/g, '_')}.png` })
      // "1 more dry place nearby"
      const more = page.locator('button.linkbtn', { hasText: 'more dry place' })
      if (await more.count()) { await more.click(); await page.waitForTimeout(300); r.parking_after_more = (await card(page)).parking }
      // "when to leave" on a parking option without a decision (dry streets)
      const wtl = page.locator('button.linkbtn', { hasText: 'when to leave' }).first()
      if (!r.card.decision && await wtl.count()) {
        const t = Date.now(); await wtl.click()
        await page.waitForFunction(() => !document.querySelector('button.linkbtn[disabled]'), null, { timeout: 120_000 }).catch(() => {})
        await page.waitForTimeout(800)
        const c = await card(page)
        r.when_to_leave = { ms: Date.now() - t, route_note: c.route_note, route_safe_pts: c.route_safe_pts, marker: c.marker, decision: c.decision }
      }
      r.hours = await scrubAll(page)
      // leave-by marker click
      if (await page.locator('.tl-marker').count()) { await page.locator('.tl-marker').click(); await page.waitForTimeout(400); const c = await card(page); r.marker_click = { at: c.at, now: c.timeline_now, slider: c.slider } }
    } catch (e) { r.error = String(e).slice(0, 300) }
    ALL.results.push(r)
    console.log(JSON.stringify({ run, q, street: r.card?.street, readout: r.card?.readout_label, when: r.card?.when, glyph: r.card?.glyph, band: r.card?.band, decision: r.card?.decision, marker: r.card?.marker, pre: r.card?.pre_note, nearby: r.card?.nearby, parking: r.card?.parking, err: r.error }))
  }
  await page.close()
}
fs.writeFileSync(`${out}/qa4_hero.json`, JSON.stringify(ALL, null, 1))
console.log(JSON.stringify({ errors: ALL.page_errors, console: ALL.console.slice(0, 20), failed: ALL.failed_requests.slice(0, 20), http: ALL.http_errors.slice(0, 20) }, null, 1))
await browser.close()
