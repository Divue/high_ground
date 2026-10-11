// Pack only (seen cache cleared), offline: once the map is nudged open, does "Take me to dry ground"
// still follow the timeline? (The pack has hourly road depths only for tonight's forecast runs.)
// Also: main-thread long tasks while the pack downloads.
import { launch, open, PROD, OUT, sleep, waitCard, search, panelText, longTasks, save } from './lib.mjs'
const b = await launch()
const { ctx, page, log } = await open(b)
const res = {}
await page.goto(PROD + '?replay=michaung2023&motion=off')
await page.evaluate(async () => { await navigator.serviceWorker.ready })
await page.reload()
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
await waitCard(page)
await search(page, 'Velachery Main Road'); await sleep(5000); await waitCard(page)
await sleep(3000)
const since = await page.evaluate(() => performance.now())
const t0 = Date.now()
await page.getByRole('button', { name: 'Save for offline' }).click()
await page.waitForSelector('text=Saved for offline', { timeout: 240000 })
res.saveMs = Date.now() - t0
res.saveLongTasks = (await longTasks(page, since)).map((x) => x.d)
res.forecastRunsInPack = JSON.parse(await page.evaluate(() => localStorage.getItem('hg-pack-record'))).forecastRuns
await page.evaluate(async () => { await caches.delete('hg-seen') })
await ctx.setOffline(true)
await page.reload()
await sleep(8000)
res.openedWithoutTouch = !!(await page.$('.panel'))
await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(760, 480, { steps: 5 }); await page.mouse.up()
await waitCard(page, 60000)
await search(page, 'Velachery Main Road'); await sleep(5000); await waitCard(page)
await page.getByRole('button', { name: 'Take me to dry ground' }).click()
await page.waitForSelector('.go-result:not(.stale), .go [role=alert]', { timeout: 60000 }).catch(() => {})
const tl = page.getByRole('slider', { name: 'Hour of the storm' })
res.perHour = []
for (const h of [2, 10, 20, 30, 40, 50]) {
  await tl.fill(String(h)); await sleep(2500)
  const t = (await panelText(page, '.go')).split('\n').filter(Boolean); const i = t.findIndex((l) => /^Leaving/.test(l))
  res.perHour.push(`${h}: ${t.slice(i + 1, i + 3).join(' / ')}`)
}
await page.screenshot({ path: `${OUT}/t2c_packonly_go_hour50.png` })
res.pageErrors = log.pageErrors
save('t2c_result.json', res)
console.log(JSON.stringify(res, null, 1))
await b.close()
