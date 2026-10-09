import type * as GeoJSON from 'geojson'
// Imperative wrapper around MapLibre: basemap, terrain, 3D buildings, water layer, overlays,
// and the depth-frame controller (fetch hourly textures, blend runs, cross-fade).
import { Map as MLMap, Marker, Popup, addProtocol, setWorkerUrl, type FlyToOptions, type GeoJSONSource, type LngLatLike } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TOKENS, VELACHERY, prefersReducedMotion } from '../config'
import { loadGray, loadPixels, loadWaterMeta, type WaterMeta } from '../lib/data'
import { blendedFrame } from '../lib/frames'
import type { MixPart } from '../lib/scenario'
import { WaterLayer } from '../water/WaterLayer'
import { baseStyle } from './style'

let protocolAdded = false
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/** The hero camera: close enough to read streets, pitched to show the city in 3D. */
const STREET_VIEW = { zoom: 15.2, pitch: 62, bearing: -18 }
/** Keep the street in the open part of the map, clear of the answer card and the timeline. */
const viewPadding = () => (window.innerWidth > 900
  ? { left: 380, top: 0, right: 0, bottom: 120 }
  : { left: 0, top: 0, right: 0, bottom: Math.round(window.innerHeight * 0.45) })

export class MapView {
  map: MLMap
  water: WaterLayer | null = null
  meta: WaterMeta | null = null
  ready: Promise<void>
  private frameToken = 0

  constructor(container: HTMLElement) {
    if (!protocolAdded) {
      setWorkerUrl(workerUrl)
      addProtocol('pmtiles', new Protocol().tile)
      protocolAdded = true
    }
    this.map = new MLMap({
      container,
      style: baseStyle(),
      center: [80.40, 12.95],   // low over the Bay of Bengal, looking back at the coast
      zoom: 10.6,
      pitch: 55,
      bearing: -60,
      maxPitch: 75,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),   // HiDPI at full scale costs 2-4x fill rate
    })
    ;(window as unknown as { __map: MLMap; __mv: MapView }).__map = this.map
    ;(window as unknown as { __mv: MapView }).__mv = this
    this.ready = new Promise((resolve) => {
      this.map.on('load', async () => {
        this.map.setTerrain({ source: 'terrain', exaggeration: 1.5 })
        const meta = await loadWaterMeta()
        this.meta = meta
        const ev = await loadPixels('water/elev.png')
        const elev = new Float32Array(meta.width * meta.height)
        for (let i = 0; i < elev.length; i++) elev[i] = (ev.data[4 * i] * 256 + ev.data[4 * i + 1]) / 100 - 10
        // the sea is never floodwater (also masked in the export; this keeps old exports honest too)
        const sea = await loadGray('water/sea.png').catch(() => new Uint8Array(meta.width * meta.height))
        if (this.map.getLayer('flood-water')) return resolve()
        this.water = new WaterLayer(meta, elev, sea)
        this.water.setTerrainExag(1.5)
        this.map.addLayer(this.water, 'buildings-3d')
        this.addOverlays()
        resolve()
      })
    })
  }

  private addOverlays() {
    const m = this.map
    for (const id of ['route-normal', 'route-safe', 'street', 'proof-crowd', 'hospitals', 'parking', 'here']) {
      m.addSource(id, { type: 'geojson', data: EMPTY })
    }
    m.addLayer({ id: 'proof-crowd', type: 'line', source: 'proof-crowd', layout: { visibility: 'none', 'line-cap': 'round' },
      paint: { 'line-color': TOKENS.rainGrey, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 3], 'line-opacity': 0.85 } })
    m.addLayer({ id: 'route-normal', type: 'line', source: 'route-normal', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#7C8C93', 'line-width': 4, 'line-opacity': 0.55, 'line-dasharray': [1.5, 1.5] } })
    m.addLayer({ id: 'route-safe', type: 'line', source: 'route-safe', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': TOKENS.amber, 'line-width': 5, 'line-opacity': 0.95 } })
    m.addLayer({ id: 'street', type: 'line', source: 'street', layout: { 'line-cap': 'round' },
      paint: { 'line-color': TOKENS.rainGrey, 'line-width': 6, 'line-opacity': 0.9, 'line-blur': 1 } })
    m.addLayer({ id: 'hospitals', type: 'circle', source: 'hospitals',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['==', ['get', 'reach'], 1], 2.5, 6], 15, ['case', ['==', ['get', 'reach'], 1], 5, 10]],
        'circle-color': ['case', ['==', ['get', 'reach'], 1], TOKENS.rainGrey, 'rgba(0,0,0,0)'],
        'circle-stroke-color': ['case', ['==', ['get', 'reach'], 1], TOKENS.stormSky, '#ffffff'],
        'circle-stroke-width': ['case', ['==', ['get', 'reach'], 1], 1, 2.5] } })
    m.addLayer({ id: 'hospitals-label', type: 'symbol', source: 'hospitals', filter: ['==', ['get', 'reach'], 0],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-max-width': 12 },
      paint: { 'text-color': '#ffffff', 'text-halo-color': TOKENS.stormSky, 'text-halo-width': 1.5 } })
    m.addLayer({ id: 'parking', type: 'circle', source: 'parking',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 9], 'circle-color': TOKENS.amber,
        'circle-stroke-color': TOKENS.stormSky, 'circle-stroke-width': 2 } })
    m.addLayer({ id: 'parking-label', type: 'symbol', source: 'parking', minzoom: 13,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
      paint: { 'text-color': TOKENS.amber, 'text-halo-color': TOKENS.stormSky, 'text-halo-width': 1.5 } })
    m.addLayer({ id: 'here', type: 'circle', source: 'here',
      paint: { 'circle-radius': 9, 'circle-color': TOKENS.stormSky, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3.5 } })
  }

  /** A small card where you tapped: that street's depth, and a way to make it yours. */
  private peekPopup: Popup | null = null
  peek(at: [number, number], info: { name: string; feel: string; cm: number; from: string | null }, onPick: () => void) {
    this.peekPopup?.remove()
    const el = document.createElement('div')
    el.className = 'peek'
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
    el.innerHTML = `<div class="peek-name">${esc(info.name)}</div>
      <div class="peek-feel">${esc(info.feel)}<span> · ${info.cm} cm at its worst</span></div>
      ${info.from ? `<div class="peek-when">Too deep for scooters from ${esc(info.from)}</div>` : ''}
      <button class="btn small-btn">Make this my street</button>`
    el.querySelector('button')!.addEventListener('click', () => { this.peekPopup?.remove(); onPick() })
    this.peekPopup = new Popup({ closeButton: false, offset: 12, maxWidth: '260px', className: 'peek-popup' })
      .setLngLat(at).setDOMContent(el).addTo(this.map)
  }
  clearPeek() { this.peekPopup?.remove(); this.peekPopup = null }

  /** Rings that spread from the point you just landed on. */
  pulse(at: [number, number]) {
    if (prefersReducedMotion()) return
    const el = document.createElement('div')
    el.className = 'landing-pulse'
    el.innerHTML = '<i></i><i></i><i></i>'
    const m = new Marker({ element: el }).setLngLat(at).addTo(this.map)
    window.setTimeout(() => m.remove(), 3600)
  }

  /** After landing, the camera drifts round the street once, slowly, so the city reads in 3D.
   *  Any drag, zoom or click stops it (MapLibre ends camera animations on interaction). */
  settleOrbit(deg = 24, ms = 9000) {
    if (prefersReducedMotion()) return
    const go = () => this.map.easeTo({ bearing: this.map.getBearing() + deg, duration: ms,
      easing: (t) => 0.5 - Math.cos(Math.PI * t) / 2, essential: false })
    if (this.map.isMoving()) this.map.once('moveend', go)
    else go()
  }

  /** Draws a line in from its start over `ms` (the safe route "travels" to the dry place). */
  private drawToken = 0
  drawLine(id: string, coords: [number, number][] | null, ms = 1300) {
    const token = ++this.drawToken
    if (!coords || coords.length < 2 || prefersReducedMotion()) {
      this.setGeoJSON(id, coords ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } : null)
      return
    }
    // cumulative length so the line grows at a steady speed
    const cum = [0]
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]))
    const total = cum[cum.length - 1] || 1
    const t0 = performance.now()
    const step = (t: number) => {
      if (token !== this.drawToken) return
      const p = Math.min(1, (t - t0) / ms)
      const target = total * (1 - Math.pow(1 - p, 2))
      let k = cum.findIndex((c) => c >= target)
      if (k < 1) k = 1
      const f = (target - cum[k - 1]) / Math.max(cum[k] - cum[k - 1], 1e-12)
      const tip: [number, number] = [coords[k - 1][0] + (coords[k][0] - coords[k - 1][0]) * f, coords[k - 1][1] + (coords[k][1] - coords[k - 1][1]) * f]
      this.setGeoJSON(id, { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...coords.slice(0, k), tip] } })
      if (p < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  setGeoJSON(id: string, data: GeoJSON.FeatureCollection | GeoJSON.Feature | null) {
    const s = this.map.getSource(id) as GeoJSONSource | undefined
    s?.setData(data ?? EMPTY)
  }

  setVisible(id: string, on: boolean) {
    if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  }

  /** Blend one hour (or 'max') of several runs into a single frame and cross-fade to it. */
  async showMix(mix: MixPart[], hour: number | 'max', ms = 700) {
    if (!this.water || !this.meta) return
    const token = ++this.frameToken
    const frame = await blendedFrame(mix, hour, this.meta.width * this.meta.height)
    if (token !== this.frameToken) return
    // a run that has not been computed shows no water rather than a made-up blend
    this.water.showFrame(frame ?? new Uint8Array(this.meta.width * this.meta.height), prefersReducedMotion() ? 0 : ms)
  }

  /** Preload hourly frames for a mix, nearest hours first, one at a time in idle time. */
  private preloadToken = 0
  preload(mix: MixPart[], hours: number, around = 1) {
    const token = ++this.preloadToken
    const order = Array.from({ length: hours }, (_, i) => i + 1).sort((a, b) => Math.abs(a - around) - Math.abs(b - around))
    const idle = (cb: () => void) => ('requestIdleCallback' in window
      ? (window as unknown as { requestIdleCallback: (f: () => void, o?: object) => void }).requestIdleCallback(cb, { timeout: 500 })
      : setTimeout(cb, 60))
    const next = (k: number) => {
      if (token !== this.preloadToken || k >= order.length) return
      idle(() => {
        Promise.all(mix.map(({ run }) => loadGray(`water/${run}/h${String(order[k]).padStart(2, '0')}.png`).catch(() => null)))
          .then(() => next(k + 1))
      })
    }
    next(0)
  }

  flyTo(center: LngLatLike, opts: Partial<FlyToOptions> = {}) {
    const reduced = prefersReducedMotion()
    // a high arc between places: you see the city pass underneath, then come down on the street
    this.map.flyTo({ center, ...STREET_VIEW, padding: viewPadding(), duration: reduced ? 0 : 3800, curve: 1.6, essential: true, ...opts,
      ...(reduced ? { duration: 0 } : {}) })
    return new Promise<void>((res) => {
      if (reduced) return res()
      this.map.once('moveend', () => res())
    })
  }

  /** Wide view for the storm time-lapse: looking north-west from Pallikaranai over Velachery to the upper Adyar,
   *  where the corrected 2015 run floods land that rain alone does not. */
  showWide() {
    const reduced = prefersReducedMotion()
    this.map.easeTo({ center: [80.185, 12.975], zoom: 12.9, pitch: 60, bearing: -40, duration: reduced ? 0 : 2200,
      padding: viewPadding(), essential: true })
    return new Promise<void>((res) => { if (reduced) res(); else this.map.once('moveend', () => res()) })
  }

  /** True when the camera already shows this point at street view (no second flight needed). */
  isFraming(p: [number, number]) {
    if (this.flightTarget) {
      const [lon, lat] = this.flightTarget
      return Math.hypot((lon - p[0]) * 108_500, (lat - p[1]) * 110_500) < 80
    }
    const c = this.map.getCenter()
    const dx = (c.lng - p[0]) * 108_500, dy = (c.lat - p[1]) * 110_500
    return Math.hypot(dx, dy) < 80 && Math.abs(this.map.getZoom() - STREET_VIEW.zoom) < 0.3 && !this.map.isMoving()
  }

  /** The one orchestrated moment: high over the Bay of Bengal, descend to Velachery. */
  /** Where the camera is flying to, until it lands (lets Tonight skip a second flight). */
  private flightTarget: [number, number] | null = null

  async openingSequence() {
    if (prefersReducedMotion()) {
      this.map.jumpTo({ center: VELACHERY, ...STREET_VIEW, padding: viewPadding() })
      return
    }
    await new Promise((r) => setTimeout(r, 300))
    // land on the street view itself, so the hero flow needs no second flight
    const duration = 5000
    this.flightTarget = VELACHERY
    this.map.flyTo({ center: VELACHERY, ...STREET_VIEW, padding: viewPadding(), duration, curve: 1.2, essential: true })
    this.map.once('moveend', () => { this.flightTarget = null })
    // hand over 2 s before landing: the night starts playing while the camera settles
    await new Promise((r) => setTimeout(r, duration - 2000))
  }


}
