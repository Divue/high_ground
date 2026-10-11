// 8. Phone 390x844: card, Go panel, live banner, Help and Plan sheets. Overflow, small tap targets,
// content hidden behind other layers.
import { launch, open, OUT, sleep, waitCard, search, panelText, save } from './lib.mjs'
const base = process.argv[2] ?? 'http://127.0.0.1:5173/'
const tag = process.argv[3] ?? 'dev'
const b = await launch()
const { ctx, page, log } = await open(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  permissions: ['geolocation'], geolocation: { longitude: 80.21725, latitude: 12.99482, accuracy: 10 } })
const res = {}
const audit = (label) => page.evaluate((label) => {
  const W = innerWidth, H = innerHeight
  const out = { label, docOverflowX: document.documentElement.scrollWidth - W, wide: [], small: [], covered: [] }
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < H }
  for (const el of document.querySelectorAll('.panel *, .nav-live *, .sheet *, .help *, .plan *, [role=dialog] *')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect()
    if (r.right > W + 1 || r.left < -1) out.wide.push(`${el.tagName.toLowerCase()}.${el.className} "${(el.innerText || '').slice(0, 30)}" ${Math.round(r.left)}..${Math.round(r.right)}`)
  }
  for (const el of document.querySelectorAll('button, a, input, [role=button], li[role=option]')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect()
    if (r.height < 24 || r.width < 24) out.small.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || '').slice(0, 28)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    if (cx > 0 && cx < W && cy > 0 && cy < H) {
      const top = document.elementFromPoint(cx, cy)
      if (top && top !== el && !el.contains(top) && !top.contains(el)) out.covered.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || '').slice(0, 24)}" under ${top.tagName.toLowerCase()}.${String(top.className).slice(0, 30)}`)
    }
  }
  out.small = [...new Set(out.small)].slice(0, 25); out.wide = out.wide.slice(0, 15); out.covered = [...new Set(out.covered)].slice(0, 20)
  return out
}, label)
await page.goto(base + '?replay=michaung2023&motion=off')
await waitCard(page, 120000); await sleep(2000)
await page.screenshot({ path: `${OUT}/t8_${tag}_01_card.png` })
res.card = await audit('card')
await search(page, 'Velachery Main Road'); await sleep(5000); await waitCard(page)
await page.screenshot({ path: `${OUT}/t8_${tag}_02_card_vmr.png` })
res.panelScroll = await page.$eval('.panel.left', (e) => ({ scrollH: e.scrollHeight, clientH: e.clientHeight, top: Math.round(e.getBoundingClientRect().top), bottom: Math.round(e.getBoundingClientRect().bottom) })).catch(() => null)
// Go panel (prod: "Take me to dry ground"; dev WIP: "Take me there" / "Other places and ways")
for (const name of ['Take me to dry ground', 'Other places and ways', 'Take me there']) {
  const btn = page.getByRole('button', { name, exact: true })
  if (await btn.count()) { await btn.first().scrollIntoViewIfNeeded(); await btn.first().click(); res.goOpenedWith = name; break }
}
await page.waitForSelector('.go-result:not(.stale), .go [role=alert]', { timeout: 60000 }).catch(() => {})
await sleep(1500)
await page.screenshot({ path: `${OUT}/t8_${tag}_03_go.png` })
res.go = await audit('go')
res.goVisible = await page.$eval('.go-result', (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top < innerHeight && r.bottom > 0 } }).catch(() => null)
// scroll the panel to the Start button and start
const start = page.getByRole('button', { name: 'Start', exact: true })
if (await start.count()) {
  await start.scrollIntoViewIfNeeded(); await start.click(); await sleep(2500)
  await page.screenshot({ path: `${OUT}/t8_${tag}_04_live.png` })
  res.live = await audit('live')
  res.banner = await page.$eval('.nav-live', (e) => { const r = e.getBoundingClientRect(); return { text: e.innerText.replace(/\n+/g, ' | '), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } }).catch(() => null)
  res.panelDuringLive = await page.$eval('.panel.left', (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { top: Math.round(r.top), bottom: Math.round(r.bottom), display: s.display, visibility: s.visibility, transform: s.transform } }).catch(() => null)
  res.timelineDuringLive = await page.$eval('.timeline', (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { top: Math.round(r.top), display: s.display, visibility: s.visibility } }).catch(() => null)
  // a long instruction in the banner
  const end = page.getByRole('button', { name: 'End', exact: true })
  if (await end.count()) { await end.click(); await sleep(800) }
}
// Help and Plan sheets
for (const [name, file] of [['Help numbers', 't8_05_help'], ['My flood plan', 't8_06_plan']]) {
  const btn = page.getByRole('button', { name, exact: true })
  if (!(await btn.count())) { res[name] = 'button not found'; continue }
  await btn.first().scrollIntoViewIfNeeded().catch(() => {}); await btn.first().click(); await sleep(2500)
  await page.screenshot({ path: `${OUT}/${file.replace('t8_', `t8_${tag}_`)}.png` })
  res[name] = await audit(name)
  res[name].sheet = await page.evaluate(() => { const s = document.querySelector('[role=dialog], .sheet, .help-card, .plan-card'); if (!s) return null; const r = s.getBoundingClientRect(); return { cls: s.className, top: Math.round(r.top), bottom: Math.round(r.bottom), scrollH: s.scrollHeight, clientH: s.clientHeight } })
  const close = page.getByRole('button', { name: 'Close' })
  res[name].closeVisible = (await close.count()) ? await close.first().isVisible() : false
  await page.keyboard.press('Escape'); await sleep(500)
  if (await page.$('[role=dialog]')) { if (await close.count()) await close.first().click().catch(() => {}) }
  await sleep(500)
}
res.log = { pageErrors: log.pageErrors, console: [...new Set(log.consoleErrors.filter((x) => !/glyph/.test(x)))].slice(0, 10) }
save(`t8_${tag}_result.json`, res)
console.log(JSON.stringify(res, null, 1))
await b.close()
