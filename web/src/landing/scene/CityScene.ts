// The landing page's single WebGL scene: terrain, buildings, roads, water frames, rain, the street
// and the suggested route. Scroll drives it through a plain state object (no React per frame).
import * as THREE from 'three'
import type { SceneData } from './types'

const U = 1 / 50                     // scene units per metre, horizontal

export interface Shot { px: number; py: number; pz: number; tx: number; ty: number; tz: number }
export interface StoryState extends Shot { water: number; show: number; rain: number; route: number; mark: number }

const ROAD_HALF_M = [9, 8, 6.5, 5.5, 4, 3]          // by class: motorway/trunk ... service
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

interface Bridge { xy: Float32Array; cum: number[]; deck: number; len: number; g0: number; g1: number }

export class CityScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 3000)
  readonly data: SceneData
  readonly shots: Record<'K0' | 'K1' | 'K2' | 'K3' | 'K4' | 'K5', Shot>
  /** the street's depth series index for a given story water value, for the readout */
  readonly frameHourAt: (w: number) => number
  private readonly yU: number
  private readonly bridges: Bridge[] = []
  private readonly wU: Record<string, THREE.IUniform>
  private readonly rU: Record<string, THREE.IUniform>
  private readonly waterGeo: THREE.BufferGeometry
  private readonly safeTube: THREE.Mesh
  private readonly usualTube: THREE.Mesh | null
  private readonly streetTube: THREE.Mesh
  private readonly ring: THREE.Mesh
  private readonly beam: THREE.Mesh
  private readonly pin: THREE.Mesh
  private readonly look = new THREE.Vector3()
  private frameKey = ''
  private streetY = 0

  constructor(canvas: HTMLCanvasElement, data: SceneData, small: boolean) {
    this.data = data
    this.yU = data.vex * U
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.75))
    this.renderer.setClearColor(0x050d12, 1)
    this.scene.fog = new THREE.Fog(0x050d12, 40, 120)
    this.scene.add(new THREE.HemisphereLight(0x7d9cad, 0x04080a, 0.75))
    const moon = new THREE.DirectionalLight(0xa9c2cf, 0.55)
    moon.position.set(-25, 40, 18)
    this.scene.add(moon)

    this.collectBridges()
    this.addTerrain()
    this.addRoads()
    this.addBuildings()
    const water = this.addWater()
    this.waterGeo = water.geo
    this.wU = water.uniforms
    this.rU = this.addRain(small ? 1600 : 4200)

    // street, route, parking
    const amber = new THREE.MeshBasicMaterial({ color: 0xf2a541, fog: false })
    this.safeTube = this.tube(this.routePoints(data.route.dry, 4), 0.13, amber)
    this.usualTube = data.route.usual
      ? this.tube(this.routePoints(data.route.usual, 2.5), 0.07, new THREE.MeshBasicMaterial({ color: 0x8fa2aa, transparent: true, opacity: 0.55, fog: false }))
      : null
    const sPts = this.routePoints(data.street.line, 3)
    this.streetTube = this.tube(sPts, 0.1, new THREE.MeshBasicMaterial({ color: 0xd6e0e4, transparent: true, opacity: 0, fog: false, depthTest: false }))
    this.streetTube.geometry.setDrawRange(0, Infinity)
    const sMid = sPts[Math.floor(sPts.length / 2)]
    this.streetY = this.groundM(...this.toM(sMid)) * this.yU
    this.pin = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 40),
      new THREE.MeshBasicMaterial({ color: 0xd6e0e4, transparent: true, opacity: 0, side: THREE.DoubleSide, fog: false, depthTest: false }))
    this.pin.rotation.x = -Math.PI / 2
    this.pin.position.copy(sMid)
    this.pin.renderOrder = 5
    this.scene.add(this.pin)

    const pk = data.route.parking
    const pkY = this.surfaceM(pk.x, pk.y) * this.yU
    const pkPos = new THREE.Vector3(pk.x * U, pkY, -pk.y * U)
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 40),
      new THREE.MeshBasicMaterial({ color: 0xf2a541, transparent: true, opacity: 0, side: THREE.DoubleSide, fog: false }))
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.copy(pkPos).setY(pkY + 0.08)
    this.scene.add(this.ring)
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 8),
      new THREE.MeshBasicMaterial({ color: 0xf2a541, transparent: true, opacity: 0, fog: false }))
    this.beam.position.copy(pkPos).setY(pkY + 3)
    this.scene.add(this.beam)

    // camera journey
    const S = data.size * U
    const C = new THREE.Vector3(S / 2, 0, -S / 2)
    const sY = this.streetY
    const mid = new THREE.Vector3().addVectors(sMid, pkPos).multiplyScalar(0.5)
    const span = Math.max(10, Math.hypot(sMid.x - pkPos.x, sMid.z - pkPos.z))
    const K = (p: THREE.Vector3, d: [number, number, number], t: THREE.Vector3, ty = t.y): Shot =>
      ({ px: p.x + d[0], py: p.y + d[1], pz: p.z + d[2], tx: t.x, ty, tz: t.z })
    this.shots = {
      K0: K(C, [0.8 * S, 0.5 * S, 0.47 * S], C, 0),
      K1: K(C, [0.58 * S, 0.35 * S, 0.36 * S], C, 0),
      K2: K(sMid, [15, sY + 11, 14], sMid, sY),
      K3: { px: sMid.x + 7.5, py: sY + 6.2, pz: sMid.z + 8.5, tx: sMid.x - 0.3, ty: sY + 0.2, tz: sMid.z - 0.3 },
      K4: K(mid, [0.55 * span + 4, 0.95 * span + 7, 0.85 * span + 6], mid, 0.5),
      K5: { px: mid.x + 0.7 * span + 6, py: 1.15 * span + 9, pz: mid.z + 1.05 * span + 8, tx: mid.x - 1, ty: 0, tz: mid.z - 1 },
    }
    this.frameHourAt = (w: number) => {
      const h = data.frameHours
      const f = Math.min(1, Math.max(0, w)) * (h.length - 1)
      const i = Math.floor(f)
      return h[i] + (h[Math.min(i + 1, h.length - 1)] - h[i]) * (f - i)
    }
  }

  // ------------------------------------------------------------------ heights
  private toM(v: THREE.Vector3): [number, number] { return [v.x / U, -v.z / U] }

  /** ground height in metres at local metres (x east, y north), bilinear */
  groundM(x: number, y: number): number {
    const { n, cell, ground } = this.data
    const fx = Math.min(n - 1.001, Math.max(0, x / cell)), fy = Math.min(n - 1.001, Math.max(0, y / cell))
    const c = Math.floor(fx), r = Math.floor(fy), ax = fx - c, ay = fy - r
    const g = (rr: number, cc: number) => ground[rr * n + cc]
    return (g(r, c) * (1 - ax) + g(r, c + 1) * ax) * (1 - ay) + (g(r + 1, c) * (1 - ax) + g(r + 1, c + 1) * ax) * ay
  }

  private collectBridges() {
    const { xy, off, bridge } = this.data.roads
    for (let i = 0; i < bridge.length; i++) {
      if (!bridge[i]) continue
      const pts = xy.subarray(off[i] * 2, off[i + 1] * 2)
      const cum = [0]
      for (let k = 1; k < pts.length / 2; k++) cum.push(cum[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]))
      const len = cum[cum.length - 1]
      if (len < 1) continue
      const g0 = this.groundM(pts[0], pts[1]), g1 = this.groundM(pts[pts.length - 2], pts[pts.length - 1])
      this.bridges.push({ xy: pts, cum, len, g0, g1, deck: Math.max(g0, g1) + 7 })
    }
  }

  /** deck height along a bridge at distance s from its start */
  private deckAt(b: Bridge, s: number) {
    const ramp = Math.min(120, b.len * 0.3)
    const up = smooth(0, ramp, s), down = smooth(0, ramp, b.len - s)
    const r = Math.min(up, down)
    const g = b.g0 + (b.g1 - b.g0) * (s / b.len)
    return g + (b.deck - g) * r
  }

  /** road surface in metres: a bridge deck when the point lies on one, else the ground */
  surfaceM(x: number, y: number): number {
    let best = this.groundM(x, y)
    for (const b of this.bridges) {
      const p = b.xy
      for (let k = 0; k < p.length / 2 - 1; k++) {
        const ax = p[k * 2], ay = p[k * 2 + 1], bx = p[k * 2 + 2], by = p[k * 2 + 3]
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / L2))
        if (Math.hypot(ax + dx * t - x, ay + dy * t - y) < 10) best = Math.max(best, this.deckAt(b, b.cum[k] + t * Math.sqrt(L2)))
      }
    }
    return best
  }

  // ------------------------------------------------------------------ geometry
  private plane() {
    const S = this.data.size * U
    const g = new THREE.PlaneGeometry(S, S, this.data.n - 1, this.data.n - 1)
    g.rotateX(-Math.PI / 2)
    g.translate(S / 2, 0, -S / 2)
    return g
  }

  private gridIndex(x: number, z: number) {
    const { n, cell } = this.data
    const c = Math.round(x / (cell * U)), r = Math.round(-z / (cell * U))
    return Math.min(n - 1, Math.max(0, r)) * n + Math.min(n - 1, Math.max(0, c))
  }

  private addTerrain() {
    const g = this.plane()
    const pos = g.attributes.position
    const sorted = Float32Array.from(this.data.ground).sort()
    const lo = sorted[Math.floor(sorted.length * 0.03)], hi = sorted[Math.floor(sorted.length * 0.97)]
    const cols = new Float32Array(pos.count * 3)
    const low = new THREE.Color(0x0a181e), high = new THREE.Color(0x152a33), c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const h = this.data.ground[this.gridIndex(pos.getX(i), pos.getZ(i))]
      pos.setY(i, h * this.yU)
      c.copy(low).lerp(high, smooth(lo, hi, h))
      cols.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    g.computeVertexNormals()
    this.scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true })))
  }

  private addRoads() {
    const { xy, off, cls, bridge } = this.data.roads
    const pos: number[] = []
    const lamps: number[] = []
    const step = this.data.cell
    const lift = 0.6
    for (let i = 0; i < cls.length; i++) {
      const pts = xy.subarray(off[i] * 2, off[i + 1] * 2)
      const hw = ROAD_HALF_M[Math.min(5, cls[i])]
      const br = bridge[i] ? this.bridges.find((b) => b.xy === pts || (b.xy[0] === pts[0] && b.xy[1] === pts[1] && b.xy.length === pts.length)) : undefined
      let along = 0, sinceLamp = 60
      for (let k = 0; k < pts.length / 2 - 1; k++) {
        const ax = pts[k * 2], ay = pts[k * 2 + 1], bx = pts[k * 2 + 2], by = pts[k * 2 + 3]
        const L = Math.hypot(bx - ax, by - ay)
        if (L < 0.01) continue
        const nx = -(by - ay) / L * hw, ny = (bx - ax) / L * hw
        const steps = Math.max(1, Math.ceil(L / step))
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps, t1 = (s + 1) / steps
          const x0 = ax + (bx - ax) * t0, y0 = ay + (by - ay) * t0, x1 = ax + (bx - ax) * t1, y1 = ay + (by - ay) * t1
          const h0 = (br ? this.deckAt(br, along + L * t0) : this.groundM(x0, y0)) + lift
          const h1 = (br ? this.deckAt(br, along + L * t1) : this.groundM(x1, y1)) + lift
          const v = (x: number, y: number, h: number) => pos.push(x * U, h * this.yU, -y * U)
          v(x0 - nx, y0 - ny, h0); v(x0 + nx, y0 + ny, h0); v(x1 + nx, y1 + ny, h1)
          v(x0 - nx, y0 - ny, h0); v(x1 + nx, y1 + ny, h1); v(x1 - nx, y1 - ny, h1)
          sinceLamp += L / steps
          if (cls[i] <= 2 && sinceLamp > 120) { sinceLamp = 0; lamps.push((x1 + nx * 1.4) * U, (h1 + 9) * this.yU, -(y1 + ny * 1.4) * U) }
        }
        along += L
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    this.scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2b434e, side: THREE.DoubleSide })))
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lamps, 3))
    this.scene.add(new THREE.Points(lg, new THREE.PointsMaterial({ color: 0xe9dfc9, size: 0.14, transparent: true, opacity: 0.7 })))
  }

  private addBuildings() {
    const { xy, off, height } = this.data.buildings
    const pos: number[] = [], col: number[] = []
    const c = new THREE.Color()
    let seed = 11
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < height.length; i++) {
      const pts = xy.subarray(off[i] * 2, off[i + 1] * 2)
      const m = pts.length / 2
      if (m < 3) continue
      let base = Infinity
      for (let k = 0; k < m; k++) base = Math.min(base, this.groundM(pts[k * 2], pts[k * 2 + 1]))
      const b = (base - 1) * this.yU, t = (base + height[i]) * this.yU
      c.setHSL(0.55, 0.16, 0.12 + rnd() * 0.07 + Math.min(0.05, height[i] / 1200))
      const push = (x: number, y: number, h: number) => { pos.push(x * U, h, -y * U); col.push(c.r, c.g, c.b) }
      for (let k = 0; k < m; k++) {
        const k2 = (k + 1) % m
        const ax = pts[k * 2], ay = pts[k * 2 + 1], bx = pts[k2 * 2], by = pts[k2 * 2 + 1]
        push(ax, ay, b); push(bx, by, b); push(bx, by, t)
        push(ax, ay, b); push(bx, by, t); push(ax, ay, t)
      }
      const contour: THREE.Vector2[] = []
      for (let k = 0; k < m; k++) contour.push(new THREE.Vector2(pts[k * 2], pts[k * 2 + 1]))
      for (const tri of THREE.ShapeUtils.triangulateShape(contour, [])) for (const k of tri) push(contour[k].x, contour[k].y, t)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.computeVertexNormals()
    this.scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide })))
  }

  private addWater() {
    const geo = this.plane()
    const pos = geo.attributes.position
    const aG = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i++) aG[i] = this.data.ground[this.gridIndex(pos.getX(i), pos.getZ(i))] * this.yU
    geo.setAttribute('aG', new THREE.BufferAttribute(aG, 1))
    geo.setAttribute('aD0', new THREE.BufferAttribute(new Float32Array(pos.count), 1))
    geo.setAttribute('aD1', new THREE.BufferAttribute(new Float32Array(pos.count), 1))
    const uniforms: Record<string, THREE.IUniform> = {
      uMix: { value: 0 }, uShow: { value: 0 }, uTime: { value: 0 }, uMin: { value: 0.03 * this.yU }, uUPM: { value: this.yU },
      uCam: { value: new THREE.Vector3() }, uShallow: { value: new THREE.Color(0x86e6ec) }, uDeep: { value: new THREE.Color(0x1e7bc6) },
      uFog: { value: new THREE.Color(0x050d12) }, uFogNear: { value: 40 }, uFogFar: { value: 120 },
    }
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute float aG; attribute float aD0; attribute float aD1;
        uniform float uMix; uniform float uMin; varying float vD; varying float vG; varying vec3 vW;
        void main() {
          float d = mix(aD0, aD1, uMix); vD = d;
          vec3 p = position; p.y = d > uMin ? aG + d + uMin * 0.5 : aG + min(d, 0.0) - uMin * 4.0;
          vG = aG;
          vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uCam; uniform vec3 uFog;
        uniform float uTime; uniform float uShow; uniform float uMin; uniform float uUPM; uniform float uFogNear; uniform float uFogFar;
        varying float vD; varying float vG; varying vec3 vW;
        void main() {
          // the sea is always there; floodwater appears with the story
          float a = smoothstep(uMin, uMin * 3.0, vD) * max(uShow, step(vG, -0.3 * uUPM));
          if (a < 0.01) discard;
          float m = vD / uUPM;
          vec3 c = mix(uShallow * 0.85, uDeep, smoothstep(0.0, 0.9, m));
          c += 0.045 * sin(vW.x * 2.3 + uTime * 1.3) * sin(vW.z * 2.9 - uTime * 1.1);
          vec3 v = normalize(uCam - vW);
          c = mix(c, uShallow * 1.1, pow(1.0 - max(v.y, 0.0), 3.0) * 0.3);
          float f = smoothstep(uFogNear, uFogFar, length(uCam - vW));
          gl_FragColor = vec4(mix(c, uFog, f), a * mix(0.45, 0.82, smoothstep(0.0, 1.0, m)) * (1.0 - f * 0.6));
        }`,
    }))
    mesh.renderOrder = 2
    this.scene.add(mesh)
    return { geo, uniforms }
  }

  private addRain(count: number) {
    const R = Math.min(70, this.data.size * U)
    let seed = 3
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const pos = new Float32Array(count * 6), end = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      const x = (rnd() - 0.5) * R, y = rnd() * 34, z = (rnd() - 0.5) * R
      pos.set([x, y, z, x, y, z], i * 6)
      end[i * 2 + 1] = 1
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1))
    const uniforms: Record<string, THREE.IUniform> = { uTime: { value: 0 }, uRain: { value: 0 }, uCenter: { value: new THREE.Vector3() } }
    const lines = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute float aEnd; uniform float uTime; uniform vec3 uCenter; varying float vA;
        void main() {
          vec3 p = position; p.y = mod(p.y - uTime * 22.0, 34.0) - 4.0 + aEnd * 0.9;
          p.x += aEnd * 0.12; p.xz += uCenter.xz; p.y += uCenter.y; vA = aEnd;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`uniform float uRain; varying float vA; void main() { gl_FragColor = vec4(0.79, 0.83, 0.85, uRain * 0.32 * vA); }`,
    }))
    lines.frustumCulled = false
    this.scene.add(lines)
    return uniforms
  }

  /** world points along a polyline in metres, densified, sitting on the road surface */
  private routePoints(line: Float32Array, liftM: number): THREE.Vector3[] {
    const out: THREE.Vector3[] = []
    const step = this.data.cell
    for (let k = 0; k < line.length / 2 - 1; k++) {
      const ax = line[k * 2], ay = line[k * 2 + 1], bx = line[k * 2 + 2], by = line[k * 2 + 3]
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
      for (let s = 0; s < steps; s++) {
        const x = ax + (bx - ax) * s / steps, y = ay + (by - ay) * s / steps
        out.push(new THREE.Vector3(x * U, (this.surfaceM(x, y) + liftM) * this.yU + 0.06, -y * U))
      }
    }
    const lx = line[line.length - 2], ly = line[line.length - 1]
    out.push(new THREE.Vector3(lx * U, (this.surfaceM(lx, ly) + liftM) * this.yU + 0.06, -ly * U))
    return out
  }

  private tube(pts: THREE.Vector3[], r: number, mat: THREE.Material) {
    const path = new THREE.CurvePath<THREE.Vector3>()
    for (let k = 0; k < pts.length - 1; k++) if (pts[k].distanceToSquared(pts[k + 1]) > 1e-8) path.add(new THREE.LineCurve3(pts[k], pts[k + 1]))
    const g = new THREE.TubeGeometry(path, Math.min(4000, Math.max(8, pts.length * 2)), r, 6, false)
    g.setDrawRange(0, 0)
    const m = new THREE.Mesh(g, mat)
    m.renderOrder = 3
    this.scene.add(m)
    return m
  }

  // ------------------------------------------------------------------ per frame
  private setFrames(w: number) {
    const F = this.data.frames.length
    const f = Math.min(1, Math.max(0, w)) * (F - 1)
    const i0 = Math.floor(f), i1 = Math.min(i0 + 1, F - 1)
    const key = `${i0}:${i1}`
    if (key !== this.frameKey) {
      this.frameKey = key
      const a0 = this.waterGeo.attributes.aD0 as THREE.BufferAttribute, a1 = this.waterGeo.attributes.aD1 as THREE.BufferAttribute
      const pos = this.waterGeo.attributes.position
      const d0 = this.data.frames[i0], d1 = this.data.frames[i1]
      for (let i = 0; i < pos.count; i++) {
        const g = this.gridIndex(pos.getX(i), pos.getZ(i))
        a0.setX(i, d0[g] * this.yU); a1.setX(i, d1[g] * this.yU)
      }
      a0.needsUpdate = true; a1.needsUpdate = true
    }
    this.wU.uMix.value = f - i0
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.fov = w / h < 0.8 ? 52 : 38
    // desktop: shift the scene right so the text column on the left stays clear
    if (w >= 720) this.camera.setViewOffset(w, h, -w * 0.16, 0, w, h)
    else this.camera.clearViewOffset()
    this.camera.updateProjectionMatrix()
  }

  render(st: StoryState, t: number) {
    const cam = this.camera
    cam.position.set(st.px, st.py, st.pz)
    this.look.set(st.tx, st.ty, st.tz)
    cam.lookAt(this.look)
    const dist = cam.position.distanceTo(this.look)
    const fog = this.scene.fog as THREE.Fog
    fog.near = dist * 0.85; fog.far = dist * 2.8
    this.wU.uFogNear.value = fog.near; this.wU.uFogFar.value = fog.far
    this.setFrames(st.water)
    this.wU.uShow.value = st.show
    this.wU.uTime.value = t
    ;(this.wU.uCam.value as THREE.Vector3).copy(cam.position)
    this.rU.uTime.value = t
    this.rU.uRain.value = st.rain
    ;(this.rU.uCenter.value as THREE.Vector3).set(st.tx, st.ty, st.tz)
    const ringN = 36
    const total = this.safeTube.geometry.index!.count
    this.safeTube.geometry.setDrawRange(0, Math.floor(total * st.route / ringN) * ringN)
    if (this.usualTube) {
      const u = this.usualTube.geometry.index!.count
      this.usualTube.geometry.setDrawRange(0, Math.floor(u * Math.min(1, st.route * 3) / ringN) * ringN)
    }
    const arrive = smooth(0.92, 1, st.route)
    ;(this.ring.material as THREE.MeshBasicMaterial).opacity = arrive
    ;(this.beam.material as THREE.MeshBasicMaterial).opacity = arrive * 0.35
    this.ring.scale.setScalar(1 + 0.08 * Math.sin(t * 2.4))
    const mark = st.mark * (1 - st.route * 0.5)
    ;(this.pin.material as THREE.MeshBasicMaterial).opacity = mark
    ;(this.streetTube.material as THREE.MeshBasicMaterial).opacity = mark * 0.7
    this.renderer.render(this.scene, cam)
  }

  dispose() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose()
    })
    this.renderer.dispose()
  }
}
