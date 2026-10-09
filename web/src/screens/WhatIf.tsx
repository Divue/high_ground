import { useEffect, useState } from 'react'
import { loadHospitals, type Hospitals, type Runs } from '../lib/data'
import { DESIGN_TOTALS } from '../config'
import { whatIf } from '../lib/scenario'
import type { MapView } from '../map/MapView'

export default function WhatIf({ mv, runs }: { mv: MapView; runs: Runs }) {
  const [mm, setMm] = useState(200)
  const [tide, setTide] = useState<'mean' | 'high'>('mean')
  const [hosp, setHosp] = useState<Hospitals | null>(null)
  // the slider spans only storms that have been computed, so its end is never a dry, empty map
  const avail = DESIGN_TOTALS.filter((t) => runs[`design_${t}_${tide}`])
  const lo = avail[0] ?? 50, hi = avail[avail.length - 1] ?? 400
  const val = Math.min(hi, Math.max(lo, mm))
  const sc = whatIf(val, tide, runs)

  useEffect(() => { loadHospitals().then(setHosp).catch(() => {}) }, [])
  useEffect(() => {
    mv.map.easeTo({ center: [80.215, 13.03], zoom: 11.3, pitch: 45, bearing: -10, duration: 1600 })
    mv.water?.setRain(0.4)
    return () => { mv.water?.setRain(0) }
  }, [mv])
  useEffect(() => { mv.showMix(avail.length ? sc.mix : [], 'max', 350) }, [val, tide]) // eslint-disable-line react-hooks/exhaustive-deps

  // Never invent a number: if any run in the blend is missing, say so instead of treating it as 0
  const computed = avail.length > 0 && sc.mix.every((m) => runs[m.run])
  const wet = computed ? sc.mix.reduce((s, m) => s + m.w * runs[m.run].wet_share_15cm, 0) : null
  const dom = [...sc.mix].sort((a, b) => b.w - a.w)[0].run
  const hr = hosp?.runs[dom]
  const blended = sc.mix.length > 1

  return (
    <div className="panel left">
      <h2>What if</h2>
      <p className="muted small">Drag the rainfall. The city shows the deepest water each street reaches over a 24-hour storm.</p>
      <div className="stat" style={{ marginTop: 10 }}>{val} mm</div>
      <div className="muted small">in 24 hours</div>
      <input className="big-range" type="range" min={lo} max={hi} step={10} value={val} disabled={!avail.length}
        onChange={(e) => setMm(Number(e.target.value))} aria-label="Rainfall in 24 hours, millimetres" />
      <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted small">{lo} mm</span><span className="muted small">{hi} mm{hi < 400 ? ', the largest computed so far' : ''}</span></div>
      <div className="seg" role="group" aria-label="Tide">
        <button aria-pressed={tide === 'mean'} onClick={() => setTide('mean')}>Mean tide</button>
        <button aria-pressed={tide === 'high'} onClick={() => setTide('high')}>High tide</button>
      </div>
      <div className="divider" />
      <div className="row" style={{ gap: 24, alignItems: 'flex-end' }}>
        <div>
          {wet != null ? <>
            <div className="stat">{Math.round(wet * 100)}%</div>
            <div className="muted small">of the city’s land under at least 15 cm of water<span className="chip">from the model</span></div>
          </> : <div className="muted small">{avail.length ? 'This rainfall has not been computed yet.' : `The ${tide} tide storms are still being computed.`}</div>}
        </div>
        {computed && hr && hosp && (
          <div>
            <div className="stat">{hr.cut_off}<span className="muted" style={{ fontSize: 20 }}> of {hosp.hospitals.length}</span></div>
            <div className="muted small">hospitals cut off at {runs[dom]?.total_mm} mm</div>
          </div>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        {!computed ? '' : blended && runs[sc.mix[0].run] && runs[sc.mix[1].run]
          ? `Blended between the ${runs[sc.mix[0].run].total_mm} mm and ${runs[sc.mix[1].run].total_mm} mm model runs.`
          : runs[dom] ? `The ${runs[dom].total_mm} mm model run.` : ''}
        {' '}Storms are front-loaded: most rain falls in the first eight hours.
      </p>
    </div>
  )
}
