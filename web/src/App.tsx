import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, VELACHERY, prefersReducedMotion } from './config'
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
import type { Place } from './ui/Search'

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

  useEffect(() => {
    let alive = true
    const v = new MapView(mapEl.current!)
    Promise.all([loadRuns(), loadCurrent(), v.ready]).then(async ([r, c]) => {
      if (!alive) return
      setRuns(r)
      setCurrent(c)
      setMv(v)
      // the one orchestrated moment
      const sc = fromCurrent(c, r)
      const mix = new URLSearchParams(location.search).get('replay') ? [{ run: new URLSearchParams(location.search).get('replay')!, w: 1 }] : sc.mix
      v.water?.setRise(0)
      v.water?.setRain(mix.length ? 0.8 : 0)   // no rain on screen when the forecast is dry
      if (mix.length) await v.showMix(mix, 'max', 0)
      if (!alive) return
      // warm the answer while the camera flies: street tiles, parking, routing graph
      nearestSegment(VELACHERY[0], VELACHERY[1]).then((sg) => { if (sg && mix.length) segmentValues(sg, mix) }).catch(() => {})
      loadParking().catch(() => {})
      if (mix.length) loadGraph().catch(() => {})
      if (screenFromHash() === 'tonight') {
        await v.openingSequence(() => v.water?.setRise(1, prefersReducedMotion() ? 0 : 3200))
        await new Promise((res) => setTimeout(res, prefersReducedMotion() ? 0 : 300))
        setPlace((p) => p ?? { label: 'Velachery', lon: VELACHERY[0], lat: VELACHERY[1] })
      } else {
        v.water?.setRise(1)
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

  useEffect(() => {
    if (!mv) return
    const onTonight = screen === 'tonight'
    for (const id of ['street', 'here', 'parking', 'parking-label', 'route-safe', 'route-normal']) mv.setVisible(id, onTonight || id === 'route-safe')
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
      {mv && runs && scenario && !intro && (
        <>
          {screen === 'tonight' && <Tonight mv={mv} runs={runs} current={current} scenario={scenario} replayRun={replayRun}
            setReplayRun={setReplayRun} place={place} setPlace={setPlace} />}
          {screen === 'whatif' && <WhatIf mv={mv} runs={runs} />}
          {screen === 'proof' && <Proof mv={mv} />}
          {screen === 'hospitals' && <Hospitals mv={mv} runs={runs} />}
          {screen === 'about' && <About />}
          {screen === 'admin' && <Admin onDone={() => loadCurrent().then(setCurrent)} />}
          {screen !== 'proof' && screen !== 'about' && <Assistant place={place} scenario={scenario} />}
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
