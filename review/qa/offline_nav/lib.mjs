// Shared helpers for the offline/navigation QA scripts (read-only against the app).
import { chromium } from '/home/tekiru/Desktop/highground/web/node_modules/@playwright/test/index.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
export const OUT = '/home/tekiru/Desktop/highground/review/qa/offline_nav'
export const PROD = 'http://127.0.0.1:4173/'
export const DEV = 'http://127.0.0.1:5173/'
mkdirSync(OUT, { recursive: true })

export async function launch() {
  return chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'] })
}

/** a context + page with error, console, failed request and long-task logging */
export async function open(browser, opts = {}, tag = 'x') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts })
  const page = await ctx.newPage()
  const log = { pageErrors: [], consoleErrors: [], failed: [], bad: [] }
  page.on('pageerror', (e) => log.pageErrors.push(String(e).slice(0, 300)))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.consoleErrors.push(`${m.type()}: ${m.text().slice(0, 300)}`) })
  page.on('requestfailed', (r) => log.failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 160)}`))
  page.on('response', (r) => { if (r.status() >= 400) log.bad.push(`${r.status()} ${r.url().slice(0, 160)}`) })
  await ctx.addInitScript(() => {
    window.__long = []
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }) })
        .observe({ type: 'longtask', buffered: true })
    } catch {}
  })
  return { ctx, page, log }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function waitCard(page, timeout = 90000) {
  await page.waitForSelector('.readout', { timeout })
}

/** type a query, wait for suggestions, return them; pick=true picks the first */
export async function search(page, q, pick = true) {
  const box = page.getByRole('combobox')
  await box.click()
  await box.fill('')
  await box.fill(q)
  await sleep(1200)
  const items = await page.$$eval('#search-list li', (ls) => ls.map((l) => l.textContent)).catch(() => [])
  const source = await page.$eval('.search .source', (e) => e.textContent).catch(() => '')
  if (pick && items.length) await page.keyboard.press('Enter')
  return { items, source }
}

export async function panelText(page, sel = '.panel.left') {
  return page.$eval(sel, (e) => e.innerText).catch(() => '(no panel)')
}

export async function longTasks(page, since = 0) {
  return page.evaluate((s) => (window.__long || []).filter((x) => x.t >= s), since)
}

export function save(name, obj) { writeFileSync(`${OUT}/${name}`, JSON.stringify(obj, null, 1)) }
