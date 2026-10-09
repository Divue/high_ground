// The hero flow: address -> fly to the street -> water rises to tonight's depth ->
// answer card (depth, time) -> nearest dry parking -> dry route -> email alerts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { REPLAYS, bandFor, prefersReducedMotion } from '../config'
import { loadParking, type Current, type Parking, type Runs } from '../lib/data'
import { distM, fmtDistance } from '../lib/geo'
import { blendedFrame } from '../lib/frames'
import { leaveByPlan, type Route } from '../lib/routing'
import { clockLabel, mixDescription, type Scenario } from '../lib/scenario'
import { nearbyShare, nearestSegment, segmentValues, type Segment, type StreetAnswer } from '../lib/streets'
import type { MapView } from '../map/MapView'
import Readout from '../ui/Readout'
import Search, { type Place } from '../ui/Search'
import Subscribe from '../ui/Subscribe'
import Timeline from '../ui/Timeline'

interface Props {
  mv: MapView
  runs: Runs
  current: Current | null
  scenario: Scenario
  replayRun: string | null
  setReplayRun: (r: string | null) => void
  place: Place | null
  setPlace: (p: Place) => void
}

interface ParkOpt { name: string; kind: string; lon: number; lat: number; d: number }

export default function Tonight({ mv, runs, current, scenario, replayRun, setReplayRun, place, setPlace }: Props) {
  const [seg, setSeg] = useState<Segment | null>(null)
  const [ans, setAns] = useState<StreetAnswer | null>(null)
  const [hour, setHour] = useState(1)
  const [park, setPark] = useState<ParkOpt[]>([])
  const [parking, setParking] = useState<Parking | null>(null)
  const [route, setRoute] = useState<{ normal: Route | null; safe: Route | null; to: string; leaveBy: number | null; until: number; streetFloods: boolean } | null>(null)
  const [routing, setRouting] = useState(false)
  const [error, setError] = useState('')
  const [nearby, setNearby] = useState<{ wet: number; total: number } | null>(null)
  const flown = useRef<string>('')

  useEffect(() => { loadParking().then(setParking).catch(() => {}) }, [])
  useEffect(() => () => { mv.setGeoJSON('route-safe', null); mv.setGeoJSON('route-normal', null) }, [mv])

  // Answer for the place under the active scenario
  useEffect(() => {
    let dead = false
    if (!place) return
    ;(async () => {
      setError('')
      setAns(null)          // never mix the previous street's answer with the new street
      setRoute(null)
      const s = await nearestSegment(place.lon, place.lat).catch(() => null)
      if (dead) return
      if (!s || s.distanceM > 600) {
        setSeg(null); setAns(null)
        setError('That place is outside the area HighGround models (Greater Chennai Corporation).')
        return
      }
      setSeg(s)
      mv.setGeoJSON('street', { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: s.coords } })
      mv.setGeoJSON('here', { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [place.lon, place.lat] } })
      if (!scenario.mix.length) { setAns(null); return }
      const a = await segmentValues(s, scenario.mix)
      if (dead) return
      setAns(a)
      nearbyShare(place.lon, place.lat, scenario.mix).then((n) => { if (!dead) setNearby(n) }).catch(() => setNearby(null))
      setHour(a.peakHour ?? Math.min(scenario.hours, 8))
    })()
    return () => { dead = true }
  }, [place, scenario, mv])

  // Fly to the street once per place; water rises from zero to the selected hour
  useEffect(() => {
    if (!place) return
    const key = `${place.lon},${place.lat}`
    if (flown.current === key) return
    flown.current = key
    mv.water?.setRise(0)
    mv.flyTo([place.lon, place.lat]).then(() => {
      mv.water?.setRise(1, prefersReducedMotion() ? 0 : 2600)
    })
  }, [place, mv])

  // Switching storms replays the rise: water drains away, then rises to the new storm
  const firstScenario = useRef(true)
  useEffect(() => {
    if (firstScenario.current) { firstScenario.current = false; return }
    if (prefersReducedMotion()) return
    mv.water?.setRise(0, 500)
    const t = window.setTimeout(() => mv.water?.setRise(1, 2600), 650)
    return () => window.clearTimeout(t)
  }, [scenario, mv])

  // Depth frame for the current hour
  useEffect(() => {
    if (!scenario.mix.length) { mv.showMix([], 'max'); return }
    mv.preload(scenario.mix, scenario.hours)
    mv.showMix(scenario.mix, hour, 450)
  }, [scenario, hour, mv])

  // Rain on screen follows the hyetograph at the scrubbed hour
  useEffect(() => {
    let r = 0
    for (const { run, w } of scenario.mix) r += w * (runs[run]?.rain_mm_h[hour - 1] ?? 0)
    mv.water?.setRain(Math.min(1, r / 25))
  }, [scenario, hour, runs, mv])

  // Nearest dry parking for the dominant run
  useEffect(() => {
    if (!place || !parking || !scenario.mix.length) { setPark([]); mv.setGeoJSON('parking', null); return }
    const dom = [...scenario.mix].sort((a, b) => b.w - a.w)[0].run
    const flags = parking.dry[dom] ?? []
    const opts = parking.candidates.map((c, i) => ({ ...c, d: distM(place.lon, place.lat, c.lon, c.lat), ok: flags[i] === 1 }))
      .filter((c) => c.ok).sort((a, b) => a.d - b.d)
      .filter((c, i, arr) => arr.findIndex((o) => o.name === c.name) === i).slice(0, 3)
    setPark(opts)
    mv.setGeoJSON('parking', { type: 'FeatureCollection', features: opts.map((o) => ({ type: 'Feature', properties: { name: o.name }, geometry: { type: 'Point', coordinates: [o.lon, o.lat] } })) })
    setRoute(null)
    mv.setGeoJSON('route-safe', null); mv.setGeoJSON('route-normal', null)
  }, [place, parking, scenario, mv])

  const showRoute = useCallback(async (o: ParkOpt) => {
    if (!place || !mv.meta) return
    setRouting(true)
    try {
      // Plan for the moment you leave: the last hour a dry route still exists, and never later
      // than the hour your own street passes 15 cm.
      const streetFloods = !!ans?.hoursTo15
      const until = ans?.hoursTo15 ? Math.max(1, ans.hoursTo15 - 1) : (ans?.peakHour ?? Math.min(scenario.hours, 12))
      const n = mv.meta.width * mv.meta.height
      const plan = await leaveByPlan([place.lon, place.lat], [o.lon, o.lat], mv.meta,
        (h) => blendedFrame(scenario.mix, h, n), until, 30)
      setRoute({ normal: plan.normal, safe: plan.route, to: o.name, leaveBy: plan.leaveByHour, until, streetFloods })
      // the map stays at the peak the card describes; the leave-by hour is marked on the timeline
      mv.setGeoJSON('route-normal', plan.normal ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: plan.normal.coords } } : null)
      mv.setGeoJSON('route-safe', plan.route ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: plan.route.coords } } : null)
    } finally { setRouting(false) }
  }, [place, scenario, mv, ans])

  // When the street floods, work out the decision straight away for the nearest dry parking
  const planned = useRef('')
  useEffect(() => {
    if (!ans?.hoursTo15 || !park.length || !seg) return
    const key = `${seg.id}|${ans.hoursTo15}|${ans.maxCm}|${park[0].name}|${scenario.label}`
    if (planned.current === key) return
    planned.current = key
    showRoute(park[0])
  }, [ans, park, seg, scenario, showRoute])

  const atHour = ans?.seriesCm[hour - 1] ?? 0
  const band = ans ? bandFor(ans.maxCm) : null
  const dryTonight = scenario.kind === 'dry'

  return (
    <>
      <div className="panel left" aria-live="polite">
        <Search onPick={setPlace} />
        <div className="seg tight" role="group" aria-label="Replay a storm">
          <button aria-pressed={!replayRun} onClick={() => setReplayRun(null)}>Tonight</button>
          {REPLAYS.filter((r) => runs[r.run]).map((r) => (
            <button key={r.run} aria-pressed={replayRun === r.run} onClick={() => setReplayRun(r.run)}>{r.short}</button>
          ))}
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          {scenario.label}
          {scenario.kind === 'replay' && ', running as if it started at 6 PM tonight'}
          {scenario.kind === 'forecast' && current && <> · forecast updated {new Date(current.updated_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</>}
        </div>

        {dryTonight && (
          <div style={{ marginTop: 12 }}>
            <h2>{scenario.forecastMm != null && scenario.forecastMm < 1 ? 'No rain forecast tonight' : 'Tonight looks dry'}</h2>
            <p className="muted">{scenario.forecastMm != null && scenario.forecastMm >= 1 ? `About ${Math.round(scenario.forecastMm)} mm is forecast in the next 24 hours, below the smallest storm we model (50 mm). ` : ''}Replay a past storm to see what HighGround shows on a bad night.</p>
            <button className="btn primary" onClick={() => setReplayRun('michaung2023')}>See Cyclone Michaung as if it were tonight</button>
          </div>
        )}

        {error && <p className="small" role="alert">{error}</p>}

        {seg && ans && band && (
          <>
            <div className="street">{seg.name}{seg.bridge ? ' (on a bridge)' : ''}</div>
            <Readout cm={ans.maxCm} />
            <div className="when">
              {ans.hoursTo15 ? <>Reaches 15 cm by {clockLabel(scenario.start, ans.hoursTo15)}</> :
                ans.maxCm >= 5 ? <>Stays under 15 cm</> : <>Stays dry</>}
              {ans.peakHour && ans.maxCm >= 5 ? <span className="muted"> · peak {clockLabel(scenario.start, ans.peakHour)}</span> : null}
            </div>
            <span className={`band ${band.code}`}>{band.label}</span>
            <span className="chip">from the model</span>
            {ans.hoursTo15 && (
              <div className="decision" role="status">
                {routing && !route ? 'Working out when to move your car…'
                  : route?.safe && route.leaveBy ? <>Move your car to <b className="safe">{route.to}</b> by <b>{clockLabel(scenario.start, route.leaveBy)}</b>.</>
                    : route ? <>No dry way out to {route.to} before your street floods.</> : null}
              </div>
            )}
            <div className="muted small" style={{ marginTop: 6 }}>
              At {clockLabel(scenario.start, hour)}: {atHour} cm · {mixDescription(scenario.mix, runs)}
            </div>
            {nearby && nearby.total > 0 && (
              <div className="small" style={{ marginTop: 6 }}>
                {nearby.wet} of {nearby.total} streets within 500 m pass 15 cm<span className="chip">from the model</span>
              </div>
            )}

            <div className="divider" />
            <h3>Park on dry ground</h3>
            {park.length === 0 && <p className="muted small">No mapped flyover or parking ground near you stays dry in this scenario.</p>}
            {park.slice(0, 2).map((o) => (
              <div className="park" key={`${o.name}-${o.lon}`}>
                <span className="pin" />
                <div style={{ flex: 1 }}>
                  <b>{o.name}</b>, {fmtDistance(o.d)} <span className="muted small">({o.kind})</span>
                  {route?.to !== o.name && (
                    <button className="linkbtn" disabled={routing} onClick={() => showRoute(o)}>{routing ? 'checking…' : 'when to leave'}</button>
                  )}
                </div>
              </div>
            ))}
            {park.some((o) => o.kind === 'flyover') && <p className="muted small">Check local traffic advisories before parking on a flyover.</p>}
            <div className="divider" />
            <Subscribe lat={place!.lat} lon={place!.lon} street={seg.name} />
          </>
        )}
        {!place && !dryTonight && <p className="muted" style={{ marginTop: 12 }}>Type your street to see how deep the water gets there tonight, when, and where to move your car.</p>}
        <div className="sticky-foot">
          <p className="muted small" style={{ margin: 0 }}>Not an official warning. Follow GCC and IMD advisories. In danger, call <span className="emergency">112</span>.</p>
        </div>
      </div>
      {scenario.mix.length > 0 && <Timeline scenario={scenario} runs={runs} hour={hour} setHour={setHour}
        marker={route?.leaveBy ? { hour: route.leaveBy, label: `leave by ${clockLabel(scenario.start, route.leaveBy)}` } : null} />}
    </>
  )
}
