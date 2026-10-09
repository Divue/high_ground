// The hero flow: address -> fly to the street -> water rises to tonight's depth ->
// answer card (depth, time) -> nearest dry parking -> dry route -> email alerts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { REPLAYS, bandFor, prefersReducedMotion } from '../config'
import { loadParking, type Current, type Parking, type Runs } from '../lib/data'
import { distM, fmtDistance } from '../lib/geo'
import { routePair, type Route } from '../lib/routing'
import { clockLabel, mixDescription, type Scenario } from '../lib/scenario'
import { nearestSegment, segmentValues, type Segment, type StreetAnswer } from '../lib/streets'
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
  const [route, setRoute] = useState<{ normal: Route | null; safe: Route | null; to: string } | null>(null)
  const [routing, setRouting] = useState(false)
  const [error, setError] = useState('')
  const flown = useRef<string>('')

  useEffect(() => { loadParking().then(setParking).catch(() => {}) }, [])

  // Answer for the place under the active scenario
  useEffect(() => {
    let dead = false
    if (!place) return
    ;(async () => {
      setError('')
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
      .filter((c) => c.ok).sort((a, b) => a.d - b.d).slice(0, 3)
    setPark(opts)
    mv.setGeoJSON('parking', { type: 'FeatureCollection', features: opts.map((o) => ({ type: 'Feature', properties: { name: o.name }, geometry: { type: 'Point', coordinates: [o.lon, o.lat] } })) })
    setRoute(null)
    mv.setGeoJSON('route-safe', null); mv.setGeoJSON('route-normal', null)
  }, [place, parking, scenario, mv])

  const showRoute = useCallback(async (o: ParkOpt) => {
    if (!place) return
    setRouting(true)
    try {
      const r = await routePair([place.lon, place.lat], [o.lon, o.lat], scenario.mix, 30)
      setRoute({ ...r, to: o.name })
      mv.setGeoJSON('route-normal', r.normal ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.normal.coords } } : null)
      mv.setGeoJSON('route-safe', r.safe ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.safe.coords } } : null)
    } finally { setRouting(false) }
  }, [place, scenario, mv])

  const atHour = ans?.seriesCm[hour - 1] ?? 0
  const band = ans ? bandFor(ans.maxCm) : null
  const dryTonight = scenario.kind === 'dry'

  return (
    <>
      <div className="panel left" aria-live="polite">
        <Search onPick={setPlace} />
        <div className="seg" role="group" aria-label="Replay a storm">
          <button aria-pressed={!replayRun} onClick={() => setReplayRun(null)}>Tonight</button>
          {REPLAYS.filter((r) => runs[r.run]).map((r) => (
            <button key={r.run} aria-pressed={replayRun === r.run} onClick={() => setReplayRun(r.run)}>Replay {r.short}</button>
          ))}
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          {scenario.label}
          {scenario.kind === 'replay' && ', running as if it started at 6 PM tonight'}
          {scenario.kind === 'forecast' && current && <> · forecast updated {new Date(current.updated_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</>}
        </div>

        {dryTonight && (
          <div style={{ marginTop: 12 }}>
            <h2>Tonight looks dry</h2>
            <p className="muted">The forecast for the next 24 hours is {scenario.forecastMm != null ? `about ${Math.round(scenario.forecastMm)} mm` : 'unavailable'}, below the smallest storm we model (50 mm). Replay a past storm to see what HighGround shows on a bad night.</p>
            <button className="btn" onClick={() => setReplayRun('michaung2023')}>Replay Cyclone Michaung</button>
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
              {ans.peakHour && ans.maxCm >= 5 ? <span className="muted"> · deepest around {clockLabel(scenario.start, ans.peakHour)}</span> : null}
            </div>
            <span className={`band ${band.code}`}>{band.label}</span>
            <span className="chip">from the model</span>
            <div className="muted small" style={{ marginTop: 6 }}>
              At {clockLabel(scenario.start, hour)}: {atHour} cm · {mixDescription(scenario.mix, runs)}
            </div>

            <div className="divider" />
            <h3>Park on dry ground</h3>
            {park.length === 0 && <p className="muted small">No mapped flyover or parking ground near you stays dry in this scenario.</p>}
            {park.slice(0, 2).map((o) => (
              <div className="park" key={`${o.name}-${o.lon}`} style={{ marginBottom: 8 }}>
                <span className="pin" />
                <div style={{ flex: 1 }}>
                  <b>{o.name}</b>, {fmtDistance(o.d)} away <span className="muted small">({o.kind})</span>
                  <div><button className="btn amber" style={{ marginTop: 6, padding: '5px 10px' }} disabled={routing}
                    onClick={() => showRoute(o)}>{routing ? 'Finding a dry route' : 'Dry route there'}</button></div>
                </div>
              </div>
            ))}
            {park.some((o) => o.kind === 'flyover') && <p className="muted small">Check local traffic advisories before parking on a flyover.</p>}
            {route && (
              <p className="small">
                {route.safe ? <>Dry route to {route.to}: {fmtDistance(route.safe.lengthM)}{route.normal && route.safe.lengthM - route.normal.lengthM > 30 ? `, ${fmtDistance(route.safe.lengthM - route.normal.lengthM)} longer than the usual way` : ''}.</>
                  : <>No route avoids water deeper than 30 cm in this scenario.</>}
                {route.normal && route.normal.floodedEdges > 0 && <span className="muted"> The usual way (grey) crosses {route.normal.floodedEdges} flooded stretch{route.normal.floodedEdges > 1 ? 'es' : ''}.</span>}
              </p>
            )}

            <div className="divider" />
            <Subscribe lat={place!.lat} lon={place!.lon} street={seg.name} />
          </>
        )}
        {!place && !dryTonight && <p className="muted" style={{ marginTop: 12 }}>Type your street to see how deep the water gets there tonight, when, and where to move your car.</p>}
        <div className="divider" />
        <p className="muted small" style={{ margin: 0 }}>Not an official warning. Follow GCC and IMD advisories. In danger, call <span className="emergency">112</span>.</p>
      </div>
      {scenario.mix.length > 0 && <Timeline scenario={scenario} runs={runs} hour={hour} setHour={setHour} />}
    </>
  )
}
