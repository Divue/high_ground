// Rain as screen-space streaks on its own transparent canvas above the map.
// (World-space streaks were under a metre wide at street zoom: thinner than a pixel, so invisible.)
// Three depth layers give parallax: near streaks are longer, faster and brighter. Only this small
// canvas redraws while it rains; the map itself repaints only when the camera or the water changes.
import type { Map as MLMap } from 'maplibre-gl'

interface Drop { x: number; y: number; len: number; speed: number; layer: number }

export class RainOverlay {
  private canvas = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private map: MLMap
  private drops: Drop[] = []
  private level = 0
  private target = 0
  private raf = 0
  private last = performance.now()
  private ro: ResizeObserver
  private w = 0
  private h = 0

  constructor(map: MLMap) {
    this.map = map
    const c = this.canvas
    c.className = 'rain-overlay'
    Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' })
    map.getCanvas().after(c)
    this.ctx = c.getContext('2d')!
    const resize = () => {
      this.w = c.width = map.getContainer().clientWidth
      this.h = c.height = map.getContainer().clientHeight
      this.seed()
    }
    resize()
    this.ro = new ResizeObserver(resize)
    this.ro.observe(map.getContainer())
  }

  private seed() {
    const n = Math.round((this.w * this.h) / 1500)   // ~860 streaks at 1440x900
    this.drops = Array.from({ length: n }, () => this.drop(Math.random() * this.h))
  }
  private drop(y: number): Drop {
    const layer = Math.random() < 0.15 ? 2 : Math.random() < 0.5 ? 1 : 0
    return { x: Math.random() * (this.w + 200) - 100, y, layer,
      len: [9, 15, 26][layer] * (0.8 + Math.random() * 0.4), speed: [520, 820, 1250][layer] * (0.85 + Math.random() * 0.3) }
  }

  /** Not needed for screen-space rain; kept so the water layer can call it every render. */
  setMatrix(_m: ArrayLike<number>) { void _m }

  setLevel(level: number) {
    this.target = level
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick) }
  }

  private tick = (now: number) => {
    this.raf = 0
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.level += (this.target - this.level) * Math.min(1, dt * 3)
    const zoom = this.map.getZoom()
    // rain reads as weather up close; from high above the city it fades out
    const vis = this.level * Math.min(1, Math.max(0, (zoom - 10) / 2.5))
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.w, this.h)
    if (vis > 0.01) {
      // wind slant, turning a little with the camera so the rain feels attached to the scene
      const slant = 0.18 + 0.08 * Math.sin((this.map.getBearing() * Math.PI) / 180)
      const shown = Math.round(this.drops.length * Math.min(1, 0.25 + vis))
      ctx.lineCap = 'round'
      for (let layer = 0; layer < 3; layer++) {
        ctx.strokeStyle = `rgba(214, 228, 234, ${[0.18, 0.26, 0.38][layer] * vis})`
        ctx.lineWidth = [0.8, 1.1, 1.6][layer]
        ctx.beginPath()
        for (let i = 0; i < shown; i++) {
          const d = this.drops[i]
          if (d.layer !== layer) continue
          d.y += d.speed * dt
          d.x += d.speed * dt * slant
          if (d.y - d.len > this.h) Object.assign(d, this.drop(-Math.random() * 60))
          ctx.moveTo(d.x, d.y)
          ctx.lineTo(d.x - d.len * slant, d.y - d.len)
        }
        ctx.stroke()
      }
    }
    // keep running while it rains or is still fading out
    if (this.target > 0.01 || this.level > 0.01) this.raf = requestAnimationFrame(this.tick)
    else ctx.clearRect(0, 0, this.w, this.h)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.canvas.remove()
  }
}
