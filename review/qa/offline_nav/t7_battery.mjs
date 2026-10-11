// 7. Battery saver online: on/off on Tonight; What if, Hospitals, Proof while it is on.
import { launch, open, OUT, sleep, waitCard, search, panelText, longTasks, save } from './lib.mjs'
const base = process.argv[2] ?? 'http://127.0.0.1:4173/'
const b = await launch()
const { page, log } = await open(b)
const res = {}
const state = () => page.evaluate(() => {
  const m = window.__map, vis = (id) => m.getLayer(id) ? m.getLayoutProperty(id, 'visibility') ?? 'visible' : 'absent'
  return { lite: window.__mv.lite, pitch: Math.round(m.getPitch()), terrain: !!m.getTerrain(), water: vis('flood-water'), bld: vis('buildings-3d'),
    depthStreetsVis: vis('depth-streets'), depthStreets: m.querySourceFeatures('depth-streets').length, routeSafe: m.getSource('route-safe')?.serialize().data?.geometry?.coordinates?.length ?? 0 }
})
await page.goto(base + '?replay=michaung2023&motion=off')
await waitCard(page, 120000)
await search(page, 'Velachery Main Road'); await sleep(5000); await waitCard(page)
res.tonightOff = await state()
await page.getByRole('button', { name: 'Battery saver' }).click(); await sleep(3000)
res.tonightOn = await state()
await page.screenshot({ path: `${OUT}/t7_01_tonight_saver_on.png` })
// scrub while on: streets recolour?
const tl = page.getByRole('slider', { name: 'Hour of the storm' })
await tl.fill('3'); await sleep(2000); res.hour3 = await state()
await tl.fill('20'); await sleep(2000); res.hour20 = await state()
for (const [name, label, wait] of [['whatif', 'What if', 4000], ['hospitals', 'Hospitals', 4000], ['proof', 'Proof', 6000]]) {
  await page.locator('nav.nav').getByRole('button', { name: label }).click(); await sleep(wait)
  res[name] = { state: await state(), panel: (await panelText(page, '.panel')).slice(0, 160) }
  await page.screenshot({ path: `${OUT}/t7_02_saver_${name}.png` })
}
// What if slider at 50 and 400 with saver on: does the map change at all?
await page.locator('nav.nav').getByRole('button', { name: 'What if' }).click(); await sleep(3000)
const rng = page.getByRole('slider', { name: 'Rainfall in 24 hours, millimetres' })
await rng.fill('50'); await sleep(2000); await page.screenshot({ path: `${OUT}/t7_03_saver_whatif_50.png` }); res.whatif50 = await state()
await rng.fill('400'); await sleep(2000); await page.screenshot({ path: `${OUT}/t7_04_saver_whatif_400.png` }); res.whatif400 = await state()
// back to Tonight, turn it off
await page.locator('nav.nav').getByRole('button', { name: 'Tonight' }).click(); await sleep(3000)
await page.getByRole('button', { name: 'Battery saver on' }).click(); await sleep(3000)
res.tonightBackOff = await state()
await page.screenshot({ path: `${OUT}/t7_05_saver_off_again.png` })
res.log = { pageErrors: log.pageErrors, console: [...new Set(log.consoleErrors.filter((x) => !/glyph/.test(x)))].slice(0, 10) }
save('t7_result.json', res)
console.log(JSON.stringify(res, null, 1))
await b.close()
