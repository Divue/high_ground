// 2 + 4. Save 'Velachery Main Road' for offline, go offline, reload; search outside / at the edge of
// the saved 3 km area; switch storms offline; plan a route offline (with and without the 'seen' cache).
import { launch, open, PROD, OUT, sleep, waitCard, search, panelText, longTasks, save } from './lib.mjs'
const b = await launch()
const { ctx, page, log } = await open(b)
const res = { steps: [] }
const note = (k, v) => { res.steps.push({ k, v }); console.log('##', k, '=>', typeof v === 'string' ? v.slice(0, 600).replace(/\n/g, ' | ') : JSON.stringify(v).slice(0, 600)) }
await page.goto(PROD + '?replay=michaung2023&motion=off')
await page.evaluate(async () => { await navigator.serviceWorker.ready })
await page.reload()
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
await waitCard(page)
await search(page, 'Velachery Main Road')
await sleep(5000); await waitCard(page)
// online Go answer for comparison
await page.getByRole('button', { name: 'Take me to dry ground' }).click()
await page.waitForSelector('.go-result:not(.stale)', { timeout: 60000 }).catch(() => {})
await sleep(1200)
note('online go (two-wheeler, parking)', (await panelText(page, '.go')).split('\n').slice(9, 14).join(' | '))
await page.getByRole('button', { name: 'Close' }).first().click()
const t0 = Date.now()
await page.getByRole('button', { name: 'Save for offline' }).click()
await page.waitForSelector('text=Saved for offline', { timeout: 240000 })
note('save ms', Date.now() - t0)
await page.screenshot({ path: `${OUT}/t2_01_saved.png` })
note('saved line', await page.$eval('.offline-save', (e) => e.innerText))
note('record', await page.evaluate(() => localStorage.getItem('hg-pack-record')))
note('storage', await page.evaluate(async () => {
  const o = {}; for (const n of await caches.keys()) o[n] = (await (await caches.open(n)).keys()).length
  const e = await navigator.storage.estimate(); return { o, MB: Math.round(e.usage / 1e6) }
}))

// ---- offline
await ctx.setOffline(true)
const t1 = Date.now()
await page.reload()
await waitCard(page).catch((e) => note('offline reload card FAIL', String(e)))
note('offline reload -> card ms', Date.now() - t1)
await sleep(2500)
note('offline default card', (await panelText(page)).slice(0, 400))
await page.screenshot({ path: `${OUT}/t2_02_offline_reload.png` })

const tryStreet = async (q, file) => {
  const s = await search(page, q)
  await sleep(5000)
  const txt = await panelText(page)
  note(`offline search "${q}" suggestions`, s)
  note(`offline search "${q}" panel`, txt.slice(0, 700))
  await page.screenshot({ path: `${OUT}/${file}` })
  return txt
}
await tryStreet('Anna Nagar', 't2_03_offline_anna_nagar.png')
await tryStreet('Tambaram', 't2_04_offline_tambaram.png')
await tryStreet('VGP Selva Nagar Extension 2nd Street', 't2_05_offline_edge_2_5km.png')
await tryStreet('Kakkan Nagar Main Road', 't2_06_offline_inside_kakkan.png')

// storm switch offline (on the saved street)
await tryStreet('Velachery Main Road', 't2_07_offline_back_saved.png')
for (const [label, f] of [['2015', 't2_08_offline_2015.png'], ['Fengal 2024', 't2_09_offline_fengal.png'], ['Tonight', 't2_10_offline_tonight.png'], ['Michaung 2023', 't2_11_offline_michaung.png']]) {
  await page.getByRole('group', { name: 'Replay a storm' }).getByRole('button', { name: label }).click()
  await sleep(5000)
  note(`offline storm ${label}`, (await panelText(page)).slice(0, 500))
  note(`offline storm ${label} depth-streets`, await page.evaluate(() => window.__map.querySourceFeatures('depth-streets').length))
  await page.screenshot({ path: `${OUT}/${f}` })
}
// Go offline (with the seen cache)
await page.getByRole('button', { name: 'Take me to dry ground' }).click()
await page.waitForSelector('.go-result:not(.stale), .go [role=alert]', { timeout: 60000 }).catch(() => {})
await sleep(1500)
note('offline go with seen cache', (await panelText(page, '.go')).split('\n').slice(9, 14).join(' | '))
await page.screenshot({ path: `${OUT}/t2_12_offline_go_seen.png` })
await page.getByRole('button', { name: 'Close' }).first().click()
// drop the seen cache: only the saved pack is left, then reload offline
await page.evaluate(async () => { await caches.delete('hg-seen') })
await page.reload()
await waitCard(page).catch((e) => note('offline reload (pack only) FAIL', String(e)))
await sleep(2000)
await tryStreet('Velachery Main Road', 't2_13_packonly_card.png')
await page.getByRole('button', { name: 'Take me to dry ground' }).click()
await page.waitForSelector('.go-result:not(.stale), .go [role=alert]', { timeout: 60000 }).catch(() => {})
await sleep(1500)
note('offline go pack only', (await panelText(page, '.go')).split('\n').slice(5, 14).join(' | '))
await page.screenshot({ path: `${OUT}/t2_14_packonly_go.png` })
// drag the timeline while offline: does the hour matter (no hourly depths for this storm in the pack)?
const tl = page.getByRole('slider', { name: 'Hour of the storm' })
for (const h of [3, 10, 20]) {
  await tl.fill(String(h)); await sleep(2500)
  note(`offline pack-only go at hour ${h}`, (await panelText(page, '.go')).split('\n').slice(8, 12).join(' | '))
}
await page.screenshot({ path: `${OUT}/t2_15_packonly_go_hour20.png` })
note('long tasks >200ms', (await longTasks(page)).filter((x) => x.d > 200))
res.log = { pageErrors: log.pageErrors, consoleErrors: [...new Set(log.consoleErrors.map((x) => x.replace(/U\+[0-9A-F]+/, 'U+…')))].slice(0, 30), failed: [...new Set(log.failed)].slice(0, 40), bad: [...new Set(log.bad)].slice(0, 40) }
note('log', res.log)
save('t2_result.json', res)
await b.close()
