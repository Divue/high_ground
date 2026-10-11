// 9. Main-thread long tasks: first load (worker controlled), a search, a storm switch, the Go panel.
import { launch, open, PROD, sleep, waitCard, search, longTasks, save } from './lib.mjs'
const b = await launch()
const { page, log } = await open(b)
const marks = {}
const mark = async (k) => { marks[k] = Math.round(await page.evaluate(() => performance.now())) }
await page.goto(PROD + '?replay=michaung2023&motion=off')
await page.evaluate(async () => { await navigator.serviceWorker.ready })
await page.reload()
await waitCard(page, 120000); await mark('card')
await sleep(4000); await mark('search'); await search(page, 'Kakkan Nagar Main Road'); await waitCard(page); await sleep(5000); await mark('searchDone')
await page.getByRole('group', { name: 'Replay a storm' }).getByRole('button', { name: '2015' }).click(); await sleep(6000); await mark('stormDone')
await page.getByRole('button', { name: 'Take me to dry ground' }).click(); await sleep(4000); await mark('goDone')
const lt = await longTasks(page)
const bucket = (a, z) => lt.filter((x) => x.t >= a && x.t < z).map((x) => x.d)
const res = { marks, load: bucket(0, marks.card), idleAfterCard: bucket(marks.card, marks.search), search: bucket(marks.search, marks.searchDone), storm: bucket(marks.searchDone, marks.stormDone), go: bucket(marks.stormDone, marks.goDone) }
save('t9_result.json', res)
console.log(JSON.stringify(res))
await b.close()
