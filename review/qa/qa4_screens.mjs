// QA run 4 (copy of qa3_screens.mjs; output run4; ANUGA check uses the CSI wording): time-lapse captions (all three replays), What if extremes and tides, Hospitals, Proof (vs proof.json,
// licence notice), About, dry default + search on a dry night, edge-case searches, assistant/subscribe offline,
// screen switching, reduced motion, 390x844 mobile. Run from web/: node ../review/qa/qa4_screens.mjs [section,...]
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const { chromium } = createRequire('/home/tekiru/Desktop/highground/web/package.json')('@playwright/test')
const base = process.env.QA_BASE ?? 'http://127.0.0.1:5173/'
const out = '/home/tekiru/Desktop/highground/review/qa/run4'
const ONLY = process.argv[2] ? process.argv[2].split(',') : null
const want = (s) => !ONLY || ONLY.includes(s)
const DATA = '/home/tekiru/Desktop/highground/data/out/web'
const runs = JSON.parse(fs.readFileSync(`${DATA}/runs.json`, 'utf8'))
const hosp = JSON.parse(fs.readFileSync(`${DATA}/hospitals.json`, 'utf8'))
const proof = JSON.parse(fs.readFileSync(`${DATA}/proof.json`, 'utf8'))
const lapseRef = JSON.parse(execFileSync('python3', ['/home/tekiru/Desktop/highground/review/qa/lapse_ref3.py', 'dec2015_reservoir', 'michaung2023', 'fengal2024'], { encoding: 'utf8' }))

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const R = { console: [], page_errors: [], failed_requests: [], http_errors: [], fails: [] }
const fail = (k, msg) => { R.fails.push(`${k}: ${msg}`); console.log('FAIL', k, msg) }
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts })
  const page = await ctx.newPage()
  page.setDefaultTimeout(90_000)
  page.on('console', async (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return
    const parts = []
    for (const a of m.args()) parts.push(await a.evaluate((e) => (e && e.stack) ? `${e.name}: ${e.message} | ${e.stack.split('\n').slice(0, 5).join(' <- ')}` : String(e).slice(0, 200)).catch(() => '?'))
    R.console.push(`${m.type()} [${R.section ?? ''}]: ${m.text()} :: ${parts.join(' ;; ')}`.slice(0, 700))
  })
  page.on('pageerror', (e) => R.page_errors.push(`${String(e).slice(0, 200)} | ${(e.stack ?? '').split('\n').slice(1, 3).join(' ').slice(0, 200)}`))
  page.on('requestfailed', (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) R.failed_requests.push(`${r.failure()?.errorText} ${r.url()}`.slice(0, 200)) })
  page.on('response', (r) => { if (r.status() >= 400) R.http_errors.push(`${r.status()} ${r.url()}`.slice(0, 200)) })
  return { ctx, page }
}
const panelText = (page) => page.evaluate(() => document.querySelector('.panel.left')?.innerText ?? null)
const settle = async (page) => {
  await page.waitForSelector('.readout, .panel.left [role=alert]', { timeout: 120_000 }).catch(() => {})
  await page.waitForFunction(() => { const r = document.querySelector('.readout'); return !r || r.getAttribute('aria-label').includes('at the peak') || +r.getAttribute('aria-label').match(/\d+/)[0] < 5 }, null, { timeout: 30_000 }).catch(() => {})
  await page.waitForFunction(() => { const d = document.querySelector('.decision'); return !d || (d.textContent.length > 0 && !d.textContent.includes('Working out')) }, null, { timeout: 240_000 }).catch(() => {})
  await page.waitForTimeout(1500)
}
const pick = async (page, q) => {
  await page.fill('.search input', ''); await page.fill('.search input', q)
  await page.waitForSelector('.suggest li', { timeout: 20_000 })
  const first = await page.locator('.suggest li').first().textContent()
  await page.locator('.suggest li').first().dispatchEvent('mousedown')
  return first
}
const norm = (s) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
// overlapping visible boxes among important UI elements
const overlaps = (page, sels) => page.evaluate((sels) => {
  const boxes = sels.map((s) => [s, document.querySelector(s)?.getBoundingClientRect()]).filter(([, r]) => r && r.width && r.height)
  const o = []
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, A] = boxes[i], [b, B] = boxes[j]
    const w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top)
    if (w > 2 && h > 2) o.push(`${a} x ${b}: ${Math.round(w)}x${Math.round(h)}px`)
  }
  return { boxes: Object.fromEntries(boxes.map(([s, r]) => [s, [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]])), overlaps: o, vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth }
}, sels)

// ================================================================ time-lapse, three replays
R.section = 'lapse'
if (want('lapse')) for (const run of ['dec2015_reservoir', 'michaung2023', 'fengal2024']) {
  const { ctx, page } = await newPage()
  const key = `lapse_${run}`
  try {
    await page.goto(`${base}?replay=${run}`, { waitUntil: 'domcontentloaded' })
    await settle(page)
    const before = norm(await panelText(page)).slice(0, 400)
    const bigBefore = await page.locator('.readout').getAttribute('aria-label')
    const t0 = Date.now()
    await page.getByRole('button', { name: 'Watch the whole storm' }).click()
    const seen = []
    let shot = 0
    while (Date.now() - t0 < 90_000) {
      const s = await page.evaluate(() => ({ clock: document.querySelector('.lapse-clock')?.textContent, share: document.querySelector('.lapse-share .num')?.textContent,
        event: document.querySelector('.lapse-event')?.textContent, h: +(document.querySelector('.timeline input[type=range]')?.value ?? 0),
        now: document.querySelector('.timeline .now')?.textContent, ticks: [...document.querySelectorAll('.timeline .ticks span')].map((x) => x.textContent).join('|'),
        line: [...document.querySelectorAll('.panel.left .small')].map((e) => e.textContent)[0], done: !!document.querySelector('.lapse-actions') && [...document.querySelectorAll('.lapse-actions button')].some((b) => b.textContent === 'Back to my street'),
        readout: !!document.querySelector('.readout'), cam: [+window.__map.getZoom().toFixed(2), Math.round(window.__map.getPitch())] }))
      seen.push({ t: Date.now() - t0, ...s })
      if ([4, 12, 20].includes(Math.round((Date.now() - t0) / 1000)) && shot < 3) { await page.screenshot({ path: `${out}/s_${key}_${shot++}.png` }) }
      if (s.done) break
      await page.waitForTimeout(150)
    }
    R[key] = { playback_s: (Date.now() - t0) / 1000, samples: seen.length, first: seen[0], last: seen[seen.length - 1] }
    await page.screenshot({ path: `${out}/s_${key}_end.png` })
    // compare with the reference
    const ref = lapseRef[run]
    const bad = []
    const hoursSeen = new Set()
    for (const s of seen) {
      if (!s.clock || !s.h) continue
      hoursSeen.add(s.h)
      const exp = ref.per_hour[s.h]
      if (norm(s.clock) !== exp.clock) bad.push(`h${s.h} clock '${norm(s.clock)}' vs '${exp.clock}'`)
      if (s.share !== exp.share) bad.push(`h${s.h} share ${s.share} vs ${exp.share}`)
      const evs = ref.events.filter(([h]) => h <= s.h)
      const lastH = evs.length ? evs[evs.length - 1][0] : null
      if (lastH == null) { if (!/about to begin/.test(s.event)) bad.push(`h${s.h} event '${s.event}' expected 'about to begin'`) }
      else {
        const parts = ref.events.filter(([h]) => h === lastH)
        for (const [, clock, txt] of parts) if (!norm(s.event).includes(txt) || !norm(s.event).startsWith(`${clock}:`)) bad.push(`h${s.h} event '${norm(s.event).slice(0, 90)}' should start '${clock}:' and contain '${txt}'`)
      }
      if (s.readout) bad.push(`h${s.h} answer card still visible during the time-lapse`)
    }
    R[key].hours_seen = [...hoursSeen].sort((a, b) => a - b)
    R[key].missed_hours = Array.from({ length: ref.hours }, (_, i) => i + 1).filter((h) => !hoursSeen.has(h))
    R[key].timeline_during = seen.find((s) => s.h > 3)?.now + ' / ticks ' + seen.find((s) => s.h > 3)?.ticks
    R[key].scenario_line_during = seen.find((s) => s.h > 3)?.line
    R[key].mismatches = [...new Set(bad)].slice(0, 12)
    R[key].mismatch_count = bad.length
    if (bad.length) fail(key, `${bad.length} caption mismatches, e.g. ${bad.slice(0, 2).join(' ; ')}`)
    // end buttons
    R[key].end_buttons = await page.locator('.lapse-actions button').allTextContents()
    if (run.startsWith('dec2015') && !R[key].end_buttons.some((b) => /tested/.test(b))) fail(key, 'no "How we tested this" on 2015')
    await page.click('.lapse-actions button:has-text("Back to my street")')
    await page.waitForTimeout(4500)
    R[key].after_back = { big: await page.locator('.readout').getAttribute('aria-label').catch(() => null), now: await page.locator('.timeline .now').textContent(), cam: await page.evaluate(() => [+window.__map.getZoom().toFixed(2), Math.round(window.__map.getPitch())]) }
    if (R[key].after_back.big !== bigBefore) fail(key, `after Back to my street the card shows ${R[key].after_back.big}, before ${bigBefore}`)
    await page.screenshot({ path: `${out}/s_${key}_back.png` })
    // stop mid-way
    await page.getByRole('button', { name: 'Watch the whole storm' }).click()
    await page.waitForTimeout(5000)
    await page.click('.lapse-actions button:has-text("Stop")').catch(() => fail(key, 'no Stop button while playing'))
    await page.waitForTimeout(800)
    R[key].after_stop = await page.evaluate(() => ({ lapse: !!document.querySelector('.lapse'), buttons: [...document.querySelectorAll('.lapse-actions button')].map((b) => b.textContent), readout: !!document.querySelector('.readout'), h: document.querySelector('.timeline input[type=range]')?.value }))
    // 2015: proof link
    if (run.startsWith('dec2015') && R[key].after_stop.buttons.some((b) => /tested/.test(b))) {
      await page.click('.lapse-actions button:has-text("How we tested this")')
      await page.waitForTimeout(2500)
      R[key].proof_link = { hash: await page.evaluate(() => location.hash), nav: await page.locator('nav button[aria-current=page]').textContent() }
    }
    console.log(key, JSON.stringify({ ...R[key], first: undefined }))
  } catch (e) { fail(key, String(e).slice(0, 200)) }
  await ctx.close()
}

// ================================================================ What if
R.section = 'whatif'
if (want('whatif')) {
  const { ctx, page } = await newPage()
  try {
    await page.goto(`${base}?replay=michaung2023#whatif`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.big-range', { timeout: 120_000 })
    await page.waitForTimeout(4000)
    const read = async () => page.evaluate(() => {
      const st = [...document.querySelectorAll('.panel.left .stat')].map((e) => e.textContent)
      const r = document.querySelector('.big-range')
      return { stats: st, min: r.min, max: r.max, v: r.value, text: document.querySelector('.panel.left').innerText.replace(/\s+/g, ' ').slice(0, 700),
        tide: [...document.querySelectorAll('.panel.left .seg button[aria-pressed=true]')].map((b) => b.textContent).join() }
    })
    const setMm = async (v) => { await page.evaluate((v) => { const el = document.querySelector('.big-range'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })) }, v); await page.waitForTimeout(2500) }
    R.whatif = {}
    for (const tide of ['mean', 'high']) {
      await page.click(`button:has-text("${tide === 'mean' ? 'Mean tide' : 'High tide'}")`)
      for (const mm of [50, 120, 200, 250, 400]) {
        await setMm(mm)
        const r = await read()
        // expected: blended wet share and hospital count of the dominant run
        const T = [50, 100, 150, 200, 300, 400]
        let mix
        if (mm <= 50) mix = [[`design_50_${tide}`, 1]]
        else if (mm >= 400) mix = [[`design_400_${tide}`, 1]]
        else { const i = T.findIndex((t, k) => mm >= t && mm <= T[k + 1]); const w = (mm - T[i]) / (T[i + 1] - T[i]); mix = [[`design_${T[i]}_${tide}`, 1 - w], [`design_${T[i + 1]}_${tide}`, w]].filter(([, w]) => w > 0) }
        const wet = Math.round(100 * mix.reduce((s, [r2, w]) => s + w * runs[r2].wet_share_15cm, 0))
        const dom = [...mix].sort((a, b) => b[1] - a[1])[0][0]
        const cut = hosp.runs[dom]?.cut_off
        const got = { mm_stat: r.stats[0], wet: r.stats[1], hosp: r.stats[2] }
        R.whatif[`${mm}_${tide}`] = { got, expected: { wet: `${wet}%`, hosp: cut != null ? `${cut} of ${hosp.hospitals.length}` : null }, text: r.text.slice(0, 380), range: [r.min, r.max] }
        if (got.wet !== `${wet}%`) fail('whatif', `${mm} ${tide}: wet ${got.wet} vs ${wet}%`)
        if (cut != null && norm(got.hosp) !== `${cut} of ${hosp.hospitals.length}`) fail('whatif', `${mm} ${tide}: hospitals '${got.hosp}' vs ${cut} of ${hosp.hospitals.length}`)
        if ([50, 400].includes(mm) || (mm === 200)) await page.screenshot({ path: `${out}/s_whatif_${mm}_${tide}.png` })
      }
    }
    R.whatif_range = (await read()).min + '..' + (await read()).max
    // fps while dragging the slider with the mouse
    await page.click('button:has-text("Mean tide")')
    await page.evaluate(() => { window.__ft = []; window.__go = true; const tick = (t) => { window.__ft.push(t); if (window.__go) requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
    const bb = await page.locator('.big-range').boundingBox()
    await page.mouse.move(bb.x + 3, bb.y + bb.height / 2); await page.mouse.down()
    for (let k = 0; k <= 60; k++) { await page.mouse.move(bb.x + 3 + (bb.width - 6) * (k <= 30 ? k / 30 : (60 - k) / 30), bb.y + bb.height / 2); await page.waitForTimeout(50) }
    await page.mouse.up()
    R.whatif_drag = await page.evaluate(() => { window.__go = false; const f = window.__ft; const d = []; for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]); return { fps: +(1000 * (f.length - 1) / (f[f.length - 1] - f[0])).toFixed(1), gt50: d.filter((x) => x > 50).length, worst: Math.round(Math.max(...d)) } })
    console.log('whatif', JSON.stringify(R.whatif_drag), R.whatif_range)
  } catch (e) { fail('whatif', String(e).slice(0, 200)) }
  await ctx.close()
}

// ================================================================ Hospitals
R.section = 'hospitals'
if (want('hospitals')) {
  const { ctx, page } = await newPage()
  try {
    await page.goto(`${base}?replay=michaung2023#hospitals`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.hlist li', { timeout: 120_000 })
    await page.waitForTimeout(3000)
    R.hosp = {}
    for (const mm of [50, 100, 150, 200, 300, 400]) {
      await page.click(`.panel.left .seg button:has-text("${mm} mm")`)
      await page.waitForTimeout(1200)
      const head = norm(await page.locator('.panel.left p').first().textContent())
      const n = await page.locator('.hlist li').count(), nc = await page.locator('.hlist li.cut').count()
      const exp = hosp.runs[`design_${mm}_mean`]?.cut_off
      R.hosp[mm] = { head, n, cut_rows: nc, expected_cut: exp }
      if (!head.startsWith(`${exp} of ${hosp.hospitals.length} hospitals cut off at ${mm} mm`)) fail('hospitals', `${mm}: '${head}' vs ${exp} of ${hosp.hospitals.length}`)
      if (nc !== exp) fail('hospitals', `${mm}: ${nc} cut rows vs ${exp}`)
      if (n !== hosp.hospitals.length) fail('hospitals', `${mm}: ${n} rows vs ${hosp.hospitals.length}`)
    }
    await page.click('.panel.left .seg button:has-text("300 mm")'); await page.waitForTimeout(1500)
    await page.screenshot({ path: `${out}/s_hosp_300.png` })
    R.hosp_first = (await page.locator('.hlist li').allTextContents()).slice(0, 4)
    R.hosp_names_lower = (await page.locator('.hlist li span:first-child').allTextContents()).filter((s) => /^[a-z]/.test(s))
    const sorted = await page.evaluate(() => { const c = [...document.querySelectorAll('.hlist li')].map((l) => l.classList.contains('cut')); return c.indexOf(false) < 0 || c.slice(c.indexOf(false)).every((x) => !x) })
    if (!sorted) fail('hospitals', 'cut-off hospitals not listed first')
    // tap a cut-off one and a reachable one
    if (await page.locator('.hlist li.cut').count()) {
      await page.locator('.hlist li.cut').first().click(); await page.waitForTimeout(5000)
      R.hosp_cut_tap = { name: await page.locator('.hlist li[aria-current=true]').textContent(), msg: norm(await page.locator('.panel.left p.small').nth(1).textContent()) }
      await page.screenshot({ path: `${out}/s_hosp_cut_tap.png` })
    }
    await page.locator('.hlist li:not(.cut)').first().click()
    await page.waitForFunction(() => !(document.querySelector('.panel.left')?.innerText ?? '').includes('Finding a dry route'), null, { timeout: 120_000 }).catch(() => {})
    await page.waitForTimeout(2500)
    R.hosp_reach_tap = { name: await page.locator('.hlist li[aria-current=true]').textContent(), msg: norm(await page.locator('.panel.left p.small').nth(1).textContent()),
      route_pts: await page.evaluate(async () => (await window.__map.getSource('route-safe').getData())?.geometry?.coordinates?.length ?? 0) }
    if (!/Dry route from the main road/.test(R.hosp_reach_tap.msg) || !R.hosp_reach_tap.route_pts) fail('hospitals', `reachable tap: ${R.hosp_reach_tap.msg} pts ${R.hosp_reach_tap.route_pts}`)
    await page.screenshot({ path: `${out}/s_hosp_reach_tap.png` })
    // quick switch: tap a cut one then immediately a reachable one (race)
    if (await page.locator('.hlist li.cut').count()) {
      await page.locator('.hlist li:not(.cut)').nth(1).click(); await page.locator('.hlist li.cut').nth(0).click()
      await page.waitForTimeout(5000)
      R.hosp_race = { sel: await page.locator('.hlist li[aria-current=true]').textContent(), msg: norm(await page.locator('.panel.left p.small').nth(1).textContent()), route_pts: await page.evaluate(async () => (await window.__map.getSource('route-safe').getData())?.geometry?.coordinates?.length ?? 0) }
      if (/Dry route/.test(R.hosp_race.msg) || R.hosp_race.route_pts) fail('hospitals', `race: selected cut-off hospital shows '${R.hosp_race.msg}' route pts ${R.hosp_race.route_pts}`)
    }
    // switch storm while a route is shown
    await page.click('.panel.left .seg button:has-text("50 mm")'); await page.waitForTimeout(1500)
    R.hosp_switch_mm = { msg: norm(await panelText(page)).slice(0, 300), route_pts: await page.evaluate(async () => (await window.__map.getSource('route-safe').getData())?.geometry?.coordinates?.length ?? 0) }
    console.log('hosp', JSON.stringify({ hosp: R.hosp, cut: R.hosp_cut_tap, reach: R.hosp_reach_tap, race: R.hosp_race, sw: R.hosp_switch_mm }))
  } catch (e) { fail('hospitals', String(e).slice(0, 200)) }
  await ctx.close()
}

// ================================================================ Proof
R.section = 'proof'
if (want('proof')) {
  const { ctx, page } = await newPage()
  try {
    await page.goto(`${base}?replay=michaung2023#proof`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.strip', { timeout: 120_000 })
    await page.waitForTimeout(5000)
    const center = norm(await page.locator('.proof-center').innerText())
    const strip = (await page.locator('.strip .mk').allTextContents()).map(norm)
    const t = proof.honest_test
    const pct = (x) => `${Math.round(x * 100)}%`
    R.proof = { center: center.slice(0, 600), strip }
    for (const [v, lab] of [[t.model.auc, 'the model'], [0.5, 'chance'], [t.low_elevation.auc, 'elevation alone'], [t.near_a_channel.auc, 'nearest channel']]) {
      if (!strip.some((s) => s === `${pct(v)}${lab}`)) fail('proof', `strip missing ${pct(v)} ${lab}: ${strip}`)
    }
    if (!center.includes(`slightly better than chance (95% range ${pct(t.model.ci95[0])}–${pct(t.model.ci95[1])})`)) fail('proof', `verdict/CI not as proof.json: ${center.slice(0, 200)}`)
    // licence notice on the comparison map (right side) and the main map
    R.proof_attrib = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.maplibregl-ctrl-attrib')]
      return els.map((e) => { const r = e.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const top = document.elementFromPoint(Math.min(innerWidth - 2, r.right - 20), cy); return { text: e.innerText.slice(0, 220), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], expanded: e.classList.contains('maplibregl-compact-show') || !e.classList.contains('maplibregl-compact'), on_top: e.contains(top) } })
    })
    const vis = R.proof_attrib.filter((a) => a.on_top && /Copernicus|COPERNICUS/.test(a.text) && /OpenStreetMap/.test(a.text))
    if (!vis.length) fail('proof', `licence notice not visible on top: ${JSON.stringify(R.proof_attrib)}`)
    await page.screenshot({ path: `${out}/s_proof.png` })
    // drag the handle far right: the comparison map shrinks; is the notice still visible?
    const h = page.locator('.proof-handle'); const bb = await h.boundingBox()
    await page.mouse.move(bb.x + 1, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(1400, bb.y + bb.height / 2, { steps: 8 }); await page.mouse.up()
    await page.waitForTimeout(600)
    R.proof_attrib_right = await page.evaluate(() => [...document.querySelectorAll('.maplibregl-ctrl-attrib')].map((e) => { const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.right - 20, r.top + r.height / 2); return { text: e.innerText.slice(0, 80), on_top: e.contains(top), visible_w: Math.round(r.width) } }))
    await page.screenshot({ path: `${out}/s_proof_handle_right.png` })
    await page.mouse.move(1399, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(60, bb.y + bb.height / 2, { steps: 8 }); await page.mouse.up()
    await page.waitForTimeout(600)
    R.proof_attrib_left = await page.evaluate(() => [...document.querySelectorAll('.maplibregl-ctrl-attrib')].map((e) => { const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.right - 20, r.top + r.height / 2); return { text: e.innerText.slice(0, 80), on_top: e.contains(top) } }))
    await page.screenshot({ path: `${out}/s_proof_handle_left.png` })
    // table vs proof.json
    for (const s of await page.locator('details.tests summary').all()) await s.click()
    await page.waitForTimeout(600)
    const rows = await page.locator('.proof-table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)))
    const keys = ['model', 'model_rain_only', 'near_a_channel', 'low_elevation', 'random']
    R.proof_table = rows
    rows.forEach((row, i) => ['all', 'rain_driven', 'river_driven'].forEach((g, j) => { const v = proof.auc_even_wards?.[keys[i]]?.[g]?.auc; const e = v == null ? '–' : pct(v); if (row[j + 1] !== e) fail('proof', `table ${keys[i]} ${g}: ${row[j + 1]} vs ${e}`) }))
    const bottom = norm(await page.locator('.proof-bottom').innerText())
    R.proof_bottom = bottom.slice(0, 1800)
    const a = proof.anuga
    if (!bottom.includes(`they agree on ${pct(a.csi)} of those cells (critical success index`) || !bottom.includes(`depth correlation ${a.depth_corr.toFixed(2)}`)) fail('proof', 'ANUGA sentence not as proof.json')
    const nr = proof.nrsc_matched_share
    if (nr && !bottom.includes(`the model covers ${pct(nr.model.hit)} of it`)) fail('proof', 'NRSC sentence mismatch')
    R.proof_bottom_box = await page.evaluate(() => { const e = document.querySelector('.proof-bottom'); const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, scrollH: e.scrollHeight, clientH: e.clientHeight, oy: getComputedStyle(e).overflowY } })
    if (R.proof_bottom_box.bottom > R.proof_bottom_box.vh + 1 && R.proof_bottom_box.oy !== 'auto' && R.proof_bottom_box.oy !== 'scroll') fail('proof', `bottom panel runs off screen ${JSON.stringify(R.proof_bottom_box)}`)
    await page.screenshot({ path: `${out}/s_proof_details.png` })
    for (const s of await page.locator('details.tests summary').all()) await s.click()
    for (const [b, k] of [['Detail: ANUGA', 'anuga'], ['Detail: fast model', 'fast'], ['2015 split view', 'split']]) {
      await page.click(`button:has-text("${b}")`); await page.waitForTimeout(3500)
      R[`proof_${k}`] = { label: await page.locator('.proof-label').allTextContents(), detail: await page.evaluate(() => !!window.__map.getLayer('detail')), attrib_on_top: await page.evaluate(() => [...document.querySelectorAll('.maplibregl-ctrl-attrib')].some((e) => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.right - 20, r.top + r.height / 2)) && /COPERNICUS|Copernicus/.test(e.innerText) })) }
      await page.screenshot({ path: `${out}/s_proof_${k}.png` })
    }
    if (!R.proof_anuga.attrib_on_top) fail('proof', 'licence notice not visible in ANUGA detail view')
    // leaving Proof: comparison map removed, detail layer gone
    await page.click('button:has-text("Detail: ANUGA")'); await page.waitForTimeout(2000)
    await page.click('nav button:has-text("Tonight")'); await page.waitForTimeout(6000)
    R.proof_leave = await page.evaluate(() => ({ detail: !!window.__map.getLayer('detail'), maps: document.querySelectorAll('.maplibregl-map').length, readout: document.querySelector('.readout')?.getAttribute('aria-label') }))
    if (R.proof_leave.detail || R.proof_leave.maps !== 1) fail('proof', `after leaving: ${JSON.stringify(R.proof_leave)}`)
    console.log('proof', JSON.stringify({ strip, attrib: R.proof_attrib, right: R.proof_attrib_right, left: R.proof_attrib_left, leave: R.proof_leave }))
  } catch (e) { fail('proof', String(e).slice(0, 200)) }
  await ctx.close()
}

// ================================================================ About + dry default + edge cases + assistant + subscribe + screen switching
R.section = 'misc'
if (want('misc')) {
  const { ctx, page } = await newPage()
  try {
    // dry default
    const t0 = Date.now()
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    R.dry_title = await page.locator('.intro-title').textContent().catch(() => null)
    await page.waitForSelector('.panel.left', { timeout: 120_000 }); await page.waitForTimeout(2500)
    R.dry = { ms: Date.now() - t0, panel: norm(await panelText(page)).slice(0, 400), timeline: await page.locator('.timeline').count(), legend: await page.locator('.legend').count() }
    await page.screenshot({ path: `${out}/s_dry_default.png` })
    // search on a dry night
    R.dry_search_pick = await pick(page, 'Arumugam Road'); await page.waitForTimeout(5000)
    R.dry_search = { panel: norm(await panelText(page)).slice(0, 400), readout: await page.locator('.readout').count(), street_line: await page.evaluate(async () => (await window.__map.getSource('street').getData())?.geometry?.coordinates?.length ?? 0) }
    await page.screenshot({ path: `${out}/s_dry_search.png` })
    await page.click('button:has-text("See Cyclone Michaung as if it were tonight")'); await settle(page)
    R.dry_to_replay = { big: await page.locator('.readout').getAttribute('aria-label').catch(() => null), street: await page.locator('.street').textContent().catch(() => null) }
    // back to Tonight (dry) after a replay: no crash
    await page.click('.seg.tight button:has-text("Tonight")'); await page.waitForTimeout(2000)
    R.back_to_tonight = norm(await panelText(page)).slice(0, 200)
    // edge-case searches
    R.search = []
    for (const q of ['xqzvplk', 'Madurai', 'Bangalore', 'Mumbai', 'ab', '12.98, 80.22', 'Velachery 600042', 'Edayanchavadi', 'Ennore', 'Poonamallee', 'Sholinganallur']) {
      await page.fill('.search input', ''); await page.fill('.search input', q); await page.waitForTimeout(1500)
      R.search.push({ q, sug: (await page.locator('.suggest li').allTextContents()).slice(0, 3), source: await page.locator('.search .source').textContent().catch(() => null) })
    }
    await page.fill('.search input', 'xqzvplk'); await page.waitForTimeout(800); await page.press('.search input', 'Enter'); await page.waitForTimeout(500)
    await page.screenshot({ path: `${out}/s_search_gibberish.png` })
    // replay on, then places at the domain edge
    await page.click('.seg.tight button:has-text("Michaung 2023")'); await page.waitForTimeout(1500)
    R.edge = {}
    for (const q of ['Edayanchavadi', 'Ennore', 'Poonamallee', 'Sholinganallur', 'Bangalore']) {
      const p = await pick(page, q).catch(() => null)
      await page.waitForSelector('.readout, .panel.left [role=alert]', { timeout: 60_000 }).catch(() => {})
      await page.waitForTimeout(4500)
      R.edge[q] = { picked: p, street: await page.locator('.street').textContent().catch(() => null), big: await page.locator('.readout').getAttribute('aria-label').catch(() => null), alert: await page.locator('.panel.left [role=alert]').textContent().catch(() => null), when: norm(await page.locator('.when').textContent().catch(() => null)), parking: await page.locator('.park').allTextContents() }
      await page.screenshot({ path: `${out}/s_edge_${q}.png` })
    }
    // assistant offline
    await page.click('.panel.right.collapsed'); await page.waitForSelector('.assistant')
    await page.click('.assistant .seg button >> nth=0'); await page.waitForTimeout(1000)
    await page.fill('.assistant input', 'Someone is trapped and water is rising inside my house'); await page.press('.assistant input', 'Enter'); await page.waitForTimeout(1000)
    R.assistant = { msgs: await page.locator('.assistant .msg').allTextContents(), intro: await page.locator('.assistant p.muted').textContent(), red112: await page.evaluate(() => [...document.querySelectorAll('.assistant .emergency')].map((e) => getComputedStyle(e).color)) }
    await page.screenshot({ path: `${out}/s_assistant_offline.png` })
    await page.click('.assistant button:has-text("Close")')
    // subscribe offline (on Arumugam Road)
    await pick(page, 'Arumugam Road'); await settle(page)
    await page.click('button:has-text("Email me if this changes")')
    await page.fill('#email', 'not-an-email'); await page.click('form button:has-text("Subscribe")'); await page.waitForTimeout(400)
    R.sub_invalid = await page.$eval('#email', (e) => e.validationMessage)
    await page.fill('#email', 'qa@example.com'); await page.click('form button:has-text("Subscribe")')
    await page.waitForSelector('form [role=status]', { timeout: 10_000 })
    R.sub_offline = await page.locator('form [role=status]').textContent()
    R.sub_box = await overlaps(page, ['.panel.left form', '.sticky-foot', '.timeline'])
    await page.screenshot({ path: `${out}/s_subscribe_offline.png` })
    // switch screens and back: does the night replay again? any double flight?
    const camLog = []
    await page.evaluate(() => { window.__moves = 0; window.__map.on('movestart', () => window.__moves++) })
    await page.click('nav button:has-text("What if")'); await page.waitForTimeout(3000)
    await page.click('nav button:has-text("Tonight")')
    const tb = Date.now()
    for (let k = 0; k < 40; k++) { camLog.push(await page.evaluate(() => ({ z: +window.__map.getZoom().toFixed(2), h: document.querySelector('.timeline input[type=range]')?.value ?? null, n: document.querySelector('.readout span')?.textContent ?? null }))); await page.waitForTimeout(150) }
    R.switch_back = { moves_since: await page.evaluate(() => window.__moves), samples: camLog.filter((_, i) => i % 4 === 0), ms: Date.now() - tb, subscribe_form_kept: await page.locator('#email').count() }
    // About
    await page.click('nav button:has-text("About")'); await page.waitForSelector('.panel.about'); await page.waitForTimeout(1200)
    const about = await page.locator('.panel.about').innerText()
    R.about = { len: about.length, has: ['30 m', 'Copernicus', 'OpenStreetMap', 'Open-Meteo', 'OpenCity', 'not an official warning', 'CFLOWS', '10 mm per hour', 'reservoir', 'ANUGA', '112'].map((k) => `${k}:${about.toLowerCase().includes(k.toLowerCase())}`),
      box: await page.evaluate(() => { const e = document.querySelector('.panel.about'); const r = e.getBoundingClientRect(); return { bottom: Math.round(r.bottom), vh: innerHeight, scrollH: e.scrollHeight, clientH: e.clientHeight, oy: getComputedStyle(e).overflowY } }),
      red: await page.evaluate(() => [...document.querySelectorAll('.panel.about .emergency')].map((e) => getComputedStyle(e).color)) }
    await page.screenshot({ path: `${out}/s_about.png` })
    // red only on 112 (any screen)
    R.red_scan = await page.evaluate(() => { const hits = []; for (const el of document.querySelectorAll('body *')) { if (!(el.offsetWidth || el.offsetHeight)) continue; const cs = getComputedStyle(el); for (const p of ['color', 'backgroundColor', 'borderTopColor']) { const m = cs[p].match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/); if (!m || (m[4] !== undefined && +m[4] < 0.2)) continue; if (+m[1] > 180 && +m[2] < 110 && +m[3] < 110) hits.push(`${el.className}:${p}:${el.textContent.trim().slice(0, 20)}`) } } return hits })
    // admin
    await page.goto(`${base}?replay=michaung2023#admin`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.panel.left h2', { timeout: 120_000 })
    await page.click('button:has-text("Run now")'); await page.waitForTimeout(800)
    R.admin = norm(await panelText(page)).slice(0, 400)
    console.log('misc', JSON.stringify({ dry: R.dry, dry_search: R.dry_search, edge: R.edge, assistant: R.assistant, sub: R.sub_offline, switch_back: R.switch_back, about: R.about, red: R.red_scan }))
  } catch (e) { fail('misc', String(e).slice(0, 300)) }
  await ctx.close()
}

// ================================================================ reduced motion
R.section = 'reduced'
if (want('reduced')) {
  const { ctx, page } = await newPage({ reducedMotion: 'reduce' })
  try {
    const t0 = Date.now()
    await page.goto(`${base}?replay=michaung2023`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.readout', { timeout: 120_000 })
    R.rm = { card_ms: Date.now() - t0, first: await page.evaluate(() => ({ label: document.querySelector('.readout').getAttribute('aria-label'), shown: document.querySelector('.readout span').textContent, h: document.querySelector('.timeline input[type=range]')?.value, title: !!document.querySelector('.intro-title'), rain: window.__mv?.water?.rain?.level ?? null })) }
    await page.waitForTimeout(3000)
    R.rm.after3s = await page.evaluate(() => ({ shown: document.querySelector('.readout span').textContent, h: document.querySelector('.timeline input[type=range]')?.value, rainTarget: window.__mv?.water?.rain?.target ?? null, rainLevel: window.__mv?.water?.rain?.level ?? null, cam: [+window.__map.getZoom().toFixed(2), Math.round(window.__map.getPitch())] }))
    await page.screenshot({ path: `${out}/s_reduced_motion.png` })
    // search: no flight, instant
    await pick(page, 'Arumugam Road'); const ts = Date.now()
    await page.waitForFunction(() => document.querySelector('.street')?.textContent === 'Arumugam Road', null, { timeout: 30_000 })
    R.rm.search = { ms: Date.now() - ts, shown_immediately: await page.evaluate(() => document.querySelector('.readout span').textContent), cam: await page.evaluate(() => [window.__map.getCenter().toArray().map((x) => +x.toFixed(4)), window.__map.isMoving()]) }
    // time-lapse under reduced motion
    const tl = Date.now()
    await page.getByRole('button', { name: 'Watch the whole storm' }).click()
    await page.waitForSelector('text=Back to my street', { timeout: 60_000 }).catch(() => {})
    R.rm.lapse_s = (Date.now() - tl) / 1000
    R.rm.lapse_end = await page.evaluate(() => ({ clock: document.querySelector('.lapse-clock')?.textContent, ev: document.querySelector('.lapse-event')?.textContent }))
    await page.screenshot({ path: `${out}/s_reduced_motion_lapse.png` })
    console.log('reduced', JSON.stringify(R.rm))
  } catch (e) { fail('reduced', String(e).slice(0, 200)) }
  await ctx.close()
}

// ================================================================ mobile 390x844
R.section = 'mobile'
if (want('mobile')) {
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  try {
    await page.goto(`${base}?replay=michaung2023`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.readout', { timeout: 150_000 }); await settle(page)
    await page.screenshot({ path: `${out}/s_mobile_card.png` })
    R.mobile = { card: await overlaps(page, ['.topbar', '.nav', '.panel.left', '.timeline', '.legend', '.panel.right', '.readout', '.glyph', '.decision', '.maplibregl-ctrl-attrib']),
      pixel_ratio: await page.evaluate(() => [devicePixelRatio, window.__map.getPixelRatio()]),
      street_on_screen: await page.evaluate(() => { const p = window.__map.project(window.__mv.map.getSource('here')._data?.geometry?.coordinates ?? window.__map.getCenter()); return [Math.round(p.x), Math.round(p.y)] }),
      panel_scroll: await page.evaluate(() => { const e = document.querySelector('.panel.left'); return { scrollH: e.scrollHeight, clientH: e.clientHeight, oy: getComputedStyle(e).overflowY } }),
      font_sizes: await page.evaluate(() => ['.small', '.nav button', '.timeline .ticks span', '.legend'].map((s) => `${s}:${getComputedStyle(document.querySelector(s) ?? document.body).fontSize}`)),
      tap_targets: await page.evaluate(() => [...document.querySelectorAll('button, input, .suggest li')].filter((e) => e.offsetWidth).map((e) => { const r = e.getBoundingClientRect(); return [e.textContent.trim().slice(0, 20) || e.getAttribute('aria-label') || e.type, Math.round(r.width), Math.round(r.height)] }).filter(([, w, h]) => h < 32 || w < 32)) }
    // search + scroll the card
    await page.locator('.search input').tap(); await page.fill('.search input', 'Arumugam Road'); await page.waitForSelector('.suggest li')
    await page.locator('.suggest li').first().dispatchEvent('mousedown'); await settle(page)
    await page.screenshot({ path: `${out}/s_mobile_search.png` })
    await page.evaluate(() => document.querySelector('.panel.left').scrollTo(0, 9999)); await page.waitForTimeout(500)
    await page.screenshot({ path: `${out}/s_mobile_card_scrolled.png` })
    R.mobile.after_search = await overlaps(page, ['.panel.left', '.timeline', '.legend', '.panel.right'])
    // other screens
    for (const s of ['What if', 'Proof', 'Hospitals', 'About']) {
      await page.locator(`nav button:has-text("${s}")`).tap(); await page.waitForTimeout(4000)
      R.mobile[s] = await overlaps(page, ['.topbar', '.panel.left', '.panel.about', '.proof-center', '.proof-bottom', '.legend', '.panel.right', '.timeline'])
      await page.screenshot({ path: `${out}/s_mobile_${s.replace(' ', '_')}.png` })
    }
    console.log('mobile', JSON.stringify(R.mobile).slice(0, 3000))
  } catch (e) { fail('mobile', String(e).slice(0, 200)) }
  await ctx.close()
}

fs.writeFileSync(`${out}/qa4_screens${ONLY ? '_' + ONLY.join('_') : ''}.json`, JSON.stringify(R, null, 1))
console.log(JSON.stringify({ fails: R.fails, errors: R.page_errors, console: R.console.slice(0, 20), failed: R.failed_requests.slice(0, 20), http: R.http_errors.slice(0, 20) }, null, 1))
await browser.close()
