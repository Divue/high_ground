import type * as GeoJSON from 'geojson'
// Imperative wrapper around MapLibre: basemap, terrain, 3D buildings, water layer, overlays,
// and the depth-frame controller (fetch hourly textures, blend runs, cross-fade).
import { Map as MLMap, addProtocol, type FlyToOptions, type GeoJSONSource, type LngLatLike } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TOKENS, VELACHERY, prefersReducedMotion } from '../config'
import { loadPixels, loadWaterMeta, type WaterMeta } from '../lib/data'
import type { MixPart } from '../lib/scenario'
import { WaterLayer } from '../water/WaterLayer'
import { baseStyle } from './style'

let protocolAdded = false
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export class MapView {
  map: MLMap
  water: WaterLayer | null = null
  meta: WaterMeta | null = null
  ready: Promise<void>
  private frameToken = 0

  constructor(container: HTMLElement) {
    if (!protocolAdded) {
      addProtocol('pmtiles', new Protocol().tile)
      protocolAdded = true
    }
    this.map = new MLMap({
      container,
      style: baseStyle(),
      center: [80.62, 12.86],   // over the Bay of Bengal
      zoom: 9.2,
      pitch: 20,
      bearing: -12,
      maxPitch: 75,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
    })
    ;(window as unknown as { __map: MLMap }).__map = this.map
    this.ready = new Promise((resolve) => {
      this.map.on('load', async () => {
        this.map.setTerrain({ source: 'terrain', exaggeration: 1.5 })
        const meta = await loadWaterMeta()
        this.meta = meta
        const ev = await loadPixels('water/elev.png')
        const elev = new Float32Array(meta.width * meta.height)
        for (let i = 0; i < elev.length; i++) elev[i] = (ev.data[4 * i] * 256 + ev.data[4 * i + 1]) / 100 - 10
        this.water = new WaterLayer(meta, elev)
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
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 7],
        'circle-color': ['case', ['==', ['get', 'reach'], 1], TOKENS.rainGrey, '#4A5A60'],
        'circle-stroke-color': TOKENS.stormSky, 'circle-stroke-width': 1.5,
        'circle-opacity': ['case', ['==', ['get', 'reach'], 1], 1, 0.55] } })
    m.addLayer({ id: 'parking', type: 'circle', source: 'parking',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 9], 'circle-color': TOKENS.amber,
        'circle-stroke-color': TOKENS.stormSky, 'circle-stroke-width': 2 } })
    m.addLayer({ id: 'parking-label', type: 'symbol', source: 'parking', minzoom: 13,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
      paint: { 'text-color': TOKENS.amber, 'text-halo-color': TOKENS.stormSky, 'text-halo-width': 1.5 } })
    m.addLayer({ id: 'here', type: 'circle', source: 'here',
      paint: { 'circle-radius': 7, 'circle-color': TOKENS.rainGrey, 'circle-stroke-color': TOKENS.stormSky, 'circle-stroke-width': 3 } })
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
    const n = this.meta.width * this.meta.height
    const out = new Uint8Array(n)
    if (mix.length) {
      const frames = await Promise.all(mix.map(async ({ run }) => {
        const name = hour === 'max' ? 'max' : `h${String(Math.max(1, hour)).padStart(2, '0')}`
        try { return await loadPixels(`water/${run}/${name}.png`) } catch { return null }
      }))
      if (token !== this.frameToken) return
      const acc = new Float32Array(n)
      frames.forEach((f, k) => {
        if (!f) return
        const w = mix[k].w
        for (let i = 0; i < n; i++) acc[i] += w * f.data[4 * i]
      })
      for (let i = 0; i < n; i++) out[i] = acc[i]
    }
    this.water.showFrame(out, prefersReducedMotion() ? 0 : ms)
  }

  /** Preload hourly frames for a mix so scrubbing is instant. */
  preload(mix: MixPart[], hours: number) {
    for (const { run } of mix) for (let h = 1; h <= hours; h++) loadPixels(`water/${run}/h${String(h).padStart(2, '0')}.png`).catch(() => {})
  }

  flyTo(center: LngLatLike, opts: Partial<FlyToOptions> = {}) {
    const reduced = prefersReducedMotion()
    this.map.flyTo({ center, zoom: 15.2, pitch: 62, bearing: -18, duration: reduced ? 0 : 3200, essential: true, ...opts,
      ...(reduced ? { duration: 0 } : {}) })
    return new Promise<void>((res) => {
      if (reduced) return res()
      this.map.once('moveend', () => res())
    })
  }

  /** The one orchestrated moment: high over the Bay of Bengal, descend to Velachery. */
  async openingSequence() {
    if (prefersReducedMotion()) {
      this.map.jumpTo({ center: VELACHERY, zoom: 14.2, pitch: 60, bearing: -18 })
      return
    }
    await new Promise((r) => setTimeout(r, 400))
    this.map.flyTo({ center: VELACHERY, zoom: 14.2, pitch: 60, bearing: -18, duration: 7000, curve: 1.3, essential: true })
    await new Promise<void>((r) => this.map.once('moveend', () => r()))
  }
}
