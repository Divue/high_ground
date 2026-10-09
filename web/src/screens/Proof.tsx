import { Map as MLMap } from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import { useEffect, useRef, useState } from 'react'
import { getJSON } from '../lib/data'
import type { MapView } from '../map/MapView'
import { baseStyle } from '../map/style'
import { DATA_BASE, TOKENS } from '../config'

interface M { hit_rate: number; false_rate: number; skill: number; lift: number | null; reported_segments: number; unreported_segments: number; matched_baseline_hit_rate?: number; gain?: number; flooded_share?: number }
interface ProofJ {
  headline: { model_hit_rate: number; baseline_hit_rate: number; model_false_rate: number; baseline_false_rate: number;
    matched_baseline_hit_rate: number; matched_baseline_false_rate: number; model_flooded_share_of_city: number; reported_segments: number }
  sentence: string
  metric_note?: string
  calibration_note?: string | null
  split: { value_mm_h: number; candidates: { drainage_mm_h: number; hit_rate: number; false_rate: number; skill: number; gain?: number; matched_baseline_hit_rate?: number }[] }
  by_group: Record<'rain_only' | 'rain_plus_reservoir', Record<'all' | 'rain_driven' | 'river_driven', M>>
  baseline: { rule: string; metrics: Record<string, M> }
  zones: Record<string, { share_in_moderate_high_veryhigh: number; city_share_moderate_or_higher: number }>
  nrsc_2015: Record<string, { csi: number; hit: number }>
  anuga: null | { cell_agreement: number; csi: number; depth_corr: number; anuga_wet_share: number; fast_wet_share: number; triangles: number; note: string }
  caveats: string[]
  thresholds: { hit_depth_cm: number; hit_length_share: number; river_buffer_m: number }
}

const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)}%`)

export default function Proof({ mv }: { mv: MapView }) {
  const [p, setP] = useState<ProofJ | null>(null)
  const [split, setSplit] = useState(0.5)
  const [detail, setDetail] = useState<null | 'anuga' | 'fast'>(null)
  const right = useRef<HTMLDivElement>(null)
  const rmap = useRef<MLMap | null>(null)

  useEffect(() => { getJSON<ProofJ>('proof.json').then(setP).catch(() => setP(null)) }, [])

  useEffect(() => {
    mv.map.easeTo({ center: [80.215, 13.02], zoom: 11.6, pitch: 0, bearing: 0, duration: 1200 })
    mv.showMix([{ run: 'dec2015_reservoir', w: 1 }], 'max', 500)
    mv.water?.setRain(0)
    const style = baseStyle()
    delete (style as { terrain?: unknown }).terrain
    style.layers = style.layers.filter((l) => l.id !== 'buildings-3d')
    const m = new MLMap({ container: right.current!, style, interactive: false, attributionControl: false,
      center: mv.map.getCenter(), zoom: mv.map.getZoom(), pitch: 0, bearing: 0 })
    rmap.current = m
    m.on('load', async () => {
      const gj = await getJSON<GeoJSON.FeatureCollection>('proof/crowd_2015.geojson').catch(() => null)
      if (!gj) return
      m.addSource('crowd', { type: 'geojson', data: gj })
      m.addLayer({ id: 'crowd', type: 'line', source: 'crowd', layout: { 'line-cap': 'round' },
        paint: { 'line-color': TOKENS.rainGrey, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 4], 'line-opacity': 0.9 } })
    })
    const sync = () => m.jumpTo({ center: mv.map.getCenter(), zoom: mv.map.getZoom(), bearing: mv.map.getBearing(), pitch: mv.map.getPitch() })
    mv.map.on('move', sync)
    return () => { mv.map.off('move', sync); m.remove() }
  }, [mv])

  // ANUGA detail view: the Velachery box, peak depth from both models with identical styling
  useEffect(() => {
    const m = mv.map
    const clear = () => { if (m.getLayer('detail')) m.removeLayer('detail'); if (m.getSource('detail')) m.removeSource('detail') }
    if (!detail) {
      clear()
      mv.water?.setOpacity(1)
      return
    }
    let dead = false
    getJSON<{ coordinates: [number, number][] }>('proof/anuga_200mm.json').then((meta) => {
      if (dead) return
      clear()
      const url = new URL(`${DATA_BASE}/proof/${detail === 'anuga' ? 'anuga' : 'fast'}_200mm.png`, window.location.href).href
      m.addSource('detail', { type: 'image', url, coordinates: meta.coordinates as [[number, number], [number, number], [number, number], [number, number]] })
      m.addLayer({ id: 'detail', type: 'raster', source: 'detail', paint: { 'raster-opacity': 0.95, 'raster-fade-duration': 0 } }, 'buildings-3d')
      mv.water?.setOpacity(0)
      const lons = meta.coordinates.map((c) => c[0]), lats = meta.coordinates.map((c) => c[1])
      m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 80, pitch: 0, duration: 1200 })
    }).catch(() => setDetail(null))
    return () => { dead = true }
  }, [detail, mv])
  useEffect(() => () => {
    const m = mv.map
    if (m.getLayer('detail')) m.removeLayer('detail')
    if (m.getSource('detail')) m.removeSource('detail')
    mv.water?.setOpacity(1)
  }, [mv])

  const drag = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => setSplit(Math.max(0.05, Math.min(0.95, ev.clientX / window.innerWidth)))
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const h = p?.headline
  const g = p?.by_group
  return (
    <>
      <div ref={right} style={{ position: 'absolute', inset: 0, zIndex: 2, clipPath: `inset(0 0 0 ${detail ? 100 : split * 100}%)` }} />
      {!detail && <div className="proof-handle" style={{ left: `calc(${split * 100}% - 1px)` }} onPointerDown={drag}
        role="slider" aria-label="Swipe between model and citizen reports" aria-valuenow={Math.round(split * 100)} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft') setSplit((s) => Math.max(0.05, s - 0.05)); if (e.key === 'ArrowRight') setSplit((s) => Math.min(0.95, s + 0.05)) }} />}
      {!detail && <div className="proof-label" style={{ left: 20 }}>Model: 1–2 Dec 2015 replay</div>}
      {!detail && <div className="proof-label" style={{ right: 20 }}>Streets residents reported flooded in 2015</div>}
      {detail && <div className="proof-label" style={{ left: 20 }}>{detail === 'anuga' ? 'ANUGA' : 'Fast model'}: peak depth, 200 mm storm, Velachery and Pallikaranai</div>}

      {p && h && g && (
        <>
          <div className="panel proof-center">
            <div className="vs">
              <div>
                <div className="hit">{pct(h.model_hit_rate)}</div>
                <div className="hit-sub">of reported flooded streets<br />the model floods</div>
              </div>
              <div>
                <div className="base">{pct(h.matched_baseline_hit_rate)}</div>
                <div className="hit-sub">elevation alone,<br />same area flooded</div>
              </div>
              <div>
                <div className="base">{pct(h.baseline_hit_rate)}</div>
                <div className="hit-sub">lowest 20%<br />of the city</div>
              </div>
            </div>
            <p style={{ margin: '12px 0 4px' }}>{p.sentence}</p>
            {p.calibration_note && <p className="muted small" style={{ margin: '0 0 4px' }}>{p.calibration_note}</p>}
            <p className="muted small" style={{ margin: 0 }}>
              Scored only on the {h.reported_segments} reported street segments in the other half. {p.metric_note}
            </p>
          </div>
          <div className="panel proof-bottom">
            <h3 style={{ marginTop: 0 }}>Where rain modelling works, and why the reservoir mattered</h3>
            <table className="proof-table">
              <thead><tr><th></th><th>All reported streets</th><th>Rain-driven</th><th>River-driven (≤{p.thresholds.river_buffer_m} m from Adyar or Cooum)</th></tr></thead>
              <tbody>
                <tr><td>Rain only</td>{(['all', 'rain_driven', 'river_driven'] as const).map((k) => <td key={k}>{pct(g.rain_only[k].hit_rate)} <span className="muted">({g.rain_only[k].reported_segments})</span></td>)}</tr>
                <tr><td>Rain + Chembarambakkam release</td>{(['all', 'rain_driven', 'river_driven'] as const).map((k) => <td key={k}>{pct(g.rain_plus_reservoir[k].hit_rate)} <span className="muted">({g.rain_plus_reservoir[k].reported_segments})</span></td>)}</tr>
                <tr><td>Elevation alone, same area (rain + release)</td>{(['all', 'rain_driven', 'river_driven'] as const).map((k) => <td key={k}>{pct(g.rain_plus_reservoir[k].matched_baseline_hit_rate)}</td>)}</tr>
                <tr><td>Lowest 20% of the city</td>{(['all', 'rain_driven', 'river_driven'] as const).map((k) => <td key={k}>{pct(p.baseline.metrics[k]?.hit_rate)}</td>)}</tr>
              </tbody>
            </table>
            <p className="small" style={{ marginTop: 10 }}>
              The model floods {pct(h.model_flooded_share_of_city)} of the city’s land in this replay. Streets nobody reported are not proof of dry streets: the model floods {pct(h.model_false_rate)} of them, and an elevation map of the same size floods {pct(h.matched_baseline_false_rate)}.
            </p>
            <p className="small">
              GCC hazard zones: {pct(p.zones.rain_plus_reservoir?.share_in_moderate_high_veryhigh)} of the model’s flooded area falls in moderate, high or very high zones, which cover {pct(p.zones.rain_plus_reservoir?.city_share_moderate_or_higher)} of the zoned city.
              {p.nrsc_2015.rain_plus_reservoir && <> Satellite (NRSC) 2015 inundation: the model covers {pct(p.nrsc_2015.rain_plus_reservoir.hit)} of it.</>}
            </p>
            {p.anuga && (
              <div className="small">
                <p style={{ margin: '8px 0 6px' }}>Velachery cross-check with ANUGA (Geoscience Australia), {p.anuga.triangles.toLocaleString()} triangles: the two models agree on {pct(p.anuga.cell_agreement)} of cells about whether water passes 15 cm (depth correlation {p.anuga.depth_corr.toFixed(2)}). Same terrain, different numerics.</p>
                <div className="seg" role="group" aria-label="Velachery detail view">
                  <button aria-pressed={!detail} onClick={() => setDetail(null)}>2015 split view</button>
                  <button aria-pressed={detail === 'anuga'} onClick={() => setDetail('anuga')}>Detail: ANUGA</button>
                  <button aria-pressed={detail === 'fast'} onClick={() => setDetail('fast')}>Detail: fast model</button>
                </div>
              </div>
            )}
            <h3>Tuning, on the other half of the wards</h3>
            <p className="small" style={{ margin: 0 }}>
              {p.split.candidates.map((c) => `${c.drainage_mm_h} mm/h: ${pct(c.hit_rate)} vs ${pct(c.matched_baseline_hit_rate)}`).join(' · ')}
              <span className="muted"> (drain capacity: model hit rate vs elevation alone, same area)</span>
            </p>
            <h3>Limits of this test</h3>
            <ul className="small muted" style={{ paddingLeft: 18, margin: 0 }}>{p.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        </>
      )}
      {!p && <div className="panel proof-center"><p className="muted">Validation results are not available yet.</p></div>}
    </>
  )
}
