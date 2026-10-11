import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, REPLAYS, VELACHERY, motionChoice, prefersReducedMotion, setMotionChoice, systemReducesMotion } from './config'
import { loadCurrent, loadParking, loadRuns, postAPI, type Current, type Runs } from './lib/data'
import { loadGraph } from './lib/routing'
import { nearestSegment, segmentValues } from './lib/streets'
import { fromCurrent, replay } from './lib/scenario'
import { MapView } from './map/MapView'
import About from './screens/About'
import Hospitals from './screens/Hospitals'
import Proof from './screens/Proof'
import Tonight from './screens/Tonight'
import WhatIf from './screens/WhatIf'
import Assistant from './ui/Assistant'
import { Legend } from './ui/Legend'
import type { Place } from './ui/Search'
import { useOnline } from './offline/status'

type Screen = 'tonight' | 'whatif' | 'proof' | 'hospitals' | 'about' | 'admin'
const NAV: [Screen, string][] = [['tonight', 'Tonight'], ['whatif', 'What if'], ['proof', 'Proof'], ['hospitals', 'Hospitals'], ['about', 'About']]

function screenFromHash(): Screen {
  const h = window.location.hash.replace('#', '') as Screen
  return ['tonight', 'whatif', 'proof', 'hospitals', 'about', 'admin'].includes(h) ? h : 'tonight'
}

export default function App() {
  const mapEl = useRef<HTMLDivElement>(null)
  const [mv, setMv] = useState<MapView | null>(null)
  const [runs, setRuns] = useState<Runs | null>(null)
  const [current, setCurrent] = useState<Current | null>(null)
  const [screen, setScreen] = useState<Screen>(screenFromHash())
  const [replayRun, setReplayRun] = useState<string | null>(new URLSearchParams(location.search).get('replay'))
  const [place, setPlace] = useState<Place | null>(null)
  const [intro, setIntro] = useState(true)
  const online = useOnline()
  // battery saver: remembered; on by default when the app opens with no network
  const [lite, setLiteState] = useState(() => {
    try { const v = localStorage.getItem('hg-lite'); if (v) return v === 'on' } catch { /* private mode */ }
    return !navigator.onLine
  })
  const setLite = (on: boolean) => { setLiteState(on); try { localStorage.setItem('hg-lite', on ? 'on' : 'off') } catch { /* private mode */ } }
  useEffect(() => { mv?.setLite(lite) }, [mv, lite])
  // reduced motion: the device asked and the viewer has not chosen yet
  const [motionOffer, setMotionOffer] = useState(() => systemReducesMotion() && motionChoice() === null)
  useEffect(() => { document.documentElement.classList.toggle('reduce-motion', prefersReducedMotion()) }, [])
  // one line over the empty sky while Chennai loads; fades as the descent begins
  const [title, setTitle] = useState(() => {
    // a replay link names its storm straight away, before any data loads
    const rp = REPLAYS.find((x) => x.run === new URLSearchParams(location.search).get('replay'))
    return rp ? `Chennai, 6 PM. ${rp.label}, replayed as if it were tonight.` : 'Chennai, tonight.'
  })
  const [titleOn, setTitleOn] = useState(true)

  useEffect(() => {
    let alive = true
    const v = new MapView(mapEl.current!)
    Promise.all([loadRuns(), loadCurrent(), v.ready]).then(async ([r, c]) => {
      if (!alive) return
      // offline with no water saved: the low-power map shows depth on the streets instead
      if (v.waterMissing) setLiteState(true)
      v.setLite(v.waterMissing || lite)
      setRuns(r)
      setCurrent(c)
      setMv(v)
      // the one orchestrated moment
      const sc = fromCurrent(c, r)
      const mix = new URLSearchParams(location.search).get('replay') ? [{ run: new URLSearchParams(location.search).get('replay')!, w: 1 }] : sc.mix
      // the flight shows the city at 6 PM (hour 1); Tonight then plays the night to the street's peak
      v.water?.setRise(1)
      v.water?.setRain(mix.length ? 0.8 : 0)   // no rain on screen when the forecast is dry
      if (mix.length) await v.showMix(mix, 1, 0)
      if (!alive) return
      // warm the answer while the camera flies: street tiles, parking, routing graph
      nearestSegment(VELACHERY[0], VELACHERY[1]).then((sg) => { if (sg && mix.length) segmentValues(sg, mix) }).catch(() => {})
      loadParking().catch(() => {})
      if (mix.length) loadGraph().catch(() => {})
      const rp = REPLAYS.find((x) => x.run === mix[0]?.run && mix.length === 1)
      setTitle(rp ? `Chennai, 6 PM. ${rp.label}, replayed as if it were tonight.`
        : mix.length ? `Chennai, tonight. Forecast: about ${Math.round(c?.forecast.mean_24h_mm ?? 0)} mm of rain in the next 24 hours.`
        : 'Chennai, tonight. No heavy rain in the forecast.')
      if (screenFromHash() === 'tonight') {
        window.setTimeout(() => setTitleOn(false), prefersReducedMotion() ? 0 : 1800)
        // resolves about 2 s before the camera lands, so the water starts rising during the descent
        await v.openingSequence()
        setPlace((p) => p ?? { label: 'Velachery', lon: VELACHERY[0], lat: VELACHERY[1] })
      }
      setIntro(false)
    })
    const onHash = () => setScreen(screenFromHash())
    window.addEventListener('hashchange', onHash)
    return () => {
      alive = false
      window.removeEventListener('hashchange', onHash)
      v.map.remove()
    }
  }, [])

  const scenario = useMemo(() => {
    if (!runs) return null
    if (replayRun && runs[replayRun]) return replay(replayRun, runs)
    return fromCurrent(current, runs)
  }, [runs, current, replayRun])

  // battery saver draws the water on Tonight's streets only; other screens say the water layer is off
  useEffect(() => { mv?.setVisible('depth-streets', screen === 'tonight' && (lite || mv.waterMissing)) }, [mv, screen, lite])

  useEffect(() => {
    if (!mv) return
    const onTonight = screen === 'tonight'
    for (const id of ['street', 'here', 'parking', 'parking-label', 'route-safe', 'route-safe-casing', 'route-normal']) mv.setVisible(id, onTonight || id.startsWith('route-safe'))
    if (onTonight && place) mv.map.easeTo({ center: [place.lon, place.lat], zoom: 15, pitch: 62, duration: 1200 })
  }, [screen, mv]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (s: Screen) => { window.location.hash = s; setScreen(s) }

  return (
    <>
      <div ref={mapEl} className="map" aria-label="3D map of Chennai with floodwater" role="application" />
      <header className="topbar">
        <div className="brand">HighGround</div>
        <nav className="nav" aria-label="Screens">
          {NAV.map(([id, label]) => <button key={id} aria-current={screen === id ? 'page' : undefined} onClick={() => go(id)}>{label}</button>)}
        </nav>
      </header>
      {intro && !mv && <div className="loading" aria-live="polite"><span className="sr-only">Loading Chennai</span></div>}
      {intro && screen === 'tonight' && <p className={`intro-title${titleOn ? '' : ' out'}`} aria-live="polite">{title}</p>}
      {motionOffer && (
        <div className="motion-offer" role="dialog" aria-label="Animations">
          <span>Animations are off because your device asks for less motion.</span>
          <button className="btn primary small-btn" onClick={() => { setMotionChoice('on'); window.location.reload() }}>Play animations</button>
          <button className="btn small-btn" onClick={() => { setMotionChoice('off'); setMotionOffer(false) }}>Keep them off</button>
        </div>
      )}
      {mv && runs && scenario && !intro && (
        <>
          {screen === 'tonight' && <Tonight mv={mv} runs={runs} current={current} scenario={scenario} replayRun={replayRun}
            setReplayRun={setReplayRun} place={place} setPlace={setPlace} online={online} lite={lite} setLite={setLite} />}
          {lite && (screen === 'whatif' || screen === 'hospitals' || screen === 'proof') && (
            <div className="lite-note" role="status">
              <span>Battery saver is on, so the map shows no water here.</span>
              {!mv.waterMissing && <button className="btn small-btn" onClick={() => setLite(false)}>Show the water</button>}
            </div>
          )}
          {screen === 'whatif' && <WhatIf mv={mv} runs={runs} />}
          {screen === 'proof' && <Proof mv={mv} />}
          {screen === 'hospitals' && <Hospitals mv={mv} runs={runs} />}
          {screen === 'about' && <About />}
          {screen === 'admin' && <Admin onDone={() => loadCurrent().then(setCurrent)} />}
          {screen !== 'proof' && screen !== 'about' && online && <Assistant place={place} scenario={scenario} />}
          {(screen === 'tonight' || screen === 'whatif' || screen === 'hospitals') && <Legend lite={lite} />}
        </>
      )}
    </>
  )
}

function Admin({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('')
  const [mm, setMm] = useState('')
  const [out, setOut] = useState('')
  const run = async (force: boolean) => {
    setOut('Running…')
    try {
      const r = await postAPI<{ alerts_sent: number; subscribers: number; current: Current }>('/admin/run',
        { token, override_mm: mm ? Number(mm) : undefined, force_alert: force })
      setOut(`Forecast ${r.current.forecast.mean_24h_mm} mm → ${r.current.scenario ? `${r.current.scenario.lower} / ${r.current.scenario.upper}` : 'dry'}. ${r.alerts_sent} alert(s) sent to ${r.subscribers} subscriber(s).`)
      onDone()
    } catch (e) { setOut((e as Error).message) }
  }
  return (
    <div className="panel left">
      <h2>Admin</h2>
      <p className="muted small">Runs the forecast-check Lambda now (EventBridge Scheduler runs it every 3 hours). Leave rainfall empty to use the live Open-Meteo forecast; set it to simulate a forecast change for the demo.</p>
      {!API_BASE && <p className="small">The live service is not configured in this build.</p>}
      <input className="field" placeholder="Admin token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
      <input className="field" style={{ marginTop: 8 }} placeholder="Override 24-hour rainfall, mm (optional)" value={mm} onChange={(e) => setMm(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={() => run(false)}>Run now</button>
        <button className="btn" onClick={() => run(true)}>Run and send alerts</button>
      </div>
      {out && <p className="small" role="status">{out}</p>}
    </div>
  )
}
