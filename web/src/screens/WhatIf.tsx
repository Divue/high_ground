import { useEffect, useState } from 'react'
import { loadHospitals, type Hospitals, type Runs } from '../lib/data'
import { whatIf } from '../lib/scenario'
import type { MapView } from '../map/MapView'

export default function WhatIf({ mv, runs }: { mv: MapView; runs: Runs }) {
  const [mm, setMm] = useState(200)
  const [tide, setTide] = useState<'mean' | 'high'>('mean')
  const [hosp, setHosp] = useState<Hospitals | null>(null)
  const sc = whatIf(mm, tide, runs)

  useEffect(() => { loadHospitals().then(setHosp).catch(() => {}) }, [])
  useEffect(() => {
    mv.map.easeTo({ center: [80.215, 13.03], zoom: 11.3, pitch: 45, bearing: -10, duration: 1600 })
    mv.water?.setRain(0.4)
    return () => { mv.water?.setRain(0) }
  }, [mv])
  useEffect(() => { mv.showMix(sc.mix, 'max', 350) }, [mm, tide]) // eslint-disable-line react-hooks/exhaustive-deps

  const wet = sc.mix.reduce((s, m) => s + m.w * (runs[m.run]?.wet_share_15cm ?? 0), 0)
  const dom = [...sc.mix].sort((a, b) => b.w - a.w)[0].run
  const hr = hosp?.runs[dom]
  const blended = sc.mix.length > 1

  return (
    <div className="panel left">
      <h2>What if</h2>
      <p className="muted small">Drag the rainfall. The city shows the deepest water each street reaches over a 24-hour storm.</p>
      <div className="stat" style={{ marginTop: 10 }}>{mm} mm</div>
      <div className="muted small">in 24 hours</div>
      <input className="big-range" type="range" min={50} max={400} step={10} value={mm}
        onChange={(e) => setMm(Number(e.target.value))} aria-label="Rainfall in 24 hours, millimetres" />
      <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted small">50 mm</span><span className="muted small">400 mm</span></div>
      <div className="seg" role="group" aria-label="Tide">
        <button aria-pressed={tide === 'mean'} onClick={() => setTide('mean')}>Mean tide</button>
        <button aria-pressed={tide === 'high'} onClick={() => setTide('high')}>High tide</button>
      </div>
      <div className="divider" />
      <div className="row" style={{ gap: 24, alignItems: 'flex-end' }}>
        <div>
          <div className="stat">{Math.round(wet * 100)}%</div>
          <div className="muted small">of the city under 15 cm or more<span className="chip">from the model</span></div>
        </div>
        {hr && hosp && (
          <div>
            <div className="stat">{hr.cut_off}<span className="muted" style={{ fontSize: 20 }}> of {hosp.hospitals.length}</span></div>
            <div className="muted small">hospitals cut off at {runs[dom]?.total_mm} mm</div>
          </div>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        {blended ? `Blended between the ${runs[sc.mix[0].run]?.total_mm} mm and ${runs[sc.mix[1].run]?.total_mm} mm model runs.` : `The ${runs[sc.mix[0].run]?.total_mm} mm model run.`}
        {' '}Storms are front-loaded: most rain falls in the first eight hours.
      </p>
    </div>
  )
}
