// QA run 2: dry default view, replay switch, What if, Proof, Hospitals, About, Admin, assistant offline,
// search edge cases, 112-only-red check, reduced motion. Run from web/: node ../review/qa/qa_screens.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')

const base = 'http://127.0.0.1:5173/'
const out = '/home/tekiru/Desktop/highground/review/qa'
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(90_000)
const R = { console: [], page_errors: [], failed_requests: [], http_errors: [] }
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') R.console.push(`${m.type()}: ${m.text()}`.slice(0, 300)) })
page.on('pageerror', (e) => R.page_errors.push(String(e).slice(0, 300)))
page.on('requestfailed', (r) => R.failed_requests.push(`${r.failure()?.errorText} ${r.url()}`.slice(0, 200)))
page.on('response', (r) => { if (r.status() >= 400) R.http_errors.push(`${r.status()} ${r.url()}`.slice(0, 200)) })
const step = async (name, fn) => { try { await fn() } catch (e) { R[`${name}_error`] = String(e).slice(0, 300); console.log('ERR', name, String(e).slice(0, 200)) } }
const txt = (s) => page.locator(s).first().textContent().catch(() => null)
const panelText = () => page.evaluate(() => document.querySelector('.panel.left')?.innerText ?? null)
// every element whose computed text colour is red-ish, and which ones they are
const redScan = () => page.evaluate(() => {
  const hits = []
  for (const el of document.querySelectorAll('body *')) {
    if (!el.childNodes.length || !(el.offsetWidth || el.offsetHeight)) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    const cs = getComputedStyle(el)
    for (const prop of own ? ['color', 'backgroundColor', 'borderTopColor'] : ['backgroundColor', 'borderTopColor']) {
      const m = cs[prop].match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/)
      if (!m || (m[4] !== undefined && +m[4] < 0.2)) continue
      const [r, g, b] = [+m[1], +m[2], +m[3]]
      if (r > 180 && g < 110 && b < 110) hits.push(`${el.tagName.toLowerCase()}.${el.className}:${prop}:${el.textContent.trim().slice(0, 30)}`)
    }
  }
  return hits
})
const pickSearch = async (q) => {
  await page.fill('.search input', '')
  await page.fill('.search input', q)
  await page.waitForSelector('.suggest li', { timeout: 30_000 })
  await page.locator('.suggest li').first().dispatchEvent('mousedown')
}
const settle = async () => {
  await page.waitForSelector('.readout, .panel.left [role=alert]', { timeout: 90_000 }).catch(() => {})
  await page.waitForFunction(() => { const d = document.querySelector('.decision'); return !d || (d.textContent.length > 0 && !d.textContent.includes('Working out')) }, null, { timeout: 240_000 }).catch(() => {})
  await page.waitForTimeout(3000)
}
const cardBrief = () => page.evaluate(() => {
  const q = (s) => document.querySelector(s)?.textContent?.trim() ?? null
  const sm = [...(document.querySelector('.panel.left')?.querySelectorAll('.small') ?? [])].map((e) => e.textContent.trim())
  return { scenario: sm[0], street: q('.street'), readout: document.querySelector('.readout')?.getAttribute('aria-label') ?? null, when: q('.when'), band: q('.band'),
    decision: q('.decision'), at: sm.find((s) => s.startsWith('At ')) ?? null, marker: q('.tl-marker'), now: q('.timeline .now'),
    slider_max: document.querySelector('.timeline input[type=range]')?.max ?? null, ticks: q('.timeline .ticks'),
    pressed: [...document.querySelectorAll('.seg.tight button[aria-pressed=true]')].map((b) => b.textContent) }
})

// ---------------------------------------------------------------- default (live, dry) view
await step('default', async () => {
  const t0 = Date.now()
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.panel.left', { timeout: 180_000 })
  await page.waitForTimeout(2500)
  R.default_ms = Date.now() - t0
  R.default_panel = await panelText()
  R.default_has_timeline = await page.locator('.timeline').count()
  R.red_default = await redScan()
  await page.screenshot({ path: `${out}/10_default_dry.png` })
  await page.click('button:has-text("See Cyclone Michaung as if it were tonight")')
  await settle()
  R.after_primary_replay = await cardBrief()
  await page.screenshot({ path: `${out}/11_after_primary_replay.png` })
})

// ---------------------------------------------------------------- replay switch on Arumugam Road
await step('replays', async () => {
  await pickSearch('Arumugam Road')
  await settle()
  R.replays = {}
  for (const [btn, key] of [['2015', 'dec2015'], ['Michaung 2023', 'michaung'], ['Fengal 2024', 'fengal'], ['Tonight', 'tonight']]) {
    await page.click(`.seg.tight button:has-text("${btn}")`)
    await settle()
    R.replays[key] = await cardBrief()
    R.replays[key].panel_tail = (await panelText())?.slice(0, 400)
    await page.screenshot({ path: `${out}/12_replay_${key}.png` })
    console.log(key, JSON.stringify(R.replays[key]))
  }
  R.red_tonight = await redScan()
})

// ---------------------------------------------------------------- assistant offline (on Tonight)
await step('assistant', async () => {
  await page.click('.panel.right.collapsed')
  await page.waitForSelector('.assistant')
  await page.click('.assistant .seg button >> nth=0')
  await page.waitForTimeout(1500)
  R.assistant_suggest = await page.locator('.assistant .msg.bot').allTextContents()
  await page.fill('.assistant input', 'Someone is trapped, water rising inside my house')
  await page.press('.assistant input', 'Enter')
  await page.waitForTimeout(1500)
  R.assistant_emergency = await page.locator('.assistant .msg.bot').allTextContents()
  await page.fill('.assistant input', '   ')
  await page.press('.assistant input', 'Enter')
  await page.waitForTimeout(500)
  R.assistant_blank_msgs = await page.locator('.assistant .msg').count()
  R.assistant_intro = await txt('.assistant p.muted')
  R.red_assistant = await redScan()
  await page.screenshot({ path: `${out}/13_assistant_offline.png` })
  await page.click('.assistant button:has-text("Close")')
})

// ---------------------------------------------------------------- search edge cases
await step('search', async () => {
  await page.click('.seg.tight button:has-text("Michaung 2023")')
  await page.waitForTimeout(1500)
  R.search = []
  for (const q of ['Madurai', 'xqzvplk', 'T Nagar', 'T. Nagar', 'Ve', 'velachery', 'Edayanchavadi']) {
    await page.fill('.search input', '')
    await page.fill('.search input', q)
    await page.waitForTimeout(2000)
    R.search.push({ q, suggestions: await page.locator('.suggest li').allTextContents(), source: await txt('.search .source') })
    if (q === 'xqzvplk') {
      await page.press('.search input', 'Enter'); await page.waitForTimeout(800)
      R.search_gibberish_panel = (await panelText())?.slice(0, 300)
      await page.screenshot({ path: `${out}/14_search_gibberish.png` })
    }
  }
  // Madurai: the first suggestion is a Chennai street named after Madurai
  await pickSearch('Madurai'); await settle()
  R.madurai_pick = await cardBrief()
  await page.screenshot({ path: `${out}/15_search_madurai.png` })
  // farthest gazetteer place from any street
  await pickSearch('Edayanchavadi'); await settle()
  R.edayanchavadi = { ...(await cardBrief()), alert: await txt('.panel.left [role=alert]') }
  await page.screenshot({ path: `${out}/16_edayanchavadi.png` })
  // keyboard: arrow down + enter
  await page.fill('.search input', ''); await page.fill('.search input', 'Kotturpuram'); await page.waitForSelector('.suggest li')
  await page.press('.search input', 'ArrowDown'); await page.press('.search input', 'Enter'); await settle()
  R.keyboard_pick = await cardBrief()
})

// ---------------------------------------------------------------- What if
await step('whatif', async () => {
  await page.click('nav button:has-text("What if")')
  await page.waitForSelector('.big-range')
  await page.waitForTimeout(4000)
  const read = async () => ({ mm: await txt('.panel.left .stat'), text: (await panelText())?.replace(/\s+/g, ' ').slice(0, 600),
    water_nonzero: await page.evaluate(() => { const w = window.__mv?.water; return w ? Object.keys(w).filter((k) => /frame|tex/i.test(k)) : null }) })
  const setMm = async (v) => {
    await page.evaluate((v) => {
      const el = document.querySelector('.big-range')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true }))
    }, v)
    await page.waitForTimeout(3500)
  }
  R.whatif = {}
  R.whatif['200'] = await read(); await page.screenshot({ path: `${out}/20_whatif_200.png` })
  await setMm(400); R.whatif['400'] = await read(); await page.screenshot({ path: `${out}/21_whatif_400.png` })
  await setMm(250); R.whatif['250'] = await read()
  await setMm(100); R.whatif['100'] = await read(); await page.screenshot({ path: `${out}/22_whatif_100.png` })
  await setMm(200); await page.click('button:has-text("High tide")'); await page.waitForTimeout(3000)
  R.whatif['200_high'] = await read(); await page.screenshot({ path: `${out}/23_whatif_200_high.png` })
  await page.click('button:has-text("Mean tide")'); await page.waitForTimeout(1500)
  // fps while dragging the slider
  const a = await page.evaluate(() => performance.now())
  await page.evaluate(() => { window.__ft2 = []; const tick = (t) => { window.__ft2.push(t); if (window.__ft2.length < 2000) requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  for (const v of [210, 190, 200, 150, 120, 100, 200]) await setMm(v).catch(() => {})
  R.fps_whatif = await page.evaluate(() => { const f = window.__ft2; return +(1000 * (f.length - 1) / (f[f.length - 1] - f[0])).toFixed(1) })
  R.red_whatif = await redScan()
})

// ---------------------------------------------------------------- Proof
await step('proof', async () => {
  await page.click('nav button:has-text("Proof")')
  await page.waitForSelector('.strip', { timeout: 60_000 })
  await page.waitForTimeout(5000)
  R.proof_center = (await page.locator('.proof-center').innerText()).replace(/\s+/g, ' ')
  R.proof_strip = await page.locator('.strip .mk').allTextContents()
  await page.screenshot({ path: `${out}/30_proof.png` })
  const h = page.locator('.proof-handle')
  const bb = await h.boundingBox()
  R.proof_handle_box = bb
  const clip = () => page.evaluate(() => [...document.querySelectorAll('div')].find((d) => d.style.clipPath?.startsWith('inset'))?.style.clipPath ?? null)
  R.proof_clip_before = await clip()
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2)
  await page.mouse.down()
  for (let k = 1; k <= 10; k++) await page.mouse.move(bb.x - k * 40, bb.y + bb.height / 2, { steps: 2 })
  await page.mouse.up()
  await page.waitForTimeout(800)
  R.proof_clip_after_drag_left = await clip()
  await page.screenshot({ path: `${out}/31_proof_drag.png` })
  await h.focus(); for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowRight')
  R.proof_clip_after_keys = await clip()
  // collapsibles
  const sums = page.locator('details.tests summary')
  R.proof_summaries = await sums.allTextContents()
  for (let i = 0; i < await sums.count(); i++) await sums.nth(i).click()
  await page.waitForTimeout(800)
  R.proof_details_open = await page.evaluate(() => [...document.querySelectorAll('details.tests')].map((d) => d.open))
  R.proof_table = await page.locator('.proof-table').innerText().catch(() => null)
  R.proof_bottom_text = (await page.locator('.proof-bottom').innerText()).replace(/\s+/g, ' ').slice(0, 2500)
  R.proof_bottom_overflow = await page.evaluate(() => { const e = document.querySelector('.proof-bottom'); const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, scrollH: e.scrollHeight, clientH: e.clientHeight, overflowY: getComputedStyle(e).overflowY } })
  await page.screenshot({ path: `${out}/32_proof_details_open.png` })
  for (let i = 0; i < await sums.count(); i++) await sums.nth(i).click()
  for (const [b, k] of [['Detail: ANUGA', 'anuga'], ['Detail: fast model', 'fast'], ['2015 split view', 'split']]) {
    await page.click(`button:has-text("${b}")`)
    await page.waitForTimeout(4000)
    R[`proof_${k}`] = { label: await page.locator('.proof-label').allTextContents(), has_detail_layer: await page.evaluate(() => !!window.__map.getLayer('detail')), handle: await page.locator('.proof-handle').count(), center: await page.locator('.proof-center').count() }
    await page.screenshot({ path: `${out}/33_proof_${k}.png` })
  }
  R.red_proof = await redScan()
})

// ---------------------------------------------------------------- Hospitals
await step('hospitals', async () => {
  await page.click('nav button:has-text("Hospitals")')
  await page.waitForSelector('.hlist li', { timeout: 60_000 })
  await page.waitForTimeout(3000)
  R.hosp_header = (await panelText())?.split('\n').slice(0, 6).join(' | ')
  R.hosp_buttons = await page.evaluate(() => [...document.querySelectorAll('.panel.left .seg button')].map((b) => `${b.textContent}${b.disabled ? ' (disabled)' : ''}${b.getAttribute('aria-pressed') === 'true' ? ' (on)' : ''}`))
  R.hosp_count = await page.locator('.hlist li').count()
  R.hosp_cut = await page.locator('.hlist li.cut').count()
  R.hosp_first5 = (await page.locator('.hlist li').allTextContents()).slice(0, 5)
  await page.screenshot({ path: `${out}/40_hospitals.png` })
  await page.locator('.hlist li.cut').first().click()
  await page.waitForTimeout(6000)
  R.hosp_tap_cut = { msg: await txt('.panel.left p.small:not(.muted)'), route: await page.evaluate(async () => { const s = window.__map.getSource('route-safe'); const d = await s.getData(); return d?.geometry?.coordinates?.length ?? d?.features?.length ?? 0 }) }
  await page.screenshot({ path: `${out}/41_hospital_cut.png` })
  await page.locator('.hlist li:not(.cut)').first().click()
  await page.waitForFunction(() => !(document.querySelector('.panel.left')?.innerText ?? '').includes('Finding a dry route'), null, { timeout: 120_000 }).catch(() => {})
  await page.waitForTimeout(3000)
  R.hosp_tap_reach = { name: await txt('.hlist li[aria-current=true]'), msg: await txt('.panel.left p.small:not(.muted)'), route: await page.evaluate(async () => { const s = window.__map.getSource('route-safe'); const d = await s.getData(); return d?.geometry?.coordinates?.length ?? 0 }) }
  await page.screenshot({ path: `${out}/42_hospital_reachable.png` })
  R.red_hosp = await redScan()
})

// ---------------------------------------------------------------- About + Admin
await step('about', async () => {
  await page.click('nav button:has-text("About the model")')
  await page.waitForSelector('.panel.about')
  await page.waitForTimeout(1500)
  R.about_text_len = (await page.locator('.panel.about').innerText()).length
  R.about_has = await page.evaluate(() => { const t = document.querySelector('.panel.about').innerText; return ['30 m', 'Copernicus', 'OpenStreetMap', 'Open-Meteo', 'OpenCity', 'not an official warning', 'CFLOWS', 'NOAA'].map((k) => `${k}:${t.toLowerCase().includes(k.toLowerCase())}`) })
  R.about_scroll = await page.evaluate(() => { const e = document.querySelector('.panel.about'); const r = e.getBoundingClientRect(); return { bottom: r.bottom, vh: innerHeight, scrollH: e.scrollHeight, clientH: e.clientHeight } })
  R.red_about = await redScan()
  await page.screenshot({ path: `${out}/50_about.png` })
  await page.goto(base + '?replay=michaung2023#admin', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.panel.left h2', { timeout: 180_000 })
  await page.click('button:has-text("Run now")')
  await page.waitForTimeout(1000)
  R.admin = (await panelText())?.replace(/\s+/g, ' ')
  await page.screenshot({ path: `${out}/51_admin.png` })
})

// ---------------------------------------------------------------- reduced motion + narrow viewport
await step('reduced_motion', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const p2 = await ctx.newPage()
  const t0 = Date.now()
  await p2.goto(base + '?replay=michaung2023', { waitUntil: 'domcontentloaded' })
  await p2.waitForSelector('.readout', { timeout: 180_000 })
  R.reduced_motion_answer_ms = Date.now() - t0
  await p2.waitForTimeout(1500)
  await p2.screenshot({ path: `${out}/60_reduced_motion.png` })
  await p2.setViewportSize({ width: 390, height: 844 })
  await p2.waitForTimeout(2500)
  R.mobile = await p2.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, panel: (() => { const r = document.querySelector('.panel.left')?.getBoundingClientRect(); return r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null })(), nav: (() => { const r = document.querySelector('.nav')?.getBoundingClientRect(); return r ? [Math.round(r.left), Math.round(r.width)] : null })() }))
  await p2.screenshot({ path: `${out}/61_mobile_390.png` })
  await ctx.close()
})

fs.writeFileSync(`${out}/qa_screens_results.json`, JSON.stringify(R, null, 1))
console.log(JSON.stringify(R, null, 1).slice(0, 20000))
await browser.close()
