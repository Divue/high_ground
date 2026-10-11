// Landing page review: desktop and phone scroll story, links into the app, old links, errors, smoothness.
import { chromium } from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:4174/'
const out = process.argv[3] ?? '/home/tekiru/Desktop/highground/review/landing'
const b = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'] })
const res = {}
async function page(vw, vh, extra = {}) {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, ...extra })
  const p = await ctx.newPage()
  p.errs = []
  p.on('pageerror', (e) => p.errs.push('pageerror: ' + String(e).slice(0, 200)))
  p.on('console', (m) => { if (m.type() === 'error') p.errs.push('console: ' + m.text().slice(0, 200)) })
  return { ctx, p }
}
// 1. desktop story
{
  const { ctx, p } = await page(1440, 900)
  const t0 = Date.now()
  await p.goto(base)
  await p.waitForSelector('.lp-canvas', { timeout: 30000 })
  await p.waitForTimeout(2500)
  res.load_ms = Date.now() - t0
  res.scene = await p.$eval('.lp-foot', (e) => e.innerText.includes('Velachery from the model') ? 'real' : 'illustrative')
  const H = await p.evaluate(() => { const s = document.querySelector('.lp-story'); return { top: s.offsetTop, h: s.offsetHeight, vh: innerHeight, doc: document.body.scrollHeight } })
  res.story = H
  for (const f of [0, 0.18, 0.35, 0.52, 0.7, 0.92]) {
    await p.evaluate(([y]) => window.scrollTo(0, y), [H.top + (H.h - H.vh) * f])
    await p.waitForTimeout(1800)
    await p.screenshot({ path: `${out}/d_story_${Math.round(f * 100)}.png` })
  }
  // smoothness: frames rendered during a 3 s scripted scroll through the story
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(800)
  res.fps = await p.evaluate(async ([top, h, vh]) => {
    let n = 0, worst = 0, last = performance.now()
    let on = true
    const tick = (t) => { n++; worst = Math.max(worst, t - last); last = t; if (on) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    const t0 = performance.now()
    while (performance.now() - t0 < 3000) { window.scrollTo(0, top + (h - vh) * ((performance.now() - t0) / 3000)); await new Promise((r) => setTimeout(r, 16)) }
    on = false
    return { fps: Math.round(n / 3), worst_ms: Math.round(worst) }
  }, [H.top, H.h, H.vh])
  // the rest of the page
  for (const id of ['lp-answers', 'lp-offline', 'lp-proof', 'lp-storms', 'lp-aws', 'lp-limits']) {
    await p.evaluate((i) => document.getElementById(i)?.scrollIntoView(), id); await p.waitForTimeout(600)
    await p.screenshot({ path: `${out}/d_${id}.png` })
  }
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(600)
  await p.screenshot({ path: `${out}/d_end.png` })
  res.desktop_errors = p.errs
  // 2. Open the map
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(400)
  await p.locator('.lp-nav a.lp-btn').click()
  await p.waitForURL('**/app', { timeout: 10000 })
  await p.waitForSelector('.panel.left', { timeout: 90000 })
  await p.waitForTimeout(9000)
  res.app_from_landing = { url: p.url(), card: (await p.$eval('.panel.left', (e) => e.innerText.slice(0, 120))).replace(/\n/g, ' | ') }
  await p.screenshot({ path: `${out}/d_app_from_landing.png` })
  res.app_errors = p.errs.slice(res.desktop_errors.length)
  await ctx.close()
}
// 3. landing search into the app
{
  const { ctx, p } = await page(1440, 900)
  await p.goto(base)
  await p.waitForSelector('#lp-addr', { state: 'attached' })
  await p.evaluate(() => { const s = document.querySelector('.lp-story'); window.scrollTo(0, s.offsetTop + s.offsetHeight - innerHeight) })
  await p.waitForTimeout(1500)
  await p.fill('#lp-addr', 'Velachery Main Road')
  await p.press('#lp-addr', 'Enter')
  await p.waitForURL('**/app?q=*', { timeout: 10000 })
  await p.waitForTimeout(16000)
  res.search_into_app = { url: p.url(), card: (await p.$eval('.panel.left', (e) => e.innerText.slice(0, 200))).replace(/\n/g, ' | ') }
  await p.screenshot({ path: `${out}/d_search_into_app.png` })
  await ctx.close()
}
// 4. old links still open the map
{
  const { ctx, p } = await page(1440, 900)
  await p.goto(base + '?replay=michaung2023&motion=off')
  const ok1 = await p.waitForSelector('.readout', { timeout: 90000 }).then(() => true).catch(() => false)
  await p.goto(base + '#proof')
  const ok2 = await p.waitForSelector('text=Did the model get 2015 right?', { timeout: 60000 }).then(() => true).catch(() => false)
  res.old_links = { replay_card: ok1, proof: ok2 }
  await ctx.close()
}
// 5. phone
{
  const { ctx, p } = await page(390, 844, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await p.goto(base)
  await p.waitForSelector('.lp-canvas', { timeout: 30000 }); await p.waitForTimeout(2500)
  const H = await p.evaluate(() => { const s = document.querySelector('.lp-story'); return { top: s.offsetTop, h: s.offsetHeight, vh: innerHeight } })
  for (const f of [0, 0.35, 0.52, 0.7, 0.92]) {
    await p.evaluate(([y]) => window.scrollTo(0, y), [H.top + (H.h - H.vh) * f]); await p.waitForTimeout(1600)
    await p.screenshot({ path: `${out}/m_story_${Math.round(f * 100)}.png` })
  }
  await p.evaluate(() => document.getElementById('lp-proof')?.scrollIntoView()); await p.waitForTimeout(600)
  await p.screenshot({ path: `${out}/m_proof.png` })
  res.overflow_x = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
  res.phone_errors = p.errs
  await ctx.close()
}
// 6. reduced motion
{
  const { ctx, p } = await page(1440, 900, { reducedMotion: 'reduce' })
  await p.goto(base); await p.waitForTimeout(3000)
  await p.evaluate(() => { const s = document.querySelector('.lp-story'); window.scrollTo(0, s.offsetTop + (s.offsetHeight - innerHeight) * 0.5) }); await p.waitForTimeout(1500)
  await p.screenshot({ path: `${out}/d_reduced_50.png` })
  res.reduced_errors = p.errs
  await ctx.close()
}
console.log(JSON.stringify(res, null, 1))
await b.close()
