// Why does an offline reload with only the saved pack (no 'seen' cache) never open?
import { launch, open, PROD, OUT, sleep, waitCard, search, save } from './lib.mjs'
const b = await launch()
const { ctx, page, log } = await open(b)
const reqs = []
page.on('response', (r) => { if (r.url().includes('/data/') || r.url().includes('pmtiles')) reqs.push(`${r.status()} ${r.fromServiceWorker() ? 'SW' : 'net'} ${r.url().replace(PROD, '/').slice(0, 120)}`) })
await page.goto(PROD + '?replay=michaung2023&motion=off')
await page.evaluate(async () => { await navigator.serviceWorker.ready })
await page.reload()
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
await waitCard(page)
await search(page, 'Velachery Main Road'); await sleep(5000); await waitCard(page)
await page.getByRole('button', { name: 'Save for offline' }).click()
await page.waitForSelector('text=Saved for offline', { timeout: 240000 })
await page.evaluate(async () => { await caches.delete('hg-seen') })
await ctx.setOffline(true)
reqs.length = 0; log.pageErrors.length = 0; log.consoleErrors.length = 0
await page.reload()
await sleep(25000)
console.log('opened by itself after 25 s:', !!(await page.$('.panel')))
const state = await page.evaluate(() => ({
  mv: !!window.__mv, mapLoaded: window.__map?.loaded?.(), styleLoaded: window.__map?.isStyleLoaded?.(), waterMissing: window.__mv?.waterMissing,
  lite: window.__mv?.lite, loadingEl: !!document.querySelector('.loading'), intro: document.querySelector('.intro-title')?.textContent,
  panel: !!document.querySelector('.panel'), body: document.body.innerText.slice(0, 300),
}))
console.log('state', JSON.stringify(state, null, 1))
const deep = await page.evaluate(async () => {
  const race = (p) => Promise.race([p.then(() => 'resolved', (e) => 'rejected ' + e), new Promise((r) => setTimeout(() => r('pending'), 800))])
  const st = async (u) => { try { const r = await fetch(u); return r.status + ' ' + r.headers.get('content-type') } catch (e) { return 'ERR ' + e } }
  const w = new Worker('/assets/decode.worker-DabTEQgY.js', { type: 'module' })
  const wres = await new Promise((r) => { w.onmessage = (e) => r(e.data.error ? 'worker error ' + e.data.error : 'worker ok ' + e.data.width + 'x' + e.data.height); w.onerror = (e) => r('worker onerror ' + e.message); w.postMessage({ id: 1, url: location.origin + '/data/water/elev.png', gray: false }); setTimeout(() => r('worker timeout'), 5000) })
  return { mapLoadedFlag: window.__map._loaded, fullyLoaded: window.__map._fullyLoaded, terrain: !!window.__map.getTerrain(), wres, ready: await race(window.__mv.ready), meta: !!window.__mv.meta, water: !!window.__mv.water,
    wm: await st('/data/water/meta.json'), elev: await st('/data/water/elev.png'), sea: await st('/data/water/sea.png'),
    frame: await st('/data/water/michaung2023/h01.png'), runs: await st('/data/runs.json'),
    precache: (await (await caches.open((await caches.keys()).find((k) => k.startsWith('workbox')))).keys()).map((r) => new URL(r.url).pathname).filter((p) => p.endsWith('.js') || p.endsWith('.mjs')) }
})
console.log('deep', JSON.stringify(deep, null, 1))
// does a touch on the map unstick it?
await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(760, 480, { steps: 5 }); await page.mouse.up()
await sleep(8000)
console.log('after drag: ready', await page.evaluate(() => Promise.race([window.__mv.ready.then(() => 'resolved'), new Promise((r) => setTimeout(() => r('pending'), 500))])),
  'card', !!(await page.$('.readout')), 'panel', !!(await page.$('.panel')), 'err', await page.$eval('.panel [role=alert]', (e) => e.textContent).catch(() => '-'))
await page.screenshot({ path: `${OUT}/t2b_packonly_after_drag.png` })
await search(page, 'Velachery Main Road'); await sleep(6000)
console.log('pack-only card decision:', await page.$eval('.decision', (e) => e.innerText).catch(() => '(no .decision element)'), '| card:', (await page.$eval('.panel.left', (e) => e.innerText)).split('\n').slice(6, 12).join(' / '))
await page.screenshot({ path: `${OUT}/t2b_packonly_card_vmr.png` })
await page.screenshot({ path: `${OUT}/t2b_packonly_stuck.png` })
const nonOk = reqs.filter((r) => !r.startsWith('200') && !r.startsWith('206'))
console.log('data responses', reqs.length, 'non-200:', nonOk.length)
console.log(nonOk.slice(0, 40).join('\n'))
console.log('pageErrors', log.pageErrors)
console.log('console', [...new Set(log.consoleErrors.map((x) => x.replace(/U\+[0-9A-F]+/, 'U+…')))].slice(0, 15))
const packKeys = await page.evaluate(async () => { const n = (await caches.keys()).find((k) => k.startsWith('hg-pack')); return (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname) })
console.log('pack keys sample', packKeys.filter((k) => !k.includes('/streets/')).join(' '))
save('t2b_result.json', { state, nonOk, reqs, packKeys, log })
await b.close()
