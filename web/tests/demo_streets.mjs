// Type each candidate demo street into the real search box (Michaung replay) and record what the
// answer card shows, so the demo guide lists only streets the video will really see flood.
//   node tests/demo_streets.mjs http://127.0.0.1:5173/ ../data/out/demo_candidates.json ../data/out/demo_streets_verified.json
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
const [base = 'http://127.0.0.1:5173/', inFile, outFile] = process.argv.slice(2)
const cands = JSON.parse(readFileSync(inFile, 'utf8'))
const b = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.goto(base + '?replay=michaung2023&motion=off')
await p.waitForSelector('.readout', { timeout: 120000 })
const out = []
for (const c of cands) {
  const box = p.locator('.search input').first()
  await box.click(); await box.fill(c.name)
  const item = p.locator('.search li, .search [role=option]').filter({ hasText: c.name }).first()
  const ok = await item.waitFor({ timeout: 6000 }).then(() => true).catch(() => false)
  if (!ok) { out.push({ ...c, found: false }); continue }
  await item.click()
  const got = await p.waitForFunction((name) => {
    const st = document.querySelector('.reveal .street')
    return st && st.textContent.includes(name) && document.querySelector('.reveal .readout') ? true : false
  }, c.name, { timeout: 20000 }).then(() => true).catch(() => false)
  await p.waitForTimeout(800)
  const card = await p.evaluate(() => ({
    readout: document.querySelector('.reveal .readout')?.textContent ?? '',
    when: document.querySelector('.reveal .when')?.textContent ?? '',
    decision: document.querySelector('.reveal .decision')?.textContent ?? '',
    stretches: [...document.querySelectorAll('.reveal .muted.small')].map((e) => e.textContent).find((t) => /stretches/.test(t)) ?? '',
  }))
  const cm = Number((card.readout.match(/\d+/) ?? ['0'])[0])
  out.push({ ...c, found: got, card_cm: cm, ...card })
  console.log(`${c.name}: list ${c.cm} cm, card ${cm} cm | ${card.when} | ${card.decision.slice(0, 70)}`)
}
writeFileSync(outFile, JSON.stringify(out, null, 1))
await b.close()
