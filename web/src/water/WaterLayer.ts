// three.js custom layer for MapLibre: one water plane draped over the terrain, coloured by
// depth. Rain lives on its own overlay canvas (RainOverlay). The browser only blends precomputed textures.
import * as THREE from 'three'
import { LngLat, MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MLMap } from 'maplibre-gl'
import { TOKENS, prefersReducedMotion } from '../config'
import type { WaterMeta } from '../lib/data'
import { RainOverlay } from './RainOverlay'
import { waterFrag, waterVert } from './shaders'

const R = 20037508.342789244
const JUNCTIONS: [number, number][] = [
  [80.2054, 13.0067], [80.2185, 12.9815], [80.2206, 13.0105], [80.2234, 13.0213], [80.2337, 13.0400],
  [80.1946, 13.0694], [80.2124, 13.0500], [80.2574, 13.0067], [80.2489, 12.9890], [80.2440, 13.0050],
  [80.1170, 12.9246], [80.2101, 13.0850],
]

export interface WaterFrame { data: Uint8Array; width: number; height: number }

export class WaterLayer implements CustomLayerInterface {
  id = 'flood-water'
  type = 'custom' as const
  renderingMode = '3d' as const

  private map!: MLMap
  private renderer!: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.Camera()
  private water!: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  private rain: RainOverlay | null = null
  private texA!: THREE.DataTexture
  private texB!: THREE.DataTexture
  private bufA: Uint8Array
  private bufB: Uint8Array
  private anim: { from: number; to: number; t0: number; ms: number; key: 'mixT' | 'rise' }[] = []
  private t0 = performance.now()
  private lowPower = false
  terrainExag = 1.0
  private meta: WaterMeta
  private elev: Float32Array
  private sea: Uint8Array

  constructor(meta: WaterMeta, elev: Float32Array, sea: Uint8Array) {
    this.meta = meta
    this.elev = elev
    this.sea = sea
    this.bufA = new Uint8Array(meta.width * meta.height)
    this.bufB = new Uint8Array(meta.width * meta.height)
  }

  onAdd(map: MLMap, gl: WebGL2RenderingContext) {
    this.map = map
    // software rasterisers (SwiftShader, llvmpipe): coarser mesh, no idle animation
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const rname = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    this.lowPower = /swiftshader|llvmpipe|software|softpipe/i.test(rname) || new URLSearchParams(location.search).has('lowgpu')
    const { width: W, height: H, bbox_mercator: [l, b, r, t] } = this.meta
    const x0 = (l + R) / (2 * R), x1 = (r + R) / (2 * R)
    const yTop = (R - t) / (2 * R), yBot = (R - b) / (2 * R)
    const center = new LngLat((this.meta.bbox_lonlat[0] + this.meta.bbox_lonlat[2]) / 2,
      (this.meta.bbox_lonlat[1] + this.meta.bbox_lonlat[3]) / 2)
    const zPerMeter = MercatorCoordinate.fromLngLat(center).meterInMercatorCoordinateUnits()

    const mk = (buf: Uint8Array) => {
      const tex = new THREE.DataTexture(buf, W, H, THREE.RedFormat, THREE.UnsignedByteType)
      tex.magFilter = THREE.LinearFilter
      tex.minFilter = THREE.LinearFilter
      tex.needsUpdate = true
      return tex
    }
    this.texA = mk(this.bufA)
    this.texB = mk(this.bufB)
    const seaTex = new THREE.DataTexture(this.sea, W, H, THREE.RedFormat, THREE.UnsignedByteType)
    seaTex.needsUpdate = true
    const elevTex = new THREE.DataTexture(this.elev, W, H, THREE.RedFormat, THREE.FloatType)
    elevTex.magFilter = THREE.NearestFilter
    elevTex.minFilter = THREE.NearestFilter
    elevTex.needsUpdate = true

    // grid mesh: x east 0..1, y south 0..1 (uv.y = 0 at the north edge = texture row 0)
    const step = this.lowPower ? 6 : 3   // ~135k vertices: plenty for 30 m data
    const sx = Math.round(W / step), sy = Math.round(H / step)
    const pos = new Float32Array((sx + 1) * (sy + 1) * 3)
    const uv = new Float32Array((sx + 1) * (sy + 1) * 2)
    let k = 0
    for (let j = 0; j <= sy; j++) for (let i = 0; i <= sx; i++, k++) {
      pos[3 * k] = i / sx; pos[3 * k + 1] = j / sy
      uv[2 * k] = i / sx; uv[2 * k + 1] = j / sy
    }
    const idx = new Uint32Array(sx * sy * 6)
    k = 0
    for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
      const a = j * (sx + 1) + i, b2 = a + 1, c = a + sx + 1, d = c + 1
      idx.set([a, c, b2, b2, c, d], k); k += 6
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(new THREE.BufferAttribute(idx, 1))

    const lights = JUNCTIONS.map(([lon, lat]) => {
      const m = MercatorCoordinate.fromLngLat([lon, lat])
      return new THREE.Vector2((m.x - x0) / (x1 - x0), (m.y - yTop) / (yBot - yTop))
    })
    const mat = new THREE.ShaderMaterial({
      vertexShader: waterVert, fragmentShader: waterFrag, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        elevTex: { value: elevTex }, seaTex: { value: seaTex }, depthA: { value: this.texA }, depthB: { value: this.texB },
        mixT: { value: 1 }, rise: { value: 1 }, zPerMeter: { value: zPerMeter },
        terrainExag: { value: this.terrainExag }, depthExag: { value: 1.5 }, time: { value: 0 },
        shallow: { value: new THREE.Color(TOKENS.shallow) }, deep: { value: new THREE.Color(TOKENS.deep) },
        amber: { value: new THREE.Color(TOKENS.amber) }, camPos: { value: new THREE.Vector3() },
        lights: { value: lights }, opacity: { value: 1 }, minDepth: { value: 0.04 },
        detail: { value: 0 }, texSize: { value: new THREE.Vector2(W, H) },
      },
    })
    this.water = new THREE.Mesh(geo, mat)
    this.water.matrixAutoUpdate = false
    this.water.matrix.makeTranslation(x0, yTop, 0).multiply(new THREE.Matrix4().makeScale(x1 - x0, yBot - yTop, 1))
    this.water.frustumCulled = false
    this.scene.add(this.water)

    // rain on its own canvas, so a still map does not redraw (none on software renderers)
    if (!this.lowPower) this.rain = new RainOverlay(map)

    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true })
    this.renderer.autoClear = false
  }

  /** Cross-fade to a new depth frame (cm, 8-bit). */
  showFrame(frame: Uint8Array, ms = 600) {
    if (!this.water) return
    const u = this.water.material.uniforms
    // current visible state -> A
    const t = u.mixT.value as number
    if (t >= 0.999) this.bufA.set(this.bufB)
    else if (t > 0.001) for (let i = 0; i < this.bufA.length; i++) this.bufA[i] = this.bufA[i] + (this.bufB[i] - this.bufA[i]) * t
    this.bufB.set(frame)
    this.texA.needsUpdate = true
    this.texB.needsUpdate = true
    u.mixT.value = 0
    this.animate('mixT', 0, 1, ms)
  }

  setRise(to: number, ms = 0) {
    if (!this.water) return
    if (ms <= 0) { this.water.material.uniforms.rise.value = to; this.map?.triggerRepaint(); return }
    this.animate('rise', this.water.material.uniforms.rise.value, to, ms)
  }

  setRain(level: number) { this.rain?.setLevel(prefersReducedMotion() ? 0 : level) }
  setOpacity(o: number) { if (!this.water) return; this.water.material.uniforms.opacity.value = o; this.map?.triggerRepaint() }
  setTerrainExag(e: number) { this.terrainExag = e; if (this.water) this.water.material.uniforms.terrainExag.value = e }

  private animate(key: 'mixT' | 'rise', from: number, to: number, ms: number) {
    this.anim = this.anim.filter((a) => a.key !== key)
    this.anim.push({ key, from, to, t0: performance.now(), ms })
    this.map?.triggerRepaint()
  }

  renders = 0
  render(_gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    this.renders++
    const u = this.water.material.uniforms
    const now = performance.now()
    this.anim = this.anim.filter((a) => {
      const p = Math.min(1, (now - a.t0) / a.ms)
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
      u[a.key].value = a.from + (a.to - a.from) * e
      return p < 1
    })
    const time = (now - this.t0) / 1000
    u.time.value = time
    // camera position in mercator units (internal transform API; fresnel only)
    const cp = (this.map as unknown as { transform?: { cameraPosition?: ArrayLike<number> } }).transform?.cameraPosition
    if (cp) u.camPos.value.set(cp[0], cp[1], cp[2])

    const zoom = this.map.getZoom()
    u.minDepth.value = 0.04 + 0.11 * Math.min(1, Math.max(0, (14 - zoom) / 1.0))
    u.detail.value = Math.min(1, Math.max(0, (zoom - 13.2) / 0.8))

    // mainMatrix maps web-mercator 0..1 coordinates (z conformal) to clip space
    const mm = args.defaultProjectionData.mainMatrix as unknown as number[]
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(mm)
    this.rain?.setMatrix(mm)
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert()
    this.renderer.resetState()
    this.renderer.render(this.scene, this.camera)
    // render on demand: repaint again only while the water rises or cross-fades; a still map costs nothing
    if (this.anim.length) this.map.triggerRepaint()
  }

  onRemove() {
    this.rain?.dispose()
    this.rain = null
  }
}
