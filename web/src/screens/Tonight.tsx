// The hero flow: address -> fly to the street -> water rises to tonight's depth ->
// answer card (depth, time) -> nearest dry parking -> dry route -> email alerts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { REPLAYS, bandFor, prefersReducedMotion } from '../config'
import { loadGray, loadParking, type Current, type Parking, type Runs } from '../lib/data'
import { distM, fmtDistance } from '../lib/geo'
import { blendedFrame, frameName } from '../lib/frames'
import { leaveByPlan, type Route } from '../lib/routing'
import { clockLabel, mixDescription, type Scenario } from '../lib/scenario'
import { nearbyShare, nearestSegment, segmentValues, type Segment, type StreetAnswer } from '../lib/streets'
import type { MapView } from '../map/MapView'
import Readout from '../ui/Readout'
import DepthGlyph from '../ui/DepthGlyph'
import { useTweened } from '../ui/useTweened'
import Search, { type Place } from '../ui/Search'
import Subscribe from '../ui/Subscribe'
import Timeline from '../ui/Timeline'
import Timelapse from '../ui/Timelapse'

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
  const [arrived, setArrived] = useState('')     // place key the camera has reached
  const played = useRef('')                       // place+scenario whose night has been played
  const playToken = useRef(0)
  const fadeMs = useRef(450)
  const [rising, setRising] = useState(false)    // the night is playing to the peak
  const [morePark, setMorePark] = useState(false)

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
        setError('No street within 600 m of that point in the area HighGround models. Try a nearby street name.')
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
    })()
    return () => { dead = true }
  }, [place, scenario, mv])

  // Fly to the street once per place (the opening flight may already have framed it)
  useEffect(() => {
    if (!place) return
    const key = `${place.lon},${place.lat}`
    if (flown.current === key) return
    flown.current = key
    if (mv.isFraming([place.lon, place.lat])) { setArrived(key); return }
    mv.flyTo([place.lon, place.lat]).then(() => setArrived(key))
  }, [place, mv])

  // The water rises the way the model says it does: the timeline plays the night from 6 PM to
  // this street's peak through the model's own hourly frames (cross-faded), once per place and storm.
  const nightKey = place ? `${place.lon},${place.lat}|${scenario.mix.map((m) => `${m.run}:${m.w}`).join()}` : ''
  // a new answer resets the night to 6 PM straight away, so number, water and timeline climb together
  useEffect(() => {
    if (!ans || !scenario.mix.length || prefersReducedMotion() || played.current === nightKey) return
    fadeMs.current = 450
    setRising(true)
    setHour(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ans])
  useEffect(() => {
    if (!place || !ans || !scenario.mix.length || arrived !== `${place.lon},${place.lat}`) return
    const key = nightKey
    if (played.current === key) return
    played.current = key
    const peak = ans.peakHour ?? Math.min(scenario.hours, 8)
    const token = ++playToken.current
    if (prefersReducedMotion() || peak <= 1) { setHour(peak); setRising(false); return }
    const steps = Math.min(8, peak)
    const hours = Array.from({ length: steps }, (_, k) => Math.max(1, Math.round(((k + 1) * peak) / steps)))
    const stepMs = Math.round(3000 / steps)
    ;(async () => {
      // the keyframes decode in a worker while the card appears
      await Promise.all(hours.flatMap((h) => scenario.mix.map(({ run }) => loadGray(`water/${run}/${frameName(h)}.png`).catch(() => null))))
      if (playToken.current !== token) return
      setRising(true)
      for (const h of hours) {
        if (playToken.current !== token) return
        fadeMs.current = stepMs
        setHour(h)
        await new Promise((r) => setTimeout(r, stepMs))
      }
      fadeMs.current = 450
      if (playToken.current === token) setRising(false)
    })()
  }, [place, ans, arrived, scenario])

  // scrubbing by hand stops the playback
  const scrub = useCallback((h: number) => {
    playToken.current++; fadeMs.current = 450; setHour(h); setRising(false)
    setLapse((l) => (l === 'playing' ? 'done' : l))
  }, [])

  // "Watch the whole storm": a replay played hour by hour over a wide view of the city
  const [lapse, setLapse] = useState<'off' | 'playing' | 'done'>('off')
  const lapseRun = scenario.kind === 'replay' && scenario.mix.length === 1 ? scenario.mix[0].run : null
  useEffect(() => { setLapse('off'); setMorePark(false) }, [place, scenario])
  const watchStorm = async () => {
    if (!lapseRun) return
    const token = ++playToken.current
    setLapse('playing')
    const H = scenario.hours
    const stepMs = prefersReducedMotion() ? 0 : Math.min(800, Math.max(450, Math.round(30000 / H)))
    await mv.showWide()
    for (let h = 1; h <= H; h++) {
      await Promise.all(scenario.mix.map(({ run }) => loadGray(`water/${run}/${frameName(h)}.png`).catch(() => null)))
      if (playToken.current !== token) return
      fadeMs.current = stepMs
      setHour(h)
      await new Promise((r) => setTimeout(r, stepMs))
    }
    if (playToken.current !== token) return
    fadeMs.current = 450
    setLapse('done')
  }
  const endLapse = () => {
    playToken.current++
    fadeMs.current = 450
    setLapse('off')
    if (place) mv.flyTo([place.lon, place.lat])
    if (ans) setHour(ans.peakHour ?? hour)
  }

  // Depth frame for the current hour
  useEffect(() => {
    if (!scenario.mix.length) { mv.showMix([], 'max'); return }
    mv.preload(scenario.mix, scenario.hours, hour)
    mv.showMix(scenario.mix, hour, fadeMs.current)
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
  // while the night plays, the number is the model's depth at the hour shown; then it settles on the peak
  const shownCm = useTweened(ans ? (rising ? ans.seriesCm[hour - 1] ?? 0 : ans.maxCm) : 0, rising ? 320 : 0)
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
          {scenario.kind === 'replay'
            ? lapse !== 'off'
              ? <>{REPLAYS.find((r) => r.run === lapseRun)?.line ?? scenario.label}, on its real dates</>
              : <>{REPLAYS.find((r) => r.run === lapseRun)?.line ?? scenario.label}, replayed from 6 PM tonight</>
            : scenario.label}
          {scenario.kind === 'forecast' && current && <> · forecast updated {new Date(current.updated_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</>}
        </div>
        {lapseRun && lapse !== 'off' && (
          <Timelapse run={runs[lapseRun]} hour={hour} playing={lapse === 'playing'} onStop={endLapse}
            onProof={lapseRun.startsWith('dec2015') ? () => { window.location.hash = 'proof' } : null} />
        )}

        {dryTonight && (
          <div style={{ marginTop: 12 }}>
            <h2>{scenario.forecastMm != null && scenario.forecastMm < 1 ? 'No rain forecast tonight' : 'Tonight looks dry'}</h2>
            <p className="muted">{scenario.forecastMm != null && scenario.forecastMm >= 1 ? `About ${Math.round(scenario.forecastMm)} mm is forecast in the next 24 hours, below the smallest storm we model (50 mm). ` : ''}Replay a past storm to see what HighGround shows on a bad night.</p>
            <button className="btn primary" onClick={() => setReplayRun('michaung2023')}>See Cyclone Michaung as if it were tonight</button>
          </div>
        )}

        {error && <p className="small" role="alert">{error}</p>}

        {lapse === 'off' && seg && ans && band && scenario.mix.length > 0 && (
          <>
            <div className="street">{seg.name}{seg.bridge ? ' (on a bridge)' : ''}</div>
            <Readout cm={ans.maxCm} shown={shownCm} note={!rising && ans.maxCm >= 5 ? 'at the peak' : undefined} />
            <div className="when">
              {ans.hoursTo15 ? <>Reaches 15 cm by {clockLabel(scenario.start, ans.hoursTo15)}</> :
                ans.maxCm >= 5 ? <>Stays under 15 cm</> : <>Stays dry</>}
              {ans.peakHour && ans.maxCm >= 5 ? <span className="muted"> · peak {clockLabel(scenario.start, ans.peakHour)}</span> : null}
            </div>
            {ans.maxCm >= 5 && <DepthGlyph cm={shownCm} />}
            <span className={`band ${band.code}`}>{band.label}</span>
            <span className="chip">from the model</span>
            {ans.hoursTo15 && (
              <div className="decision" role="status">
                {routing && !route ? 'Working out when to move your car…'
                  : route?.safe && route.leaveBy ? <>Move your car to <b className="safe">{route.to}</b> by <b>{clockLabel(scenario.start, route.leaveBy)}</b>.</>
                    : route ? <>No dry way out to {route.to} before your street floods.</> : null}
              </div>
            )}
            {!rising && hour !== ans.peakHour && (
              <div className="muted small" style={{ marginTop: 6 }}>
                At {clockLabel(scenario.start, hour)}: {atHour} cm · {mixDescription(scenario.mix, runs)}
              </div>
            )}
            {nearby && nearby.total > 0 && (
              <div className="small" style={{ marginTop: 6 }}>
                {nearby.wet} of {nearby.total} streets within 500 m pass 15 cm<span className="chip">from the model</span>
              </div>
            )}

            <div className="divider" />
            <h3>Park on dry ground</h3>
            {park.length === 0 && <p className="muted small">No mapped flyover or parking ground near you stays dry in this scenario.</p>}
            {park.slice(0, morePark ? 2 : 1).map((o) => (
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
            {park.length > 1 && !morePark && (
              <button className="linkbtn" style={{ marginLeft: 22 }} onClick={() => setMorePark(true)}>1 more dry place nearby</button>
            )}
            {route && !route.streetFloods && (
              <p className="small muted" style={{ margin: '2px 0 6px' }}>
                {route.safe ? <>Your street stays dry. Dry route to {route.to}: {fmtDistance(route.safe.lengthM)}.</> : <>No practical dry route to {route.to} at the storm’s peak.</>}
              </p>
            )}
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
      {scenario.mix.length > 0 && <Timeline runs={runs} hour={hour} setHour={scrub}
        // during the time-lapse the timeline shows the storm's real dates, like the caption card
        scenario={lapse !== 'off' && lapseRun && runs[lapseRun]?.start_local ? { ...scenario, start: new Date(runs[lapseRun].start_local!) } : scenario}
        marker={lapse === 'off' && route?.leaveBy && route.streetFloods ? { hour: route.leaveBy, label: `leave by ${clockLabel(scenario.start, route.leaveBy)}` } : null}
        action={lapseRun && lapse === 'off' && runs[lapseRun]?.wet_share_15cm_hourly
          ? <button className="btn small-btn" onClick={watchStorm}>Watch the whole storm</button> : null} />}
    </>
  )
}
