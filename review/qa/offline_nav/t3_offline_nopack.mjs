// 3. Offline with NO saved pack: load once online (Michaung replay, default street), don't save,
// go offline, reload. Then: storms, search, Go panel, other screens; back online without reload.
import { launch, open, PROD, OUT, sleep, waitCard, search, panelText, longTasks, save } from './lib.mjs'
const b = await launch()
const { ctx, page, log } = await open(b)
const res = { steps: [] }
const note = (k, v) => { res.steps.push({ k, v }); console.log('##', k, '=>', typeof v === 'string' ? v.slice(0, 500).replace(/\n/g, ' | ') : JSON.stringify(v).slice(0, 500)) }
await page.goto(PROD + '?replay=michaung2023&motion=off')
await page.evaluate(async () => { await navigator.serviceWorker.ready })
await page.reload()
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
await waitCard(page)
await sleep(4000)
note('seen entries online', await page.evaluate(async () => (await (await caches.open('hg-seen')).keys()).length))
await ctx.setOffline(true)
const t0 = Date.now()
await page.reload()
let opened = true
await waitCard(page, 30000).catch(() => { opened = false })
note('offline reload, no pack: card?', { opened, ms: Date.now() - t0 })
await sleep(2000)
note('panel', (await panelText(page)).slice(0, 600))
await page.screenshot({ path: `${OUT}/t3_01_nopack_offline_reload.png` })
if (!opened) {
  // the pack-only case needed a touch on the map: try that here too
  await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(760, 480, { steps: 5 }); await page.mouse.up()
  await waitCard(page, 30000).catch(() => {})
  note('after a drag', (await panelText(page)).slice(0, 300))
}
// Save for offline while offline
note('save block offline', await page.$eval('.offline-save', (e) => e.innerText).catch(() => '(none)'))
// Go panel offline: Michaung (its files were seen online)
await page.getByRole('button', { name: 'Take me to dry ground' }).click().catch((e) => note('go click fail', String(e)))
await page.waitForSelector('.go-result:not(.stale), .go [role=alert]', { timeout: 30000 }).catch(() => {})
await sleep(1500)
note('go michaung offline nopack', (await panelText(page, '.go')).split('\n').slice(5, 13).join(' | '))
await page.screenshot({ path: `${OUT}/t3_02_nopack_go.png` })
await page.getByRole('button', { name: 'Close' }).first().click().catch(() => {})
// storms never looked at online
for (const [label, f] of [['2015', 't3_03_nopack_2015.png'], ['Fengal 2024', 't3_04_nopack_fengal.png']]) {
  await page.getByRole('group', { name: 'Replay a storm' }).getByRole('button', { name: label }).click()
  await sleep(5000)
  note(`nopack storm ${label}`, (await panelText(page)).slice(0, 500))
  await page.screenshot({ path: `${OUT}/${f}` })
}
// Fengal: Go panel, when the Fengal edge depths were never downloaded
const goBtn = page.getByRole('button', { name: 'Take me to dry ground' })
if (await goBtn.count()) {
  await goBtn.click()
  await page.waitForSelector('.go-result:not(.stale), .go [role=alert]', { timeout: 30000 }).catch(() => {})
  await sleep(1500)
  note('go fengal offline nopack', (await panelText(page, '.go')).split('\n').slice(5, 12).join(' | '))
  await page.screenshot({ path: `${OUT}/t3_05_nopack_go_fengal.png` })
  // back online, WITHOUT reload: does planning recover?
  await ctx.setOffline(false)
  await sleep(3000)
  await page.getByRole('button', { name: 'Car', exact: true }).click(); await sleep(4000)
  await page.getByRole('button', { name: 'Two-wheeler', exact: true }).click(); await sleep(5000)
  note('go fengal back online (no reload)', (await panelText(page, '.go')).split('\n').slice(5, 12).join(' | '))
  await page.screenshot({ path: `${OUT}/t3_06_back_online_go_fengal.png` })
  await page.getByRole('button', { name: 'Close' }).first().click().catch(() => {})
  await ctx.setOffline(true)
}
// search another street offline, no pack
await search(page, 'Arumugam Road'); await sleep(5000)
note('nopack search Arumugam Road', (await panelText(page)).slice(0, 400))
await page.screenshot({ path: `${OUT}/t3_07_nopack_search.png` })
// other screens offline, no pack
for (const [name, label] of [['whatif', 'What if'], ['proof', 'Proof'], ['hospitals', 'Hospitals'], ['about', 'About']]) {
  await page.locator('nav.nav').getByRole('button', { name: label }).click()
  await sleep(4000)
  note(`nopack ${name}`, (await panelText(page, '.panel')).slice(0, 300))
  await page.screenshot({ path: `${OUT}/t3_08_nopack_${name}.png` })
}
res.log = { pageErrors: log.pageErrors, consoleErrors: [...new Set(log.consoleErrors.map((x) => x.replace(/U\+[0-9A-F]+/, 'U+…').replace(/\d+\/\d+\/\d+\.png/, 'z/x/y.png')))].slice(0, 25) }
note('log', res.log)
save('t3_result.json', res)
await b.close()
