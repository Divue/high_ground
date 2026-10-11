// 5. Interrupted save: the network drops mid-download; back online; tap again: resumes and finishes?
import { launch, open, PROD, OUT, sleep, waitCard, search, panelText, save } from './lib.mjs'
const b = await launch()
const { ctx, page, log } = await open(b)
const res = {}
const packCount = () => page.evaluate(async () => { const n = (await caches.keys()).find((k) => k.startsWith('hg-pack-')); return n ? (await (await caches.open(n)).keys()).length : 0 })
// slow the network so there is time to cut it mid-download
const cdp = await ctx.newCDPSession(page)
await page.goto(PROD + '?replay=michaung2023&motion=off')
await page.evaluate(async () => { await navigator.serviceWorker.ready })
await page.reload()
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
await waitCard(page); await sleep(2000)
await page.route('**/data/**', async (route) => { if (route.request().url().includes('hgpack')) await sleep(150); route.continue() })
await page.getByRole('button', { name: 'Save for offline' }).click()
let w = 0
for (let i = 0; i < 200 && w < 35; i++) { await sleep(200); w = parseFloat(await page.$eval('.offline-save .lapse-progress i', (e) => e.style.width).catch(() => '0')) }
res.cutAtPct = w
res.cutAtFiles = await packCount()
await page.screenshot({ path: `${OUT}/t5_01_progress.png` })
await ctx.setOffline(true)
await sleep(9000)
res.offlineText = await page.$eval('.offline-save', (e) => e.innerText).catch(() => '(none)')
res.filesAfterCut = await packCount()
res.recordAfterCut = await page.evaluate(() => localStorage.getItem('hg-pack-record'))
await page.screenshot({ path: `${OUT}/t5_02_cut.png` })
await ctx.setOffline(false)
await sleep(5000)
res.onlineAgainText = await page.$eval('.offline-save', (e) => e.innerText).catch(() => '(none)')
await page.unroute('**/data/**')
const t0 = Date.now()
let firstBytes = null
await page.getByRole('button', { name: 'Save for offline' }).click()
for (let i = 0; i < 20; i++) { await sleep(100); const t = await page.$eval('.offline-save', (e) => e.innerText).catch(() => ''); if (/Saving/.test(t)) { firstBytes = t; break } }
await page.waitForSelector('text=Saved for offline', { timeout: 240000 }).catch(() => { res.resumeFail = true })
res.resumeMs = Date.now() - t0
res.firstProgressLine = firstBytes
res.finalText = await page.$eval('.offline-save', (e) => e.innerText).catch(() => '(none)')
res.record = JSON.parse(await page.evaluate(() => localStorage.getItem('hg-pack-record')) || 'null')
res.filesFinal = await packCount()
await page.screenshot({ path: `${OUT}/t5_03_resumed.png` })
// 'Stop' mid-way on 'Add this street' then tap again
await search(page, 'Arumugam Road'); await sleep(5000); await waitCard(page)
res.addText = await page.$eval('.offline-save', (e) => e.innerText).catch(() => '(none)')
// switching street while a save runs: does the progress survive?
await page.getByRole('button', { name: 'Add this street' }).click()
await sleep(300)
await search(page, 'Kakkan Nagar Main Road'); await sleep(5000); await waitCard(page)
res.afterStreetSwitchDuringSave = await page.$eval('.offline-save', (e) => e.innerText).catch(() => '(none)')
await page.screenshot({ path: `${OUT}/t5_04_switch_during_save.png` })
await sleep(15000)
res.recordAfterSwitch = JSON.parse(await page.evaluate(() => localStorage.getItem('hg-pack-record')) || 'null')?.places
res.textAfterSwitch15s = await page.$eval('.offline-save', (e) => e.innerText).catch(() => '(none)')
res.pageErrors = log.pageErrors
save('t5_result.json', res)
console.log(JSON.stringify(res, null, 1))
await b.close()
