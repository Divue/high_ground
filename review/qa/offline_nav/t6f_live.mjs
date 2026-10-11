// 6. Live directions: Start with emulated GPS, off-route replan, timeline drag while live, arrival,
// End/Close clean-up, Preview the drive, switching storm or street while navigating, location denied.
import { launch, open, OUT, sleep, waitCard, search, panelText, save } from './lib.mjs'
const base = process.argv[2] ?? 'http://127.0.0.1:4173/'
const tag = process.argv[3] ?? 'prod'
const b = await launch()
const { ctx, page, log } = await open(b, { permissions: ['geolocation'], geolocation: { longitude: 80.21725, latitude: 12.99482, accuracy: 10 } })
const res = {}
const live = () => page.$eval('.nav-live', (el) => el.innerText.replace(/\n+/g, ' | ')).catch(() => '(no banner)')
const src = (id) => page.evaluate((id) => { const d = window.__map.getSource(id)?.serialize?.().data; return d?.geometry?.coordinates ?? d?.features?.length ?? null }, id)
const goPanel = async () => {
  await page.getByRole('button', { name: 'Take me to dry ground' }).click()
  await page.waitForSelector('.go-result:not(.stale), .go [role=alert]', { timeout: 60000 })
  await sleep(1200)
}
await page.goto(base + '?replay=michaung2023&motion=off')
await waitCard(page, 120000)
await search(page, 'Velachery Main Road'); await sleep(5000); await waitCard(page)
res.cardDecision = await page.$eval('.decision', (e) => e.innerText).catch(() => '-')
res.cardRouteBefore = Array.isArray(await src('route-safe')) ? (await src('route-safe')).length : await src('route-safe')
await goPanel()
await page.getByRole('button', { name: 'High ground', exact: true }).click(); await sleep(400)
await page.waitForSelector('.go-result:not(.stale)', { timeout: 60000 }); await sleep(1000)
const coords = await src('route-safe')
res.routeVerts = coords.length
const stepsList = await page.$$eval('.go .steps li', (ls) => ls.map((l) => l.innerText.replace(/\n/g, ' ')))
res.steps = stepsList
// Start
await page.getByRole('button', { name: 'Start', exact: true }).click()
await sleep(2000)
res.liveAtStart = await live()
const n = coords.length
res.gps = []
for (const f of [0.1, 0.4, 0.7, 0.98]) {
  const [lon, lat] = coords[Math.floor(f * (n - 1))]
  await ctx.setGeolocation({ longitude: lon, latitude: lat, accuracy: 8 }); await sleep(1800)
  res.gps.push(`${Math.round(f * 100)}%: ${await live()}`)
}
await page.screenshot({ path: `${OUT}/t6f_${tag}_01_gps_near_end.png` })
res.meDot = await src('me')
// off the route (300 m away), 4 fixes
const [lon0, lat0] = coords[Math.floor(0.4 * (n - 1))]
await ctx.setGeolocation({ longitude: lon0, latitude: lat0, accuracy: 8 }); await sleep(1500)
for (let k = 0; k < 4; k++) { await ctx.setGeolocation({ longitude: lon0 + 0.003, latitude: lat0 + 0.002 + k * 1e-5, accuracy: 8 }); await sleep(1300) }
await sleep(3000)
const coords2 = await src('route-safe')
res.reroute = { banner: await live(), replanned: JSON.stringify(coords2?.[0]) !== JSON.stringify(coords[0]), newStart: coords2?.[0], panel: (await panelText(page, '.go')).split('\n').filter(Boolean).slice(6, 9).join(' | ') }
await page.screenshot({ path: `${OUT}/t6f_${tag}_02_reroute.png` })
// drag the timeline while navigating
const tl = page.getByRole('slider', { name: 'Hour of the storm' })
res.timelineVisibleWhileLive = await tl.isVisible().catch(() => false)
if (res.timelineVisibleWhileLive) {
  await tl.fill('5'); await sleep(2500)
  res.liveAfterHour5 = await live()
  await tl.fill('48'); await sleep(2500)
  res.liveAfterHour48 = await live()
  res.panelAfterHour48 = (await panelText(page, '.go')).split('\n').filter(Boolean).slice(5, 9).join(' | ')
  await page.screenshot({ path: `${OUT}/t6f_${tag}_03_live_hour48.png` })
}
// End
const endBtn = page.getByRole('button', { name: 'End', exact: true })
if (await endBtn.count()) { await endBtn.click(); await sleep(800) }
res.afterEnd = { banner: await live(), me: await src('me'), route: Array.isArray(await src('route-safe')) ? 'drawn' : await src('route-safe'), htmlClass: await page.evaluate(() => document.documentElement.className) }
// Close the panel: is the card's own route back?
await page.getByRole('button', { name: 'Close' }).first().click(); await sleep(800)
res.afterClose = { route: Array.isArray(await src('route-safe')) ? 'drawn' : await src('route-safe'), dest: await src('nav-dest'), cardDecision: await page.$eval('.decision', (e) => e.innerText).catch(() => '-') }
await page.screenshot({ path: `${OUT}/t6f_${tag}_04_after_close.png` })
// Preview the drive to the end (high ground, short)
await tl.fill('20').catch(() => {}); await sleep(500)
await goPanel()
await page.getByRole('button', { name: 'High ground', exact: true }).click(); await sleep(400)
await page.waitForSelector('.go-result:not(.stale)', { timeout: 60000 }); await sleep(800)
await page.getByRole('button', { name: 'Preview the drive' }).click()
res.preview = []
for (let k = 0; k < 8; k++) { await sleep(4000); res.preview.push(await live()); if (/Arrived/.test(res.preview.at(-1))) break }
await page.screenshot({ path: `${OUT}/t6f_${tag}_05_preview_end.png` })
// switch storm while previewing/navigating
await page.getByRole('button', { name: 'Start', exact: true }).click().catch(() => {})
await page.getByRole('button', { name: 'End', exact: true }).click().catch(() => {})
await page.getByRole('button', { name: 'Start', exact: true }).click().catch(() => {})
await sleep(1500)
res.beforeStormSwitch = await live()
await page.getByRole('group', { name: 'Replay a storm' }).getByRole('button', { name: '2015' }).click().catch((e) => { res.stormSwitchClickErr = String(e).slice(0, 200) })
await sleep(5000)
res.afterStormSwitch = { banner: await live(), me: await src('me'), route: Array.isArray(await src('route-safe')) ? 'drawn' : await src('route-safe'), go: !!(await page.$('.go')), htmlClass: await page.evaluate(() => document.documentElement.className) }
await page.screenshot({ path: `${OUT}/t6f_${tag}_06_storm_switch_live.png` })
// switch street while navigating
if (await page.$('.go')) {} else { await goPanel().catch(() => {}) }
await page.getByRole('button', { name: 'Start', exact: true }).click().catch(() => {})
await sleep(1500)
res.beforeStreetSwitch = await live()
await search(page, 'Kakkan Nagar Main Road').catch((e) => { res.streetSwitchErr = String(e).slice(0, 200) })
await sleep(6000)
res.afterStreetSwitch = { banner: await live(), me: await src('me'), route: Array.isArray(await src('route-safe')) ? 'drawn' : await src('route-safe'), go: !!(await page.$('.go')), htmlClass: await page.evaluate(() => document.documentElement.className) }
await page.screenshot({ path: `${OUT}/t6f_${tag}_07_street_switch_live.png` })
res.log = { pageErrors: log.pageErrors, console: [...new Set(log.consoleErrors.filter((x) => !/glyph/.test(x)))].slice(0, 10) }
// location denied
const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p2 = await ctx2.newPage()
await p2.goto(base + '?replay=michaung2023&motion=off'); await p2.waitForSelector('.readout', { timeout: 120000 })
await p2.getByRole('button', { name: 'Take me to dry ground' }).click()
await p2.waitForSelector('.go-result:not(.stale)', { timeout: 60000 }); await sleep(800)
await p2.getByRole('button', { name: 'Start', exact: true }).click(); await sleep(4000)
res.denied = await p2.$eval('.nav-live', (el) => el.innerText.replace(/\n+/g, ' | ')).catch(() => '(no banner)')
await p2.screenshot({ path: `${OUT}/t6f_${tag}_08_location_denied.png` })
save(`t6f_${tag}_result.json`, res)
console.log(JSON.stringify(res, null, 1))
await b.close()
