import { useEffect, useMemo, useState } from 'react'
import { DESIGN_TOTALS } from '../config'
import { loadHospitals, type Hospitals as H, type Runs } from '../lib/data'
import { fmtDistance } from '../lib/geo'
import { loadGraph, mixedDepth, toArterial } from '../lib/routing'
import type { MapView } from '../map/MapView'

export default function Hospitals({ mv, runs }: { mv: MapView; runs: Runs }) {
  const [data, setData] = useState<H | null>(null)
  const [mm, setMm] = useState(300)
  const [sel, setSel] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const run = `design_${mm}_mean`

  useEffect(() => {
    loadHospitals().then((h) => {
      setData(h)
      // default to 300 mm, or the nearest total that has been computed
      const avail = DESIGN_TOTALS.filter((t) => h.runs[`design_${t}_mean`])
      if (avail.length && !avail.includes(300)) setMm(avail.reduce((a, b) => (Math.abs(b - 300) < Math.abs(a - 300) ? b : a)))
    }).catch(() => {})
  }, [])
  useEffect(() => {
    mv.map.easeTo({ center: [80.22, 13.04], zoom: 11.2, pitch: 35, bearing: 0, duration: 1400 })
    return () => { mv.setGeoJSON('hospitals', null); mv.setGeoJSON('route-safe', null) }
  }, [mv])
  useEffect(() => { if (runs[run]) mv.showMix([{ run, w: 1 }], 'max', 350) }, [run, runs, mv])

  // OSM names are often typed in lower case; capitalise them (small words stay small)
  const SMALL = new Set(['of', 'and', 'the', 'for', 'in', 'at', 'by', 'to', 'a', 'an', 'on'])
  const title = (n: string) => {
    const words = n.split(/\s+/)
    if (words.filter((w) => /^[a-z]/.test(w)).length < Math.max(1, words.length / 2)) return n
    return words.map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
  }
  const rows = useMemo(() => {
    if (!data || !data.runs[run]) return []
    const r = data.runs[run]
    return data.hospitals.map((h, i) => ({ ...h, i, reach: r.reach[i], share: r.share[i] }))
      .sort((a, b) => a.reach - b.reach || a.name.localeCompare(b.name))
  }, [data, run])

  useEffect(() => {
    mv.setGeoJSON('hospitals', { type: 'FeatureCollection', features: rows.map((h) => ({ type: 'Feature', properties: { name: title(h.name), reach: h.reach },
      geometry: { type: 'Point', coordinates: [h.lon, h.lat] } })) })
  }, [rows, mv])

  const pick = async (i: number) => {
    if (!data) return
    setSel(i)
    const h = data.hospitals[i]
    mv.map.easeTo({ center: [h.lon, h.lat], zoom: 13.5, pitch: 50, duration: 1200 })
    setMsg('Finding a dry route from the main road network…')
    const g = await loadGraph()
    const depth = await mixedDepth([{ run, w: 1 }])
    const reach = data.runs[run]?.reach[i]
    const r = reach ? toArterial(g, h.node, depth, 30) : null
    if (r) {
      mv.setGeoJSON('route-safe', { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.coords } })
      setMsg(`Dry route from the main road: ${fmtDistance(r.lengthM)}.`)
    } else {
      mv.setGeoJSON('route-safe', null)
      setMsg('No dry route: every way in from the main road crosses water deeper than 30 cm.')
    }
  }

  const r = data?.runs[run]
  return (
    <div className="panel left">
      <h2>Hospitals</h2>
      {data && r && <p style={{ margin: '4px 0' }}><span className="stat" style={{ fontSize: 30 }}>{r.cut_off} of {data.hospitals.length}</span> hospitals cut off at {mm} mm<span className="chip">from the model</span></p>}
      <div className="seg" role="group" aria-label="Rainfall">
        {DESIGN_TOTALS.map((t) => <button key={t} aria-pressed={t === mm} disabled={!data?.runs[`design_${t}_mean`]}
          onClick={() => { setMm(t); setSel(null); setMsg('') }}>{t} mm</button>)}
      </div>
      <p className="muted small">Cut off means no road under 30 cm links the hospital to the city’s main road network at the storm’s peak.</p>
      {msg && <p className="small">{msg}</p>}
      <ul className="hlist">
        {rows.map((h) => (
          <li key={h.id} className={h.reach ? '' : 'cut'} onClick={() => pick(h.i)} aria-current={sel === h.i}>
            <span>{title(h.name)}</span><span className="muted small">{h.reach ? 'Reachable' : 'Cut off'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
