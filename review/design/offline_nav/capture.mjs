// Design review captures for the offline + navigation UI (read-only; DOM is only measured,
// except for one throwaway "unroll the card" screenshot that lifts max-height in the page).
import { chromium, devices } from '/home/tekiru/Desktop/highground/web/node_modules/@playwright/test/index.mjs'
const base = process.argv[2] ?? 'http://127.0.0.1:4173/'
const out = '/home/tekiru/Desktop/highground/review/design/offline_nav'
const b = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'] })
const report = {}

// ---------- desktop 1440x900 ----------
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(base + '?replay=michaung2023&motion=off')
  await p.waitForSelector('.readout', { timeout: 90000 })
  await p.waitForTimeout(2500)
  await p.screenshot({ path: `${out}/d01_card_top_1440.png` })
  report.desktopCard = await p.evaluate(() => {
    const el = document.querySelector('.panel.left')
    const r = el.getBoundingClientRect()
    const pos = (txt) => { const n = [...el.querySelectorAll('button, a, p, div')].find((x) => x.textContent.trim().startsWith(txt)); return n ? Math.round(n.getBoundingClientRect().top - r.top + el.scrollTop) : null }
    return { clientH: el.clientHeight, scrollH: el.scrollHeight, top: Math.round(r.top), bottom: Math.round(r.bottom),
      take: pos('Take me to dry ground'), plan: pos('My flood plan'), email: pos('Email me if this changes'), save: pos('Save for offline'),
      buttons: [...el.querySelectorAll('button')].map((x) => x.textContent.trim()).filter(Boolean) }
  })
  // unrolled card, to show its real length
  await p.setViewportSize({ width: 1440, height: 2000 })
  await p.evaluate(() => { const el = document.querySelector('.panel.left'); el.style.maxHeight = 'none'; el.style.overflow = 'visible'; el.style.bottom = 'auto' })
  await p.waitForTimeout(600)
  await p.locator('.panel.left').screenshot({ path: `${out}/d02_card_unrolled.png` })
  await p.reload(); await p.setViewportSize({ width: 1440, height: 900 })
  await p.waitForSelector('.readout', { timeout: 90000 }); await p.waitForTimeout(1500)
  await p.getByRole('button', { name: 'Take me to dry ground' }).click()
  await p.waitForSelector('.go-result:not(.stale)', { timeout: 60000 })
  await p.waitForTimeout(1500)
  await p.screenshot({ path: `${out}/d03_go_1440.png` })
  report.desktopGo = await p.evaluate(() => {
    const el = document.querySelector('.panel.left'); const r = el.getBoundingClientRect()
    const hon = [...el.querySelectorAll('p')].find((x) => x.textContent.includes('not a sighting'))
    const readout = document.querySelector('.readout').getBoundingClientRect()
    return { scrollTop: el.scrollTop, honestyTopInViewport: hon ? Math.round(hon.getBoundingClientRect().top) : null, viewportH: innerHeight,
      readoutVisible: readout.bottom > r.top && readout.top < r.bottom, readoutTop: Math.round(readout.top) }
  })
  await p.evaluate(() => { const el = document.querySelector('.panel.left'); el.scrollTop = el.scrollHeight })
  await p.waitForTimeout(400)
  await p.screenshot({ path: `${out}/d04_go_bottom_1440.png` })
  await p.getByRole('button', { name: 'Preview the drive' }).click()
  await p.waitForTimeout(3000)
  await p.screenshot({ path: `${out}/d05_live_preview_1440.png` })
  report.liveBanner = await p.evaluate(() => {
    const cs = (s) => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return { fs: c.fontSize, fw: c.fontWeight, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) } }
    return { box: cs('.nav-live'), dist: cs('.nav-dist'), text: cs('.nav-text'), honest: cs('.nav-honest'), meta: cs('.nav-meta'), hasArrow: !!document.querySelector('.nav-live svg') }
  })
  // plan image at native size + a WhatsApp chat-bubble sized copy
  await p.getByRole('button', { name: 'End' }).click()
  await p.evaluate(() => { const el = document.querySelector('.panel.left'); el.scrollTop = 0 })
  await p.getByRole('button', { name: 'My flood plan' }).click()
  await p.waitForSelector('.plan-img', { timeout: 20000 })
  await p.waitForTimeout(800)
  const dataUrl = await p.$eval('.plan-img', async (i) => { const bl = await (await fetch(i.src)).blob(); return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(bl) }) })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(`${out}/c01_plan_native.png`, Buffer.from(dataUrl.split(',')[1], 'base64'))
  const thumb = await p.$eval('.plan-img', (i) => { const c = document.createElement('canvas'); const w = 300; c.width = w; c.height = Math.round(w * i.naturalHeight / i.naturalWidth); c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.7) })
  writeFileSync(`${out}/c02_plan_whatsapp_300px.jpg`, Buffer.from(thumb.split(',')[1], 'base64'))
  report.planText = await p.evaluate(() => document.querySelector('.plan-img')?.alt ?? null)
  await ctx.close()
}

// ---------- phone 390x844 ----------
{
  const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } })
  const p = await ctx.newPage()
  await p.goto(base + '?replay=michaung2023&motion=off')
  await p.waitForSelector('.readout', { timeout: 90000 })
  await p.waitForTimeout(2000)
  report.phoneCard = await p.evaluate(() => {
    const el = document.querySelector('.panel.left'); const r = el.getBoundingClientRect()
    const find = (t) => [...el.querySelectorAll('button')].find((x) => x.textContent.trim() === t)
    const at = (t) => { const n = find(t); return n ? Math.round(n.getBoundingClientRect().top - r.top + el.scrollTop) : null }
    return { panelTop: Math.round(r.top), panelH: Math.round(r.height), scrollH: el.scrollHeight, take: at('Take me to dry ground'), plan: at('My flood plan'), email: at('Email me if this changes'), save: at('Save for offline') }
  })
  // scroll the card so the action block is visible
  await p.evaluate(() => { const el = document.querySelector('.panel.left'); const t = [...el.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Take me to dry ground'); t.scrollIntoView({ block: 'start' }) })
  await p.waitForTimeout(500)
  await p.screenshot({ path: `${out}/m01_card_actions_390.png` })
  await p.evaluate(() => { const el = document.querySelector('.panel.left'); el.scrollTop = el.scrollHeight })
  await p.waitForTimeout(400)
  await p.screenshot({ path: `${out}/m02_card_bottom_390.png` })
  await p.getByRole('button', { name: 'Battery saver' }).click()
  await p.waitForTimeout(3500)
  await p.evaluate(() => { const el = document.querySelector('.panel.left'); el.scrollTop = 0 })
  await p.waitForTimeout(400)
  await p.screenshot({ path: `${out}/m03_battery_saver_390.png` })
  await ctx.close()
}
console.log(JSON.stringify(report, null, 1))
await b.close()
