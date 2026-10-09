// Rain on its own transparent canvas above the map. Animating rain inside the map's
// custom layer forced MapLibre to redraw terrain, buildings and water every frame, which
// kept an integrated GPU ~70% busy on a still map. Here only ~4k streaks redraw; the map
// repaints only when the camera or the water changes.
import * as THREE from 'three'
import { MercatorCoordinate, type Map as MLMap } from 'maplibre-gl'
import { rainFrag, rainVert } from './shaders'

export class RainOverlay {
  private canvas = document.createElement('canvas')
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.Camera()
  private mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  private level = 0
  private target = 0
  private raf = 0
  private t0 = performance.now()
  private hasMatrix = false
  private cleared = true
  private ro: ResizeObserver
  private map: MLMap

  constructor(map: MLMap) {
    this.map = map
    const c = this.canvas
    c.className = 'rain-overlay'
    Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' })
    map.getCanvas().after(c)
    // thin streaks do not need HiDPI
    this.renderer = new THREE.WebGLRenderer({ canvas: c, alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' })
    this.renderer.setPixelRatio(1)
    this.renderer.setClearColor(0x000000, 0)
    const resize = () => this.renderer.setSize(map.getContainer().clientWidth, map.getContainer().clientHeight, false)
    resize()
    this.ro = new ResizeObserver(resize)
    this.ro.observe(map.getContainer())

    const N = 4000
    const quad = new THREE.InstancedBufferGeometry()
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3))
    quad.setIndex([0, 1, 2, 1, 3, 2])
    const off = new Float32Array(N * 3), spd = new Float32Array(N)
    for (let i = 0; i < N; i++) { off[3 * i] = Math.random(); off[3 * i + 1] = Math.random(); off[3 * i + 2] = Math.random(); spd[i] = 0.6 + Math.random() * 0.5 }
    quad.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 3))
    quad.setAttribute('speed', new THREE.InstancedBufferAttribute(spd, 1))
    quad.instanceCount = N
    this.mesh = new THREE.Mesh(quad, new THREE.ShaderMaterial({
      vertexShader: rainVert, fragmentShader: rainFrag, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { time: { value: 0 }, boxSize: { value: 0.001 }, center: { value: new THREE.Vector3() },
        streak: { value: 0.00001 }, opacity: { value: 0 } },
    }))
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  /** Latest map camera (web-mercator 0..1 to clip space), captured in the map's render pass. */
  setMatrix(m: ArrayLike<number>) {
    this.camera.projectionMatrix.fromArray(m as number[])
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert()
    this.hasMatrix = true
  }

  setLevel(level: number) {
    this.target = level
    if (!this.raf) this.raf = requestAnimationFrame(this.tick)
  }

  private tick = () => {
    this.raf = 0
    this.level += (this.target - this.level) * 0.05
    const zoom = this.map.getZoom()
    const opacity = this.level * Math.min(1, Math.max(0, (zoom - 9) / 3))
    if (opacity > 0.01 && this.hasMatrix) {
      const u = this.mesh.material.uniforms
      const c = MercatorCoordinate.fromLngLat(this.map.getCenter())
      const box = 2.2 / Math.pow(2, zoom)
      u.time.value = (performance.now() - this.t0) / 1000
      u.center.value.set(c.x, c.y, 0)
      u.boxSize.value = box
      u.streak.value = box * 0.018
      u.opacity.value = opacity
      this.renderer.render(this.scene, this.camera)
      this.cleared = false
    } else if (!this.cleared) {
      this.renderer.clear()
      this.cleared = true
    }
    // keep running while it rains or is still fading out
    if (this.target > 0.01 || this.level > 0.01) this.raf = requestAnimationFrame(this.tick)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.renderer.dispose()
    this.canvas.remove()
  }
}
