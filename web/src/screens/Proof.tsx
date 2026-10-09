import { Map as MLMap } from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import { useEffect, useRef, useState } from 'react'
import { getJSON } from '../lib/data'
import type { MapView } from '../map/MapView'
import { baseStyle } from '../map/style'
import { DATA_BASE, TOKENS } from '../config'

interface M { hit_rate: number; false_rate: number; skill: number; lift: number | null; reported_segments: number; unreported_segments: number; matched_baseline_hit_rate?: number; gain?: number; flooded_share?: number }
interface Auc { auc: number | null; ci95: [number, number] | null; n_reported: number }
interface ProofJ {
  honest_test?: { question: string; model: Auc; low_elevation: Auc; random: Auc; near_a_channel: Auc; verdict: string; plain: string }
  auc_even_wards?: Record<string, Record<'all' | 'rain_driven' | 'river_driven', Auc>>
  null_maps?: Record<string, M>
  nrsc_matched_share?: Record<'model' | 'elevation_same_share' | 'random_same_share', { csi: number; hit: number }>
  gcc_points_auc?: Record<string, { n: number; model: number; low_elevation: number; near_a_channel: number; random: number }>
  ward_level?: { spearman: number; p: number; wards: number }
  headline: { model_hit_rate: number; baseline_hit_rate: number; model_false_rate: number; baseline_false_rate: number;
    matched_baseline_hit_rate: number; matched_baseline_false_rate: number; model_flooded_share_of_city: number; reported_segments: number }
  sentence: string
  metric_note?: string
  calibration_note?: string | null
  split: { value_mm_h: number; method?: string; why?: string; candidates: { drainage_mm_h: number; auc?: number; ci95?: [number, number]; hit_rate?: number; matched_baseline_hit_rate?: number }[] }
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
    // city on screen below the headline card, centred on the split line
    mv.map.easeTo({ center: [80.225, 13.03], zoom: 11.5, pitch: 0, bearing: 0, padding: { top: 240, bottom: 0, left: 0, right: 0 }, duration: 1200 })
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
      m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: { top: 90, bottom: 190, left: 60, right: 60 }, pitch: 0, duration: 1200 })
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
  const t = p?.honest_test
  const auc = p?.auc_even_wards
  const nr = p?.nrsc_matched_share
  const pts = p?.gcc_points_auc?.['GCC 2015 flood hotspots']
  return (
    <>
      <div ref={right} style={{ position: 'absolute', inset: 0, zIndex: 2, clipPath: `inset(0 0 0 ${detail ? 100 : split * 100}%)` }} />
      {!detail && <div className="proof-handle" style={{ left: `calc(${split * 100}% - 1px)` }} onPointerDown={drag}
        role="slider" aria-label="Swipe between model and citizen reports" aria-valuenow={Math.round(split * 100)} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft') setSplit((s) => Math.max(0.05, s - 0.05)); if (e.key === 'ArrowRight') setSplit((s) => Math.min(0.95, s + 0.05)) }} />}
      {!detail && <div className="proof-label" style={{ left: 20 }}>Model: 1–2 Dec 2015 replay</div>}
      {!detail && <div className="proof-label" style={{ right: 20 }}>Streets residents reported flooded in 2015</div>}
      {detail && <div className="proof-label" style={{ left: 20 }}>{detail === 'anuga' ? 'ANUGA' : 'Fast model'}: peak depth, 200 mm storm, Velachery and Pallikaranai</div>}

      {p && h && g && t && (
        <>
          {!detail && <div className="panel proof-center">
            <p style={{ margin: '0 0 4px', fontFamily: 'var(--head)', fontSize: 17 }}>{t.question}</p>
            {/* all four on one shared scale: nothing is drawn bigger than a baseline that beats it */}
            <div className="strip" aria-label="Ranking test results">
              {([['model', 'the model', t.model.auc], ['chance', 'chance', 0.5], ['elev', 'elevation alone', t.low_elevation.auc], ['chan', 'nearest channel', t.near_a_channel.auc]] as const)
                .map(([k, label, v]) => (
                  <div key={k} className={`mk${k === 'model' ? ' model' : ''}`} style={{ left: `${(((v ?? 0.5) - 0.44) / 0.14) * 100}%` }}>
                    <b>{pct(v)}</b>{label}
                  </div>
                ))}
            </div>
            <p style={{ margin: '12px 0 4px' }}>On wards we never tuned on, the model is <b>{t.verdict}</b>{t.model.ci95 ? ` (95% range ${pct(t.model.ci95[0])}–${pct(t.model.ci95[1])})` : ''}.</p>
            <p className="muted small" style={{ margin: 0 }}>
              The 2015 reports mark where people reported, not every street that flooded, so they can only rank, not score. {p.sentence}
            </p>
          </div>}
          <div className="panel proof-bottom" style={detail ? { width: 620 } : undefined}>
            {!detail && <>
            <details className="tests">
            <summary>Every test we ran, on the {h.reported_segments} reported streets in the held-out wards</summary>
            <table className="proof-table">
              <thead><tr><th>How often a reported street ranks above an unreported one</th><th>All</th><th>Rain-driven</th><th>River-driven (≤{p.thresholds.river_buffer_m} m from Adyar or Cooum)</th></tr></thead>
              <tbody>
                {([['model', 'Model, rain + Chembarambakkam release'], ['model_rain_only', 'Model, rain only'], ['near_a_channel', 'Distance to the nearest channel'], ['low_elevation', 'Elevation alone'], ['random', 'Random']] as const).map(([k, label]) => (
                  <tr key={k}><td>{label}</td>{(['all', 'rain_driven', 'river_driven'] as const).map((gk) => <td key={gk}>{pct(auc?.[k]?.[gk]?.auc)}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {nr && <p className="small" style={{ marginTop: 10 }}>Satellite (NRSC) 2015 flood extent: the model covers {pct(nr.model.hit)} of it, a random map of the same size {pct(nr.random_same_share.hit)}, the lowest ground of the same size {pct(nr.elevation_same_share.hit)}.</p>}
            {pts && <p className="small">GCC’s own 2015 flood hotspots, ranked against random road points: model {pct(pts.model)}, distance to a channel {pct(pts.near_a_channel)}, elevation {pct(pts.low_elevation)}, random {pct(pts.random)}.</p>}
            {p.null_maps && <p className="small muted">Why we do not lead with “share of reported streets flooded”: the model floods {pct(h.model_hit_rate)} of them, but a random speckle of the same size floods {pct(p.null_maps.random_speckle_same_share?.hit_rate)}, because reports are spread wherever people live.</p>}
            </details>
            </>}
            {!detail && <details className="tests">
            <summary>Drain capacity and the limits of this test</summary>
            <p className="small" style={{ margin: 0 }}>
              {p.split.candidates.map((c) => `${c.drainage_mm_h} mm/h: ${c.auc != null ? pct(c.auc) : pct(c.hit_rate)}`).join(' · ')}
              <span className="muted"> on the tuning half. Within the error bars these are the same, so we use {p.split.value_mm_h} mm/h as an assumption.</span>
            </p>
            <h3 style={{ fontSize: 14 }}>Limits</h3>
            <ul className="small muted" style={{ paddingLeft: 18, margin: 0 }}>{p.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
            </details>}
            {p.anuga && (
              <div className="small">
                <p style={{ margin: '8px 0 6px' }}>Velachery cross-check with ANUGA (Geoscience Australia), {p.anuga.triangles.toLocaleString()} triangles: the two models agree on {pct(p.anuga.cell_agreement)} of cells about whether water passes 15 cm (depth correlation {p.anuga.depth_corr.toFixed(2)}). Same terrain, different numerics, so this checks the arithmetic, not the terrain.</p>
                <div className="seg" role="group" aria-label="Velachery detail view">
                  <button aria-pressed={!detail} onClick={() => setDetail(null)}>2015 split view</button>
                  <button aria-pressed={detail === 'anuga'} onClick={() => setDetail('anuga')}>Detail: ANUGA</button>
                  <button aria-pressed={detail === 'fast'} onClick={() => setDetail('fast')}>Detail: fast model</button>
                </div>
              </div>
            )}

          </div>
        </>
      )}
      {!p && <div className="panel proof-center"><p className="muted">Validation results are not available yet.</p></div>}
    </>
  )
}
