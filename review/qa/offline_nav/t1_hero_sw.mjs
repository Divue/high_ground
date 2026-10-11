// 1. Hero flow online with the service worker active (production build).
import { launch, open, PROD, OUT, sleep, waitCard, search, panelText, longTasks, save } from './lib.mjs'
const b = await launch()
const { ctx, page, log } = await open(b)
const res = {}
const t0 = Date.now()
await page.goto(PROD + '?replay=michaung2023&motion=off')
await page.evaluate(async () => { await navigator.serviceWorker.ready })
await page.reload()
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
res.swControlled = true
await waitCard(page)
res.firstCardMs = Date.now() - t0
await sleep(1500)
await page.screenshot({ path: `${OUT}/t1_01_default_card.png` })
const s = await search(page, 'Velachery Main Road')
res.search = s
await sleep(6000)
await waitCard(page)
res.card = (await panelText(page)).slice(0, 1200)
await page.screenshot({ path: `${OUT}/t1_02_velachery_main_road.png` })
// Go panel
await page.getByRole('button', { name: 'Take me to dry ground' }).click()
await page.waitForSelector('.go-result:not(.stale)', { timeout: 60000 }).catch(() => {})
await sleep(1500)
res.go = await panelText(page, '.go')
await page.screenshot({ path: `${OUT}/t1_03_go.png` })
await page.getByRole('button', { name: 'Close' }).first().click()
for (const [name, label] of [['whatif', 'What if'], ['proof', 'Proof'], ['hospitals', 'Hospitals'], ['about', 'About']]) {
  await page.locator('nav.nav').getByRole('button', { name: label }).click()
  await sleep(name === 'proof' ? 5000 : 3500)
  res[name] = (await panelText(page, '.panel')).slice(0, 500)
  await page.screenshot({ path: `${OUT}/t1_04_${name}.png` })
}
await page.locator('nav.nav').getByRole('button', { name: 'Tonight' }).click()
await sleep(3000)
res.backToTonight = (await panelText(page)).slice(0, 300)
await page.screenshot({ path: `${OUT}/t1_05_back_tonight.png` })
res.caches = await page.evaluate(async () => {
  const o = {}; for (const n of await caches.keys()) o[n] = (await (await caches.open(n)).keys()).length; return o
})
res.long = (await longTasks(page)).filter((x) => x.d > 200)
res.log = log
save('t1_result.json', res)
console.log(JSON.stringify(res, null, 1).slice(0, 6000))
await b.close()
