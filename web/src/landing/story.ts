// Binds scroll to the scene: one GSAP timeline scrubbed by ScrollTrigger moves a plain state
// object; the render loop reads it. Text steps fade from the same smoothed progress.
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { CityScene, type StoryState } from './scene/CityScene'
import type { SceneData } from './scene/types'

gsap.registerPlugin(ScrollTrigger)

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const W = 0.025

/** opacity of a text step at progress p */
export function stepOpacity(p: number, a: number, b: number) {
  if (b > 1) return smooth(a, a + W, p)
  return a === 0 ? 1 - smooth(b - W, b, p) : smooth(a, a + W, p) * (1 - smooth(b - W, b, p))
}

export function bandIndex(cm: number) { return cm < 5 ? 0 : cm < 15 ? 1 : cm < 30 ? 2 : 3 }

/** "11 PM": a replay starts at 6 PM, hour h is h hours later */
export function clockAt(h: number) {
  const t = 18 + Math.round(h), hh = t % 24
  const day = t >= 48 ? ', day 3' : t >= 24 && hh >= 12 ? ', next day' : ''
  return `${hh % 12 === 0 ? 12 : hh % 12}\u00a0${hh < 12 ? 'AM' : 'PM'}${day}`
}

export function applyText(root: HTMLElement, p: number) {
  const narrow = window.innerWidth < 720
  root.querySelectorAll<HTMLElement>('.lp-step').forEach((el) => {
    const o = stepOpacity(p, +el.dataset.in!, +el.dataset.out!)
    el.style.opacity = o.toFixed(3)
    const dy = ((1 - o) * 14).toFixed(1)
    el.style.transform = narrow ? `translateY(${dy}px)` : `translateY(calc(-50% + ${dy}px))`
    el.classList.toggle('on', o > 0.01)
  })
  const r = p < 0.1 ? -1 : p < 0.26 ? 0 : p < 0.44 ? 1 : p < 0.61 ? 2 : p < 0.82 ? 3 : -1
  root.querySelectorAll<HTMLElement>('.lp-rail > div').forEach((d, i) => d.classList.toggle('cur', i === r))
  const rail = root.querySelector<HTMLElement>('.lp-rail')
  if (rail) rail.style.opacity = (smooth(0.07, 0.1, p) * (1 - smooth(0.8, 0.83, p))).toFixed(3)
}

/** the street gauge: real depth from the street's series when there is one, else the drawn water */
export function applyGauge(root: HTMLElement, cm: number, hour: number | null) {
  const fill = root.querySelector<HTMLElement>('.lp-fill')
  if (fill) fill.style.height = `${Math.min(100, cm / 40 * 100).toFixed(1)}%`
  const b = bandIndex(cm)
  root.querySelectorAll<HTMLElement>('.lp-band').forEach((el) => el.classList.toggle('cur', +el.dataset.b! === b))
  const out = root.querySelector<HTMLElement>('.lp-readout-cm')
  if (out) {
    out.textContent = `${Math.round(cm)}`
    out.style.setProperty('font-variation-settings', `'wdth' ${(90 + Math.min(1, cm / 60) * 35).toFixed(0)}, 'wght' ${(450 + Math.min(1, cm / 60) * 300).toFixed(0)}`)
  }
  const at = root.querySelector<HTMLElement>('.lp-readout-at')
  if (at && hour != null) at.textContent = `at ${clockAt(hour)}`
}

export function startStory(root: HTMLElement, canvas: HTMLCanvasElement, data: SceneData, reduced: boolean): () => void {
  const small = window.innerWidth < 720
  const city = new CityScene(canvas, data, small)
  const story = root.querySelector<HTMLElement>('.lp-story')!
  const stage = root.querySelector<HTMLElement>('.lp-stage')!
  const { K0, K1, K2, K3, K4, K5 } = city.shots
  const st: StoryState = { ...K0, water: 0, show: 0, rain: 0, route: 0, mark: 0 }

  const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } })
  tl.to(st, { ...K1, duration: 0.15 }, 0)
    .to(st, { ...K2, duration: 0.2, ease: 'power1.inOut' }, 0.15)
    .to(st, { ...K3, duration: 0.15, ease: 'power1.inOut' }, 0.35)
    .to(st, { ...K4, duration: 0.22, ease: 'power1.inOut' }, 0.5)
    .to(st, { ...K5, duration: 0.28 }, 0.72)
    .to(st, { rain: 1, duration: 0.14 }, 0.14)
    .to(st, { rain: 0.3, duration: 0.2 }, 0.78)
    .to(st, { show: 1, duration: 0.06 }, 0.17)
    .to(st, { water: 0.55, duration: 0.17 }, 0.18)
    .to(st, { water: 1, duration: 0.15 }, 0.36)
    .to(st, { mark: 1, duration: 0.06 }, 0.4)
    .to(st, { route: 1, duration: 0.2, ease: 'power1.inOut' }, 0.58)

  const series = data.street.seriesCm
  let dirty = true
  const onProgress = () => {
    const p = tl.progress()
    applyText(root, p)
    const hour = city.frameHourAt(st.water)
    let cm: number
    if (series && series.length) {
      const i = Math.min(series.length - 1, Math.max(0, hour - 1))
      const i0 = Math.floor(i), i1 = Math.min(series.length - 1, i0 + 1)
      cm = (series[i0] + (series[i1] - series[i0]) * (i - i0)) * st.show
    } else {
      // stylised city: an illustration that fills with the drawn water (the page says so)
      cm = Math.min(1, st.water) * st.show * 45
    }
    applyGauge(root, cm, series ? hour : null)
    dirty = true
  }
  tl.eventCallback('onUpdate', onProgress)
  const trig = ScrollTrigger.create({ trigger: story, start: 'top top', end: 'bottom bottom', scrub: reduced ? true : 0.9, animation: tl })

  const resize = () => { city.resize(canvas.clientWidth, canvas.clientHeight); dirty = true }
  window.addEventListener('resize', resize)
  let visible = true
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting })
  io.observe(stage)
  let raf = 0
  const t0 = performance.now()
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    if (!visible || (reduced && !dirty)) return
    city.render(st, reduced ? 0 : (now - t0) / 1000)
    dirty = false
  }
  resize()
  onProgress()
  raf = requestAnimationFrame(frame)

  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', resize)
    io.disconnect()
    trig.kill()
    tl.kill()
    city.dispose()
  }
}

/** without WebGL the steps still change with scroll */
export function startTextOnly(root: HTMLElement): () => void {
  const story = root.querySelector<HTMLElement>('.lp-story')!
  const on = () => {
    const p = Math.min(1, Math.max(0, (window.scrollY - story.offsetTop) / (story.offsetHeight - window.innerHeight)))
    applyText(root, p)
  }
  window.addEventListener('scroll', on, { passive: true })
  on()
  return () => window.removeEventListener('scroll', on)
}
