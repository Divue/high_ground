// 8b. Phone: My flood plan sheet from the answer card (and Help sheet tap targets).
import { launch, open, OUT, sleep, waitCard, save } from './lib.mjs'
const base = process.argv[2] ?? 'http://127.0.0.1:5173/'
const tag = process.argv[3] ?? 'dev'
const b = await launch()
const { page, log } = await open(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await page.goto(base + '?replay=michaung2023&motion=off')
await waitCard(page, 120000); await sleep(2000)
const res = {}
for (const [name, file] of [['My flood plan', 'plan'], ['Help numbers', 'help']]) {
  const btn = page.getByRole('button', { name, exact: true })
  await btn.first().scrollIntoViewIfNeeded(); await btn.first().click(); await sleep(3000)
  await page.screenshot({ path: `${OUT}/t8b_${tag}_${file}.png` })
  res[name] = await page.evaluate(() => {
    const W = innerWidth, H = innerHeight
    const sheet = document.querySelector('.sheet')
    const r = sheet?.getBoundingClientRect()
    const card = sheet?.querySelector('.sheet-card')
    const small = [...(sheet?.querySelectorAll('button, a') ?? [])].filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && (q.height < 44 || q.width < 44) })
      .map((e) => `${(e.innerText || e.getAttribute('aria-label') || '').replace(/\n/g, ' ').slice(0, 26)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`)
    const offscreen = [...(sheet?.querySelectorAll('button, a, img') ?? [])].filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && (q.bottom > H || q.right > W) }).map((e) => (e.innerText || e.tagName).slice(0, 26))
    return { sheet: r && { top: Math.round(r.top), bottom: Math.round(r.bottom) }, cardScroll: card && { scrollH: card.scrollHeight, clientH: card.clientHeight }, overflowX: document.documentElement.scrollWidth - W, small, offscreenNeedScroll: offscreen }
  })
  await page.keyboard.press('Escape'); await sleep(600)
  res[name].closedByEsc = !(await page.$('.sheet'))
  if (!res[name].closedByEsc) await page.getByRole('button', { name: 'Close' }).first().click().catch(() => {})
  await sleep(500)
}
res.pageErrors = log.pageErrors
save(`t8b_${tag}_result.json`, res)
console.log(JSON.stringify(res, null, 1))
await b.close()
