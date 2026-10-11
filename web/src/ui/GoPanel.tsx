// "Take me to dry ground": a route on foot, by two-wheeler or by car to dry parking, a hospital,
// high ground or a saved place, avoiding streets the model expects to flood, with directions.
// It works offline (the road graph and depths are in the saved pack) and follows the timeline:
// drag the hour and the route is planned for leaving then.
import { useEffect, useRef, useState } from 'react'
import type { Step } from '../lib/directions'
import { fmtDistance } from '../lib/geo'
import { MODES, type DestKind, type Mode } from '../lib/nav'
import { navigateAsync, type NavAnswer } from '../lib/navClient'
import { clockLabel, type Scenario } from '../lib/scenario'
import type { MapView } from '../map/MapView'
import NavLive from './NavLive'

const KINDS: [DestKind, string][] = [['parking', 'Dry parking'], ['hospital', 'Hospital'], ['high', 'High ground']]
const ICON_ROT: Partial<Record<Step['icon'], number>> = {
  straight: 0, 'slight-left': -45, 'slight-right': 45, left: -90, right: 90, 'sharp-left': -135, 'sharp-right': 135, uturn: 180,
}

function StepIcon({ icon }: { icon: Step['icon'] }) {
  if (icon === 'start') return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4" fill="currentColor" /></svg>
  if (icon === 'arrive') return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="var(--amber)" /></svg>
  if (icon === 'roundabout') return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="9" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 5V1M6 3l2-2 2 2" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" style={{ transform: `rotate(${ICON_ROT[icon] ?? 0}deg)` }}>
      <path d="M8 14V3M4 7l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface Props {
  mv: MapView
  from: { lon: number; lat: number; label: string }
  scenario: Scenario
  hour: number
  saved: { label: string; lon: number; lat: number }[]
  onClose: () => void
}

export default function GoPanel({ mv, from, scenario, hour, saved, onClose }: Props) {
  const [mode, setModeState] = useState<Mode>(() => {
    try { const m = localStorage.getItem('hg-mode'); if (m && m in MODES) return m as Mode } catch { /* private mode */ }
    return 'two_wheeler'       // Chennai has about 4.6 two-wheelers per car
  })
  const setMode = (m: Mode) => { setModeState(m); try { localStorage.setItem('hg-mode', m) } catch { /* private mode */ } }
  const others = saved.filter((p) => Math.abs(p.lon - from.lon) > 1e-4 || Math.abs(p.lat - from.lat) > 1e-4)
  const [kind, setKind] = useState<DestKind | `place:${number}`>('parking')
  const [ans, setAns] = useState<NavAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [live, setLive] = useState<null | 'gps' | 'sim'>(null)
  const [fromNow, setFromNow] = useState<{ lon: number; lat: number } | null>(null)   // re-planned from here
  const start = fromNow ?? from
  const token = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const m = MODES[mode]
  // the panel opens at the bottom of the card: bring it into view
  useEffect(() => { box.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, [])

  useEffect(() => {
    const t = ++token.current
    setBusy(true); setErr('')
    const place = kind.startsWith('place:') ? others[Number(kind.slice(6))] : undefined
    const id = window.setTimeout(() => {
      navigateAsync({ from: [start.lon, start.lat], mode, kind: place ? 'place' : (kind as DestKind), mix: scenario.mix, hour,
        place: place ? { name: place.label, lon: place.lon, lat: place.lat } : undefined })
        .then((a) => {
          if (t !== token.current) return
          setAns(a)
          const r = a.res
          mv.drawLine('route-safe', r.route ? r.route.coords : null)
          mv.setGeoJSON('route-normal', r.route && r.usual && r.avoided > 0 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.usual.coords } } : null)
          mv.setGeoJSON('nav-dest', r.dest ? { type: 'Feature', properties: { name: r.dest.name }, geometry: { type: 'Point', coordinates: [r.dest.lon, r.dest.lat] } } : null)
          if (r.route && !live) {
            const xs = r.route.coords.map((c) => c[0]), ys = r.route.coords.map((c) => c[1])
            mv.fitRoute([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
          }
        })
        .catch((e) => { if (t === token.current) setErr(String(e).slice(0, 160)) })
        .finally(() => { if (t === token.current) setBusy(false) })
    }, 220)      // dragging the timeline: plan for where it stops
    return () => window.clearTimeout(id)
  }, [mode, kind, hour, scenario, start.lon, start.lat]) // eslint-disable-line react-hooks/exhaustive-deps

  // leaving the panel clears its lines
  useEffect(() => () => {
    mv.drawLine('route-safe', null); mv.setGeoJSON('route-normal', null); mv.setGeoJSON('nav-dest', null)
  }, [mv])

  const r = ans?.res
  const when = clockLabel(scenario.start, hour)
  const mins = r?.route ? Math.max(1, Math.round(r.route.timeS / 60)) : 0
  return (
    <div className="go" aria-live="polite" ref={box}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Get to dry ground</h3>
        <button className="linkbtn" onClick={onClose}>Close</button>
      </div>
      <div className="seg tight" role="group" aria-label="How you are travelling">
        {(Object.keys(MODES) as Mode[]).map((k) => <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>{MODES[k].label}</button>)}
      </div>
      <div className="seg tight" role="group" aria-label="Where to">
        {KINDS.map(([k, l]) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
        {others.map((p, i) => <button key={`p${i}`} aria-pressed={kind === `place:${i}`} onClick={() => setKind(`place:${i}`)}>{p.label}</button>)}
      </div>
      <p className="muted small" style={{ margin: '6px 0 0' }}>Leaving at {when} (drag the timeline to change). Avoids water {m.block} cm deep or more {m.verb}.</p>
      {busy && !r && <p className="small">Finding a way that avoids the water…</p>}
      {err && <p className="small" role="alert">Could not plan a route: {err}</p>}
      {r && (r.ok && r.route && r.dest ? (
        <div className={busy ? 'go-result stale' : 'go-result'}>
          <div className="go-dest"><b className="safe">{r.dest.name}</b>{r.dest.detail ? <span className="muted small"> ({r.dest.detail})</span> : null}</div>
          <div className="small">{fmtDistance(r.route.lengthM)} · about {mins} min {m.verb}</div>
          {r.avoided > 0 && <div className="small">Avoids {r.avoided} {r.avoided === 1 ? 'street' : 'streets'} the shortest way would cross in water (dashed).</div>}
          {r.route.maxCm >= m.soft && <div className="small">Shallow water possible on the way: up to {r.route.maxCm} cm in the model.</div>}
          {r.dest.kind === 'hospital' && <div className="muted small">Call ahead: hospitals can be cut off or short of power in a flood.</div>}
          {r.dest.detail === 'flyover' && <div className="muted small">Check local traffic advisories before parking on a flyover.</div>}
          {!live && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn amber" onClick={() => setLive('gps')}>Start</button>
              <button className="btn" onClick={() => setLive('sim')}>Preview the drive</button>
            </div>
          )}
          <ol className="steps">
            {ans!.steps.map((s, i) => (
              <li key={i}><StepIcon icon={s.icon} /><span>{s.text}</span>{s.distM > 0 && i < ans!.steps.length - 1 ? <em>{fmtDistance(s.distM)}</em> : null}</li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="go-result">
          <p className="small" style={{ marginTop: 6 }}>
            {r.onHighGround && kind === 'high' ? <>Your street stays under ankle depth all storm in the model. Staying put may be the safest choice. </> : null}
            No route avoids deep water from here at {when}{r.startCm >= m.block ? ` (your street already has about ${r.startCm} cm)` : ''}.
            {r.opensAt ? <> A way out opens again around {clockLabel(scenario.start, r.opensAt)} as the water drains.</> : null}
          </p>
          <p className="small">If you are safe, stay where you are. If water enters your home, call <a className="emergency" href="tel:112">112</a>.</p>
        </div>
      ))}
      {live && r?.route && r.dest && (
        <NavLive key={`${live}|${r.route.edges.length}|${r.route.edges[0]}`} mv={mv} coords={r.route.coords} steps={ans!.steps} dest={r.dest.name}
          mode={mode} simulate={live === 'sim'} onReroute={(p) => setFromNow(p)}
          onEnd={() => { setLive(null); setFromNow(null) }} />
      )}
      <p className="muted small" style={{ marginBottom: 0 }}>
        A route that avoids streets our model expects to flood, not an official route. Model estimate, not a sighting: if you see water above your ankle, turn back. Watch for fallen wires and open drains.
      </p>
    </div>
  )
}
