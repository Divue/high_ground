// 6. Go panel in the UI: every mode x destination on 4 streets; plan time and main-thread long tasks;
// timeline drag while the panel is open (replans? stale?); a street with no route.
import { launch, open, DEV, OUT, sleep, waitCard, search, panelText, longTasks, save } from './lib.mjs'
const base = process.argv[2] ?? DEV
const b = await launch()
const { page, log } = await open(b)
const res = { matrix: [], drag: [], noroute: null }
await page.goto(base + '?replay=michaung2023&motion=off')
await waitCard(page, 120000); await sleep(1500)
const goText = () => panelText(page, '.go')
const waitPlan = async () => {
  const t0 = Date.now()
  await page.waitForFunction(() => { const g = document.querySelector('.go'); if (!g) return false
    const t = g.innerText; return !/Finding a way/.test(t) && !document.querySelector('.go-result.stale') && (/min (by|on)|No route|Could not/.test(t)) }, null, { timeout: 60000 }).catch(() => {})
  return Date.now() - t0
}
for (const street of ['Velachery Main Road', 'Arumugam Road', 'Kakkan Nagar Main Road', 'T Nagar']) {
  await search(page, street); await sleep(4000)
  await waitCard(page).catch(() => {})
  const card = (await panelText(page)).split('\n').slice(5, 9).join(' | ')
  const go = page.getByRole('button', { name: 'Take me to dry ground' })
  if (!(await go.count())) { res.matrix.push({ street, card, err: 'no Take me to dry ground button' }); continue }
  await go.click(); await waitPlan()
  for (const mode of ['On foot', 'Two-wheeler', 'Car']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    for (const dest of ['Dry parking', 'Hospital', 'High ground']) {
      const since = await page.evaluate(() => performance.now())
      await page.getByRole('button', { name: dest, exact: true }).click()
      await sleep(250)
      const ms = await waitPlan()
      const lt = (await longTasks(page, since)).filter((x) => x.d > 50)
      const t = await goText()
      const lines = t.split('\n').filter(Boolean)
      const i = lines.findIndex((l) => /^Leaving at/.test(l))
      res.matrix.push({ street, mode, dest, ms, longTasks: lt.map((x) => x.d), summary: lines.slice(i, i + 5).join(' | '), steps: lines.filter((l, k) => k > i + 4).length })
      console.log(street, '|', mode, '|', dest, '|', ms, 'ms | LT', lt.map((x) => x.d).join(','), '|', lines.slice(i + 1, i + 3).join(' | '))
    }
  }
  await page.screenshot({ path: `${OUT}/t6d_${street.replace(/\W+/g, '_')}_car_high.png` })
  // 'Close' then reopen stays consistent
  await page.getByRole('button', { name: 'Close' }).first().click()
}
// timeline drag with the panel open, on Velachery Main Road, two-wheeler to parking
await search(page, 'Velachery Main Road'); await sleep(4000); await waitCard(page)
await page.getByRole('button', { name: 'Take me to dry ground' }).click(); await waitPlan()
await page.getByRole('button', { name: 'Two-wheeler', exact: true }).click()
await page.getByRole('button', { name: 'Dry parking', exact: true }).click(); await waitPlan()
const tl = page.getByRole('slider', { name: 'Hour of the storm' })
const box = await tl.boundingBox()
// a real drag across the slider (many intermediate hours)
await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2); await page.mouse.down()
for (let k = 1; k <= 30; k++) { await page.mouse.move(box.x + box.width * (0.1 + 0.8 * k / 30), box.y + box.height / 2); await sleep(40) }
await page.mouse.up()
await sleep(200)
const during = await goText()
await waitPlan(); await sleep(800)
const nowLabel = await page.$eval('.timeline .now', (e) => e.textContent)
const after = await goText()
const leaving = /Leaving at ([^(]+)/.exec(after)?.[1]?.trim()
res.drag.push({ nowLabel, leaving, match: nowLabel?.replace(/\s/g, ' ') === leaving?.replace(/\s/g, ' '), duringStale: /stale/.test(await page.$eval('.go-result', (e) => e.className).catch(() => '')), summary: after.split('\n').filter(Boolean).slice(6, 10).join(' | ') })
await page.screenshot({ path: `${OUT}/t6d_drag_end.png` })
// compare with a fresh plan at the same hour
const hourVal = await tl.inputValue()
await page.getByRole('button', { name: 'Close' }).first().click()
await tl.fill(hourVal); await sleep(500)
await page.getByRole('button', { name: 'Take me to dry ground' }).click(); await waitPlan(); await sleep(500)
const fresh = await goText()
res.drag.push({ hourVal, freshSummary: fresh.split('\n').filter(Boolean).slice(6, 10).join(' | '), same: fresh.split('\n').filter(Boolean).slice(6, 10).join('|') === after.split('\n').filter(Boolean).slice(6, 10).join('|') })
// step through hours one by one: does the result change with the hour?
const perHour = []
for (const h of [2, 6, 10, 14, 18, 22, 26, 30, 40, 50]) { await tl.fill(String(h)); await sleep(300); await waitPlan(); await sleep(300); const t = (await goText()).split('\n').filter(Boolean); const i = t.findIndex((l) => /^Leaving/.test(l)); perHour.push(`${h}: ${t.slice(i + 1, i + 3).join(' / ')}`) }
res.drag.push({ perHour })
await page.getByRole('button', { name: 'Close' }).first().click()
// no route: Arumugam Road at its peak, two-wheeler
await search(page, 'Arumugam Road'); await sleep(4000); await waitCard(page)
await tl.fill('49'); await sleep(500)
await page.getByRole('button', { name: 'Take me to dry ground' }).click(); await waitPlan()
await page.getByRole('button', { name: 'Two-wheeler', exact: true }).click(); await sleep(300); await waitPlan()
res.noroute = (await goText()).split('\n').filter(Boolean).slice(5, 9).join(' | ')
await page.screenshot({ path: `${OUT}/t6d_noroute_arumugam.png` })
for (const d of ['High ground', 'Hospital']) { await page.getByRole('button', { name: d, exact: true }).click(); await sleep(300); await waitPlan() }
res.noroute2 = (await goText()).split('\n').filter(Boolean).slice(5, 9).join(' | ')
res.allLong = (await longTasks(page)).filter((x) => x.d > 300)
res.log = { pageErrors: log.pageErrors, console: [...new Set(log.consoleErrors.filter((x) => !/glyph/.test(x)))].slice(0, 10) }
save('t6d_result.json', res)
console.log(JSON.stringify({ drag: res.drag, noroute: res.noroute, noroute2: res.noroute2, allLong: res.allLong, log: res.log }, null, 1))
await b.close()
