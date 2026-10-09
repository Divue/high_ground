// Frame-perfect footage for the demo video. Playwright's virtual clock drives timers,
// requestAnimationFrame and performance.now, so every frame advances exactly 1/FPS of app time
// no matter how slow this laptop renders. Frames are encoded with ffmpeg.
//
//   node tests/record_frames.mjs <shot> [base_url] [out_dir]
//   shots: opening | search | timelapse | whatif | proof
//
// Run each shot once beforehand (or pass WARM=1) so tiles and data come from the HTTP cache.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const shot = process.argv[2] ?? 'opening'
const base = process.argv[3] ?? 'http://127.0.0.1:5173/'
const outDir = path.resolve(process.argv[4] ?? '../review/p5/footage')
const FPS = Number(process.env.FPS ?? 30)
const W = Number(process.env.W ?? 1920), H = Number(process.env.H ?? 1080)
const frameDir = path.join(outDir, `${shot}_frames`)
fs.rmSync(frameDir, { recursive: true, force: true })
fs.mkdirSync(frameDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] })
const context = await browser.newContext({ viewport: { width: W, height: H } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

let n = 0
/** Advance app time by `seconds`, saving one frame every 1/FPS s. */
async function film(seconds) {
  const frames = Math.round(seconds * FPS)
  for (let i = 0; i < frames; i++) {
    if (process.env.MAXFRAMES && n >= Number(process.env.MAXFRAMES)) return   // smoke tests
    await page.clock.runFor(1000 / FPS)
    // let real-time work (tile decoding, worker messages) land before the frame is taken
    await settle()
    await page.screenshot({ path: path.join(frameDir, `f${String(n++).padStart(5, '0')}.png`) })
  }
}
/** Advance app time without saving frames (for waits we do not want in the footage). */
async function skip(seconds) {
  const steps = Math.max(1, Math.round(seconds * 10))
  for (let i = 0; i < steps; i++) { await page.clock.runFor(seconds * 1000 / steps); await page.waitForTimeout(60) }
}
async function search(text) {
  await page.locator('.search input, input[type=search]').first().click()
  for (const ch of text) { await page.keyboard.type(ch); await film(1 / FPS * 3) }
  await film(1.2)
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
}

/** Real-time wait (app time paused) until every visible tile has loaded, so no frame is half-drawn. */
async function settle(maxMs = Number(process.env.SETTLE_MAX_MS ?? 2500)) {
  const t = Date.now()
  await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 30))
  while (Date.now() - t < maxMs) {
    const ok = await page.evaluate(() => !window.__map || window.__map.areTilesLoaded()).catch(() => true)
    if (ok) return
    await page.waitForTimeout(50)
  }
}
/** Real-time wait for the map to load, nudging app time so startup timers fire. */
async function waitReady() {
  for (let i = 0; i < 400; i++) {
    if (await page.evaluate(() => !!window.__map && window.__map.loaded()).catch(() => false)) return
    await page.clock.runFor(16)
    await page.waitForTimeout(100)
  }
}

/** Fake clock pinned to a fixed evening and paused: app time moves only through film()/skip(). */
async function startClock() {
  const t0 = new Date(process.env.CLOCK ?? '2026-10-09T18:30:00+05:30')
  await page.clock.install({ time: t0 })
  await page.clock.pauseAt(new Date(t0.getTime() + 10))
}

async function warm(url) {
  // real-time pass so tiles, frames and JSON are in the HTTP cache before filming
  const p = await context.newPage()
  await p.goto(url); await p.waitForSelector('.readout', { timeout: 120_000 }).catch(() => {})
  await p.waitForTimeout(8000); await p.close()
}

const shots = {
  // the one orchestrated moment: Bay of Bengal -> Velachery, the night plays to the peak
  async opening() {
    const url = `${base}?replay=michaung2023`
    if (process.env.WARM) await warm(url)
    await startClock()
    await page.goto(url)
    await waitReady()
    await film(22)
  },
  // a resident types their street
  async search() {
    const url = `${base}?replay=michaung2023`
    if (process.env.WARM) await warm(url)
    await startClock()
    await page.goto(url)
    await waitReady()
    await skip(20)
    await film(1)
    await search('Arumugam Road')
    await film(12)
  },
  // "Watch the whole storm" on the 2015 replay
  async timelapse() {
    const url = `${base}?replay=dec2015_reservoir`
    if (process.env.WARM) await warm(url)
    await startClock()
    await page.goto(url)
    await waitReady()
    await skip(20)
    await film(1)
    await page.getByRole('button', { name: 'Watch the whole storm' }).click()
    await film(34)
  },
  // What if: drag the rainfall slider from 50 to 400 mm
  async whatif() {
    const url = `${base}?replay=michaung2023#whatif`
    if (process.env.WARM) await warm(url)
    await startClock()
    await page.goto(url)
    await waitReady()
    await skip(14)
    const slider = page.locator('input[type=range]').first()
    const box = await slider.boundingBox()
    await film(1)
    await page.mouse.move(box.x + 2, box.y + box.height / 2); await page.mouse.down()
    const steps = 4 * FPS
    for (let i = 0; i <= steps; i++) {
      await page.mouse.move(box.x + 2 + (box.width - 4) * (i / steps), box.y + box.height / 2)
      await film(1 / FPS)
    }
    await page.mouse.up()
    await film(3)
  },
  // Proof: the split handle swept across
  async proof() {
    const url = `${base}#proof`
    if (process.env.WARM) await warm(url)
    await startClock()
    await page.goto(url)
    await waitReady()
    await skip(10)
    await film(2)
    const h = page.locator('.split-handle, [role=separator]').first()
    const b = await h.boundingBox().catch(() => null)
    if (b) {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down()
      for (let i = 0; i <= 2 * FPS; i++) { await page.mouse.move(b.x + b.width / 2 - 500 * (i / (2 * FPS)), b.y + b.height / 2); await film(1 / FPS) }
      await page.mouse.up()
    }
    await film(4)
  },
}

if (!shots[shot]) { console.error(`unknown shot ${shot}; one of ${Object.keys(shots).join(', ')}`); process.exit(1) }
const t0 = Date.now()
await shots[shot]()
await browser.close()
const mp4 = path.join(outDir, `${shot}.mp4`)
// Fedora's ffmpeg has no libx264; OpenH264 gives a standard H.264 MP4. The PNG frames stay as a lossless master.
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frameDir, 'f%05d.png'),
  '-c:v', 'libopenh264', '-b:v', process.env.BITRATE ?? '16M', '-pix_fmt', 'yuv420p', mp4])
console.log(JSON.stringify({ shot, frames: n, seconds: +(n / FPS).toFixed(1), wall_s: Math.round((Date.now() - t0) / 1000), mp4, errors }))
