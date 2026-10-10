// The hero flow: address -> fly to the street -> water rises to tonight's depth ->
// answer card (depth, time) -> nearest dry parking -> dry route -> email alerts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { REPLAYS, bandFor, prefersReducedMotion } from '../config'
import { loadGray, loadParking, type Current, type Parking, type Runs } from '../lib/data'
import { distM, fmtDistance } from '../lib/geo'
import { frameName } from '../lib/frames'
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
import { depthFeel } from '../lib/words'

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
  const [ansKey, setAnsKey] = useState('')        // place + storm the answer was computed for
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

  const nightKey = place ? `${place.lon},${place.lat}|${scenario.mix.map((m) => `${m.run}:${m.w}`).join()}` : ''
  // only an answer computed for this place AND this storm may drive the night (a storm switch used to
  // replay the previous storm's hours against the new answer, leaving the map empty)
  const fresh = !!ans && ansKey === nightKey
  const arrivedHere = !!place && arrived === `${place.lon},${place.lat}`
  // a run shorter than the last one: keep the hour inside it
  useEffect(() => { setHour((h) => Math.min(h, scenario.hours)) }, [scenario])

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
      setAnsKey(`${place.lon},${place.lat}|${scenario.mix.map((m) => `${m.run}:${m.w}`).join()}`)
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
  useEffect(() => {
    if (!place || !ans || !fresh || !scenario.mix.length || arrived !== `${place.lon},${place.lat}`) return
    const key = nightKey
    if (played.current === key) return
    played.current = key
    const peak = Math.min(ans.peakHour ?? 8, scenario.hours)
    const token = ++playToken.current
    if (prefersReducedMotion() || peak <= 1) { setHour(peak); setRising(false); return }
    const steps = Math.min(8, peak)
    const hours = Array.from({ length: steps }, (_, k) => Math.max(1, Math.round(((k + 1) * peak) / steps)))
    const stepMs = Math.round(3000 / steps)
    // arrival: a pulse where you landed, a slow orbit, and the night starts again at 6 PM
    mv.home = [place.lon, place.lat]
    mv.pulse([place.lon, place.lat])
    mv.settleOrbit()
    setRising(true)
    fadeMs.current = 500
    setHour(1)
    ;(async () => {
      // the keyframes decode in a worker while the water drains back to 6 PM
      await Promise.all([new Promise((r) => setTimeout(r, 600)),
        ...hours.flatMap((h) => scenario.mix.map(({ run }) => loadGray(`water/${run}/${frameName(h)}.png`).catch(() => null)))])
      if (playToken.current !== token) return
      for (const h of hours) {
        if (playToken.current !== token) return
        fadeMs.current = stepMs
        setHour(h)
        await new Promise((r) => setTimeout(r, stepMs))
      }
      fadeMs.current = 450
      if (playToken.current === token) setRising(false)
    })()
  }, [place, ans, ansKey, arrived, scenario])

  // the play button: step through the night from the hour shown
  const [playingNight, setPlayingNight] = useState(false)
  const playNight = async () => {
    if (playingNight) { playToken.current++; setPlayingNight(false); return }
    const token = ++playToken.current
    setPlayingNight(true); setRising(false)
    const start = hour >= scenario.hours ? 1 : hour
    for (let h = start; h <= scenario.hours; h++) {
      await Promise.all(scenario.mix.map(({ run }) => loadGray(`water/${run}/${frameName(h)}.png`).catch(() => null)))
      if (playToken.current !== token) return
      fadeMs.current = 320
      setHour(h)
      await new Promise((r) => setTimeout(r, 340))
    }
    fadeMs.current = 450
    if (playToken.current === token) setPlayingNight(false)
  }

  // scrubbing by hand stops the playback
  const scrub = useCallback((h: number) => {
    playToken.current++; fadeMs.current = 450; setHour(h); setRising(false); setPlayingNight(false)
    setLapse((l) => (l === 'playing' ? 'paused' : l))
    lapseFrom.current = h
  }, [])

  // "Watch the whole storm": a replay played hour by hour over a wide view of the city
  const [lapse, setLapse] = useState<'off' | 'playing' | 'paused' | 'done'>('off')
  const lapseRun = scenario.kind === 'replay' && scenario.mix.length === 1 ? scenario.mix[0].run : null
  useEffect(() => { setLapse('off'); setMorePark(false) }, [place, scenario])
  const lapseFrom = useRef(1)
  const watchStorm = async (from = 1) => {
    if (!lapseRun) return
    const token = ++playToken.current
    setLapse('playing')
    const H = scenario.hours
    const stepMs = prefersReducedMotion() ? 0 : Math.min(800, Math.max(450, Math.round(30000 / H)))
    // the city drains back to the start hour WHILE the camera pulls out, so the storm then only rises
    fadeMs.current = 1400
    setHour(from)
    if (from === 1) await mv.showWide()
    for (let h = from; h <= H; h++) {
      lapseFrom.current = h
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
  const pauseLapse = () => { playToken.current++; fadeMs.current = 450; setLapse('paused') }
  const resumeLapse = () => watchStorm(Math.min(lapseFrom.current + 1, scenario.hours))
  const endLapse = () => {
    playToken.current++
    fadeMs.current = 450
    setLapse('off')
    if (place) mv.flyTo([place.lon, place.lat])
    if (ans) setHour(ans.peakHour ?? hour)
  }

  // tap any street on the map: a quick look, and a way to make it your street
  useEffect(() => {
    if (!scenario.mix.length || lapse !== 'off') return
    const onClick = async (e: { lngLat: { lng: number; lat: number } }) => {
      const { lng, lat } = e.lngLat
      const sg = await nearestSegment(lng, lat).catch(() => null)
      if (!sg || sg.distanceM > 150) { mv.clearPeek(); return }
      const a = await segmentValues(sg, scenario.mix)
      mv.peek([lng, lat], { name: sg.name || 'Unnamed street', feel: depthFeel(a.maxCm), cm: a.maxCm,
        from: a.hoursTo15 ? clockLabel(scenario.start, a.hoursTo15) : null },
      () => setPlace({ label: sg.name || 'This street', lon: lng, lat }))
    }
    mv.map.on('click', onClick)
    mv.map.getCanvas().style.cursor = 'pointer'
    return () => { mv.map.off('click', onClick); mv.map.getCanvas().style.cursor = ''; mv.clearPeek() }
  }, [mv, scenario, lapse, setPlace])

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

  // every plan belongs to one place and one storm: a slow plan for the previous storm must never
  // overwrite the current one (QA: "move your car by 2 AM" on a street that floods at 9 PM)
  const routeToken = useRef(0)
  useEffect(() => {
    routeToken.current++
    setRoute(null)
    mv.setGeoJSON('route-normal', null)
    mv.drawLine('route-safe', null)
  }, [nightKey, mv])
  const showRoute = useCallback(async (o: ParkOpt) => {
    if (!place || !mv.meta || !fresh) return
    const token = ++routeToken.current
    setRouting(true)
    try {
      // Plan for the moment you leave: the last hour a dry route still exists, and never later
      // than the hour your own street passes 15 cm (in the first hour: before the rain starts).
      const streetFloods = !!ans?.hoursTo15
      const until = ans?.hoursTo15 ? Math.max(1, ans.hoursTo15 - 1) : (ans?.peakHour ?? Math.min(scenario.hours, 12))
      const plan = await leaveByPlan([place.lon, place.lat], [o.lon, o.lat], scenario.mix, until, 30)
      if (token !== routeToken.current) return
      const firstHour = ans?.hoursTo15 === 1
      setRoute({ normal: plan.normal, safe: plan.route, to: o.name, leaveBy: firstHour ? 0 : plan.leaveByHour, until, streetFloods })
      // the map stays at the peak the card describes; the leave-by hour is marked on the timeline
      mv.setGeoJSON('route-normal', plan.normal ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: plan.normal.coords } } : null)
      // the safe route draws itself from your street to the dry place
      mv.drawLine('route-safe', plan.route ? plan.route.coords as [number, number][] : null)
    } finally { if (token === routeToken.current) setRouting(false) }
  }, [place, scenario, mv, ans, fresh])

  // When the street floods, work out the decision straight away for the nearest dry parking
  const planned = useRef('')
  useEffect(() => {
    if (!fresh || !ans?.hoursTo15 || !park.length || !seg) return
    const key = `${seg.id}|${ans.hoursTo15}|${ans.maxCm}|${park[0].name}|${scenario.label}`
    if (planned.current === key) return
    planned.current = key
    showRoute(park[0])
  }, [ans, fresh, park, seg, scenario, showRoute])

  const atHour = ans?.seriesCm[hour - 1] ?? 0
  const band = ans ? bandFor(ans.maxCm) : null
  // while the night plays, the number is the model's depth at the hour shown; then it settles on the peak
  const shownCm = useTweened(ans ? (rising ? ans.seriesCm[hour - 1] ?? 0 : ans.maxCm) : 0, rising ? 320 : 0, nightKey)
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
          <Timelapse run={runs[lapseRun]} hour={hour} state={lapse} onBack={endLapse}
            onPause={pauseLapse} onResume={resumeLapse} onAgain={() => watchStorm(1)}
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

        {lapse === 'off' && place && scenario.mix.length > 0 && !arrivedHere && (
          <div className="flying" aria-live="polite">
            <div className="muted small">Going to</div>
            <div className="to">{place.label}</div>
            <div className="bar"><i /></div>
          </div>
        )}
        {lapse === 'off' && arrivedHere && fresh && seg && ans && band && scenario.mix.length > 0 && (
          <div className="reveal" key={nightKey}>
            <div className="street">{seg.name}{seg.bridge ? ' (on a bridge)' : ''}</div>
            <Readout cm={ans.maxCm} shown={shownCm} />
            <div className="feel">
              {depthFeel(shownCm)}{' '}
              <span className="when-word">{rising ? `at ${clockLabel(scenario.start, hour)}`
                : ans.maxCm >= 5 && ans.peakHour ? `at worst, ${clockLabel(scenario.start, ans.peakHour)}` : 'all night'}</span>
            </div>
            <div className="when">
              {ans.hoursTo15 ? <>Too deep for scooters from {clockLabel(scenario.start, ans.hoursTo15)}</> :
                ans.maxCm >= 5 ? <>Stays below scooter level</> : <>Your street stays dry</>}
            </div>
            {ans.preWet && ans.maxCm >= 5 && <p className="muted small" style={{ margin: '4px 0 0' }}>Low ground next to a canal: water already stands here before the rain.</p>}
            {ans.maxCm >= 5 && <DepthGlyph cm={shownCm} />}
            <div>
              <span className={`band ${band.code}`}>{band.label}</span>
              <span className="chip">from the model</span>
            </div>
            {ans.hoursTo15 && (
              <div className="decision" role="status">
                {routing && !route ? 'Working out when to move your car…'
                  : route?.safe && route.leaveBy === 0
                    ? ans.preWet
                      ? <>Water already stands here before the rain. Park at <b className="safe">{route.to}</b> instead.</>
                      : <>Floods in the first hour. Move your car to <b className="safe">{route.to}</b> before the rain starts, by <b>{clockLabel(scenario.start, 0)}</b>.</>
                  : route?.safe && route.leaveBy ? <>Move your car to <b className="safe">{route.to}</b> by <b>{clockLabel(scenario.start, route.leaveBy)}</b>.</>
                    : route ? (ans.hoursTo15 === 1
                      ? <>Water reaches scooter level here in the first hour, and no dry route to {route.to} stays open.</>
                      : <>No dry way out to {route.to} before your street floods.</>) : null}
              </div>
            )}
            {!rising && hour !== ans.peakHour && (
              <div className="muted small" style={{ marginTop: 6 }}>
                At {clockLabel(scenario.start, hour)}: {depthFeel(atHour).toLowerCase()} ({atHour} cm) · {mixDescription(scenario.mix, runs)}
              </div>
            )}
            {nearby && nearby.total > 0 && (
              <div className="small" style={{ marginTop: 6 }}>
                {nearby.wet} of {nearby.total} nearby streets too deep for scooters<span className="chip">model</span>
              </div>
            )}

            <div className="divider" />
            <h3>Dry places to park nearby</h3>
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
                {route.safe ? <>Your street stays passable. Dry route to {route.to}: {fmtDistance(route.safe.lengthM)}.</> : <>No practical dry route to {route.to} at the storm’s worst.</>}
              </p>
            )}
            {park.some((o) => o.kind === 'flyover') && <p className="muted small">Check local traffic advisories before parking on a flyover.</p>}
            <div className="divider" />
            <Subscribe lat={place!.lat} lon={place!.lon} street={seg.name} />
          </div>
        )}
        {!place && !dryTonight && <p className="muted" style={{ marginTop: 12 }}>Type your street to see how deep the water gets there tonight, when, and where to move your car.</p>}
        <div className="sticky-foot">
          <p className="muted small" style={{ margin: 0 }}>Not an official warning. Follow GCC and IMD advisories. In danger, call <span className="emergency">112</span>.</p>
        </div>
      </div>
      {scenario.mix.length > 0 && <Timeline runs={runs} hour={hour} setHour={scrub}
        // during the time-lapse the timeline shows the storm's real dates, like the caption card
        scenario={lapse !== 'off' && lapseRun && runs[lapseRun]?.start_local ? { ...scenario, start: new Date(runs[lapseRun].start_local!) } : scenario}
        marker={lapse === 'off' && route?.leaveBy && route.leaveBy > 0 && route.streetFloods ? { hour: route.leaveBy, label: `leave by ${clockLabel(scenario.start, route.leaveBy)}` } : null}
        action={<>
          {lapse === 'off' && <button className={`play${playingNight ? ' on' : ''}`} onClick={playNight}
            aria-label={playingNight ? 'Pause' : 'Play the night'} title={playingNight ? 'Pause' : 'Play the night'}>
            <svg viewBox="0 0 16 16" aria-hidden="true">{playingNight
              ? <path d="M4 3h3v10H4zM9 3h3v10H9z" /> : <path d="M4 2.5v11l9.5-5.5z" />}</svg>
          </button>}
          {lapseRun && lapse === 'off' && runs[lapseRun]?.wet_share_15cm_hourly
            ? <button className="btn small-btn" onClick={() => watchStorm(1)}>Watch the whole storm</button> : null}
        </>} />}
    </>
  )
}
