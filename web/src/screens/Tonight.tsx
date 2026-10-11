// The hero flow: address -> fly to the street -> water rises to tonight's depth ->
// answer card (depth, time) -> nearest dry parking -> dry route -> email alerts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { REPLAYS, bandFor, prefersReducedMotion } from '../config'
import { loadGray, loadParking, type Current, type Parking, type Runs } from '../lib/data'
import { distM, fmtDistance } from '../lib/geo'
import { frameName } from '../lib/frames'
import type { Route } from '../lib/routing'
import { leaveByAsync } from '../lib/navClient'
import { clockLabel, mixDescription, type Scenario } from '../lib/scenario'
import { depthStreets, lastMissingTiles, namedPieces, nearbyShare, nearestSegment, segmentValues, type Segment, type StreetAnswer } from '../lib/streets'
import { forecastAge } from '../offline/status'
import HelpCard from '../ui/HelpCard'
import OfflineSave from '../ui/OfflineSave'
import PlanCard, { type PlanInput } from '../ui/PlanCard'
import GoPanel from '../ui/GoPanel'
import { packRecord } from '../offline/pack'
import type { DestKind, Mode } from '../lib/nav'

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
  online: boolean
  lite: boolean
  setLite: (on: boolean) => void
}

interface ParkOpt { name: string; kind: string; lon: number; lat: number; d: number }

export default function Tonight({ mv, runs, current, scenario, replayRun, setReplayRun, place, setPlace, online, lite, setLite }: Props) {
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
  const [stretches, setStretches] = useState<{ n: number; min: number; max: number } | null>(null)
  const flown = useRef<string>('')
  const [arrived, setArrived] = useState('')     // place key the camera has reached
  const played = useRef('')                       // place+scenario whose night has been played
  const playToken = useRef(0)
  const fadeMs = useRef(450)
  const [rising, setRising] = useState(false)    // the night is playing to the peak
  const [morePark, setMorePark] = useState(false)
  const [sheet, setSheet] = useState<'help' | 'plan' | null>(null)
  const [going, setGoing] = useState<null | { mode?: Mode; kind?: DestKind | 'target' }>(null)

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
      let s = await nearestSegment(place.lon, place.lat).catch(() => null)
      if (dead) return
      if (!s || s.distanceM > 600) {
        setSeg(null); setAns(null)
        const saved = packRecord()?.places.map((p) => p.label).join(', ')
        setError(!online && (lastMissingTiles > 0 || !s)
          ? `This street was not saved for offline use${saved ? ` (saved: ${saved})` : ''}. Connect to the internet to load it.`
          : 'No street within 600 m of that point in the area HighGround models. Try a nearby street name.')
        return
      }
      setSeg(s)
      mv.setGeoJSON('street', { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: s.coords } })
      mv.setGeoJSON('here', { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [place.lon, place.lat] } })
      if (!scenario.mix.length) { setAns(null); return }
      let a = await segmentValues(s, scenario.mix).catch(() => null)
      if (dead) return
      // a searched street name: answer for the street, i.e. its deepest stretch near here, and say so
      // (OSM splits streets into pieces; one piece can read 118 cm and the next 0 cm)
      setStretches(null)
      if (a && place.street && s.name.toLowerCase() === place.street.toLowerCase()) {
        const pieces = await namedPieces(s.name, place.lon, place.lat).catch(() => [] as Segment[])
        if (pieces.length > 1) {
          const vals = (await Promise.all(pieces.map((pc) => segmentValues(pc, scenario.mix).then((v) => ({ pc, v })).catch(() => null)))).filter(Boolean) as { pc: Segment; v: StreetAnswer }[]
          if (dead) return
          const deepest = vals.reduce((x, y) => (y.v.maxCm > x.v.maxCm ? y : x), vals[0])
          if (deepest && deepest.v.maxCm > a.maxCm) { s = deepest.pc; a = deepest.v; setSeg(s) }
          const cms = vals.map((x) => x.v.maxCm)
          setStretches({ n: vals.length, min: Math.min(...cms), max: Math.max(...cms) })
          mv.setGeoJSON('street', { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: s.coords } })
        }
      }
      if (!a) {
        setError(!online ? `${scenario.label.replace(/^Replay: /, '')}: this street's answers were not saved for offline use. Connect to load them, or switch back to a storm you saved.`
          : 'Could not load this street’s answers. Check the connection and try again.')
        return
      }
      setAns(a)
      setAnsKey(`${place.lon},${place.lat}|${scenario.mix.map((m) => `${m.run}:${m.w}`).join()}`)
      nearbyShare(place.lon, place.lat, scenario.mix).then((n) => { if (!dead) setNearby(n) }).catch(() => setNearby(null))
    })()
    return () => { dead = true }
  }, [place, scenario, mv, online])

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
  useEffect(() => { if (lapse !== 'off') setGoing(null) }, [lapse])
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
    // any real rain is visible; heavier hours get denser, brighter streaks
    mv.water?.setRain(lite || r < 0.5 ? 0 : 0.35 + 0.65 * Math.min(1, r / 20))
  }, [scenario, hour, runs, mv, lite])

  // battery saver / offline: the streets themselves carry the water, coloured by depth at the hour shown
  useEffect(() => {
    if (!(lite || mv.waterMissing) || !place || !scenario.mix.length) { mv.setGeoJSON('depth-streets', null); return }
    let dead = false
    depthStreets(place.lon, place.lat, scenario.mix, hour).then((fc) => { if (!dead) mv.setGeoJSON('depth-streets', fc) }).catch(() => {})
    return () => { dead = true }
  }, [lite, place, scenario, hour, mv])

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
      // planned by the navigation router (car, 20 cm, one hour ahead, one-way streets, underpasses closed)
      // so the card's decision and 'Take me there' always agree
      const lb = await leaveByAsync({ from: [place.lon, place.lat], to: [o.lon, o.lat], mix: scenario.mix, until, mode: 'car' })
      if (token !== routeToken.current) return
      const firstHour = ans?.hoursTo15 === 1
      const plan = { normal: lb.usual, route: lb.route }
      setRoute({ normal: lb.usual as unknown as Route, safe: lb.route as unknown as Route, to: o.name, leaveBy: firstHour ? 0 : lb.leaveByHour, until, streetFloods })
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

  const openGo = (o: { mode?: Mode; kind?: DestKind | 'target'; at?: number } = {}) => {
    playToken.current++; setRising(false)
    if (o.at) scrub(o.at)
    setGoing({ mode: o.mode, kind: o.kind })
  }
  const parkFor = (name: string | undefined) => park.find((x) => x.name === name)
  // leaving Take me to dry ground puts the card's own route back on the map
  useEffect(() => {
    if (going || !route) return
    mv.setGeoJSON('route-normal', route.normal ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.normal.coords } } : null)
    mv.setGeoJSON('route-safe', route.safe ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.safe.coords } } : null)
  }, [going]) // eslint-disable-line react-hooks/exhaustive-deps

  const atHour = ans?.seriesCm[hour - 1] ?? 0
  const band = ans ? bandFor(ans.maxCm) : null
  // while the night plays, the number is the model's depth at the hour shown; then it settles on the peak
  const shownCm = useTweened(ans ? (rising ? ans.seriesCm[hour - 1] ?? 0 : ans.maxCm) : 0, rising ? 320 : 0, nightKey)
  const dryTonight = scenario.kind === 'dry'
  const age = forecastAge(current?.updated_at)

  // the same decision as the card, as plain text for the flood plan
  const decisionText = !ans?.hoursTo15 || !route ? null
    : route.safe && route.leaveBy === 0
      ? ans.preWet ? `Water already stands here before the rain. Park at ${route.to} instead.`
        : `Floods in the first hour. Move your car to ${route.to} before the rain starts, by ${clockLabel(scenario.start, 0)}.`
      : route.safe && route.leaveBy ? `Move your car to ${route.to} by ${clockLabel(scenario.start, route.leaveBy)}.`
        : ans.hoursTo15 === 1 ? `Water reaches scooter level here in the first hour, and no way to ${route.to} avoids the water.`
          : `No way out to ${route.to} avoids the water before your street floods.`
  const planInput: PlanInput | null = place && seg && ans && fresh ? {
    street: seg.name, place: { lon: place.lon, lat: place.lat }, ans, scenario,
    forecastAt: scenario.kind === 'forecast' && age ? `${age.time}, ${new Date(current!.updated_at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}` : null,
    decision: decisionText,
    park: (route ? park.find((o) => o.name === route.to) : park[0]) ?? null,
    route: route?.safe ? { coords: route.safe.coords, edges: route.safe.edges, lengthM: route.safe.lengthM } : null,
  } : null

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
        {(!online || (age?.stale && scenario.kind !== 'replay')) && (
          <div className="offline-chip" role="status">
            {!online ? <><span className="off-dot" />Offline · </> : null}
            {age && scenario.kind !== 'replay' ? <>{!online ? 'forecast' : 'Forecast'} from {age.time} ({age.ago}).{age.stale ? ' May be out of date.' : ''}</> : null}
            {!online && scenario.kind === 'replay' ? (packRecord() ? `answers saved ${new Date(packRecord()!.savedAt).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/g, (m) => m.toUpperCase())}` : 'showing what this phone kept from before') : ''}
          </div>
        )}
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
        {lapse === 'off' && arrivedHere && fresh && seg && ans && band && scenario.mix.length > 0 && going && (
          <div className="reveal" key={`go-${nightKey}`}>
            <button className="linkbtn back" onClick={() => setGoing(null)}>Back to {seg.name} · {ans.maxCm} cm</button>
            <GoPanel mv={mv} from={{ lon: place!.lon, lat: place!.lat, label: seg.name }} scenario={scenario} hour={hour}
              saved={packRecord()?.places ?? []} initialMode={going.mode} initialKind={going.kind}
              preferred={route?.safe ? route.to : park[0]?.name}
              target={route?.safe && parkFor(route.to) ? { name: route.to, lon: parkFor(route.to)!.lon, lat: parkFor(route.to)!.lat, detail: parkFor(route.to)!.kind } : undefined}
              streetSeries={ans.seriesCm}
              onClose={() => setGoing(null)} />
          </div>
        )}
        {lapse === 'off' && arrivedHere && fresh && seg && ans && band && scenario.mix.length > 0 && !going && (
          <div className="reveal" key={nightKey}>
            <div className="street">{seg.name}{seg.bridge ? ' (on a bridge)' : ''}</div>
            {stretches && stretches.max - stretches.min >= 5 && (
              <div className="muted small">{stretches.n} stretches of this street near here reach {stretches.min}–{stretches.max} cm; the deepest is shown.</div>
            )}
            <Readout cm={ans.maxCm} shown={shownCm} />
            <div className="feel">
              {depthFeel(shownCm)}{' '}
              <span className="when-word">{rising ? `at ${clockLabel(scenario.start, hour)}`
                : ans.maxCm >= 5 && ans.peakHour ? `at worst, ${clockLabel(scenario.start, ans.peakHour)}` : 'all night'}</span>
              <span className="chip">from the model</span>
            </div>
            <div className="when">
              {ans.hoursTo15 ? <>Too deep for scooters from {clockLabel(scenario.start, ans.hoursTo15)}</> :
                ans.maxCm >= 5 ? <>Stays below scooter level</> : <>Your street stays dry</>}
            </div>
            {ans.preWet && ans.maxCm >= 5 && <p className="muted small" style={{ margin: '4px 0 0' }}>Low ground next to a canal: water already stands here before the rain.</p>}
            {ans.maxCm >= 5 && <DepthGlyph cm={shownCm} />}
            {ans.hoursTo15 && (
              <div className="decision" role="status">
                {routing && !route ? 'Working out when to move your car…'
                  : route?.safe && route.leaveBy === 0
                    ? ans.preWet
                      ? <>Water already stands here before the rain. Park at <b className="safe">{route.to}</b> instead.</>
                      : <>Floods in the first hour. Move your car to <b className="safe">{route.to}</b> before the rain starts, by <b>{clockLabel(scenario.start, 0)}</b>.</>
                  : route?.safe && route.leaveBy ? <>Move your car to <b className="safe">{route.to}</b>{parkFor(route.to) ? ` (${parkFor(route.to)!.kind}, ${fmtDistance(parkFor(route.to)!.d)})` : ''} by <b>{clockLabel(scenario.start, route.leaveBy)}</b>.</>
                    : route ? (ans.hoursTo15 === 1
                      ? <>Water reaches scooter level here in the first hour, and no way to {route.to} avoids the water.</>
                      : <>No way out to {route.to} avoids the water before your street floods.</>) : null}
                {route?.safe && (
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn primary small-btn" onClick={() => openGo({ mode: 'car', kind: 'target', at: route.leaveBy || undefined })}>Take me there</button>
                    <button className="linkbtn" onClick={() => openGo({})}>Other places and ways</button>
                  </div>
                )}
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
            {!(ans.hoursTo15 && route?.safe) && <h3>Dry places to park nearby</h3>}
            {park.length === 0 && <p className="muted small">No mapped flyover or parking ground near you stays dry in this scenario.</p>}
            {(ans.hoursTo15 && route?.safe ? (morePark ? park.filter((o) => o.name !== route.to).slice(0, 1) : []) : park.slice(0, morePark ? 2 : 1)).map((o) => (
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
              <button className="linkbtn" style={{ marginLeft: ans.hoursTo15 && route?.safe ? 0 : 22, paddingLeft: ans.hoursTo15 && route?.safe ? 0 : 6 }} onClick={() => setMorePark(true)}>1 more dry place nearby</button>
            )}
            {route && !route.streetFloods && (
              <p className="small muted" style={{ margin: '2px 0 6px' }}>
                {route.safe ? <>Your street stays passable. Route to {route.to} that avoids flooded streets: {fmtDistance(route.safe.lengthM)}.</> : <>No practical way to {route.to} avoids the water at the storm’s worst.</>}
              </p>
            )}
            {park.some((o) => o.kind === 'flyover') && <p className="muted small">Check local traffic advisories before parking on a flyover.</p>}
            {!(ans.hoursTo15 && route?.safe) && (
              <button className="btn primary" style={{ marginTop: 4 }} onClick={() => openGo({})}>Take me to dry ground</button>
            )}
            <div className="divider" />
            {online && <Subscribe lat={place!.lat} lon={place!.lon} street={seg.name} />}
            <div className="quiet-links">
              <button className="linkbtn" onClick={() => setSheet('plan')}>My flood plan</button>
              <OfflineSave place={{ label: seg.name, lon: place!.lon, lat: place!.lat }} online={online} />
            </div>
          </div>
        )}
        {!place && !dryTonight && <p className="muted" style={{ marginTop: 12 }}>Type your street to see how deep the water gets there tonight, when, and where to move your car.</p>}
        <div className="sticky-foot">
          <p className="muted small" style={{ margin: 0 }}>Not an official warning. Follow GCC and IMD advisories. In danger, call <a className="emergency" href="tel:112">112</a>.
            <button className="linkbtn" onClick={() => setSheet('help')}>Help numbers</button>
            <button className="linkbtn" aria-pressed={lite} onClick={() => setLite(!lite)}>{lite ? 'Battery saver on' : 'Battery saver'}</button>
          </p>
        </div>
      </div>
      {sheet === 'help' && <HelpCard onClose={() => setSheet(null)} street={seg?.name} fallback={place ?? undefined} />}
      {sheet === 'plan' && planInput && <PlanCard inp={planInput} onClose={() => setSheet(null)} />}
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
