// Live directions: follows your GPS along the route, one instruction at a time, in large type,
// with optional voice. Goes off the route by more than 50 m (30 m on foot) plus the GPS error for
// three fixes in a row and it plans again from where you are. "Preview the drive" moves a dot
// along the route instead of GPS (for a demo, or to see the way before you go).
// GPS works without mobile data. Web pages pause location when the screen is off, so the screen
// is kept on while this runs.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { prefersReducedMotion } from '../config'
import type { Step } from '../lib/directions'
import { distM, fmtDistance } from '../lib/geo'
import { MODES, type Mode } from '../lib/nav'
import type { MapView } from '../map/MapView'

interface Props {
  mv: MapView
  coords: [number, number][]
  steps: Step[]
  dest: string
  mode: Mode
  simulate: boolean
  onReroute: (from: { lon: number; lat: number }) => void
  onEnd: () => void
}

type WakeLockLike = { release: () => Promise<void> }

export default function NavLive({ mv, coords, steps, dest, mode, simulate, onReroute, onEnd }: Props) {
  const m = MODES[mode]
  // distance along the route of every vertex and of every instruction
  const cum = useMemo(() => {
    const c = [0]
    for (let i = 1; i < coords.length; i++) c.push(c[i - 1] + distM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]))
    return c
  }, [coords])
  const total = cum[cum.length - 1]
  const stepAt = useMemo(() => {
    let from = 0
    return steps.map((s) => {
      let best = from, bd = Infinity
      for (let i = from; i < coords.length; i++) {
        const d = distM(s.at[0], s.at[1], coords[i][0], coords[i][1])
        if (d < bd) { bd = d; best = i }
      }
      from = best
      return cum[best]
    })
  }, [steps, coords, cum])

  const [along, setAlong] = useState(0)
  const [acc, setAcc] = useState<number | null>(null)
  const [status, setStatus] = useState(simulate ? 'Preview' : 'Finding you…')
  const [voice, setVoice] = useState(() => 'speechSynthesis' in window)
  const [arrived, setArrived] = useState(false)
  const offCount = useRef(0)
  const spoken = useRef(new Set<string>())
  const idxRef = useRef(0)

  const say = (text: string, key: string) => {
    if (!voice || spoken.current.has(key) || !('speechSynthesis' in window)) return
    spoken.current.add(key)
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-IN'; u.rate = 1
    window.speechSynthesis.speak(u)
  }

  // the dot, the camera and the instruction for a position along the route
  const show = (pos: [number, number], a: number, heading: number | null) => {
    setAlong(a)
    mv.setGeoJSON('me', { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pos } })
    mv.map.easeTo({ center: pos, zoom: 16.4, bearing: heading ?? mv.map.getBearing(), pitch: mv.lite ? 0 : 50,
      duration: prefersReducedMotion() ? 0 : 900, easing: (t) => t, essential: true })
    // announcements: ~300 m and ~50 m before a turn in a vehicle; ~50 m and at the turn on foot
    const k = stepAt.findIndex((s, i) => i > 0 && s > a + 5)
    if (k > 0) {
      const d = stepAt[k] - a
      const far = mode === 'foot' ? 50 : 300, near = mode === 'foot' ? 12 : 50
      if (d <= far && d > near) say(`In ${fmtDistance(Math.round(d / 50) * 50 || 50)}, ${steps[k].text}`, `${k}f`)
      if (d <= near) say(steps[k].text, `${k}n`)
    }
    if (total - a < 30 && !arrived) { setArrived(true); say(`You have arrived at ${dest}`, 'arrive') }
  }

  // snap a fix to the route ahead of where we were
  const snap = (lon: number, lat: number) => {
    let best = { d: Infinity, a: 0, i: idxRef.current }
    for (let i = Math.max(0, idxRef.current - 3); i < Math.min(coords.length - 1, idxRef.current + 400); i++) {
      const [ax, ay] = coords[i], [bx, by] = coords[i + 1]
      const k = Math.cos((lat * Math.PI) / 180)
      const dx = (bx - ax) * k, dy = by - ay, L = dx * dx + dy * dy
      const t = L ? Math.max(0, Math.min(1, ((lon - ax) * k * dx + (lat - ay) * dy) / L)) : 0
      const px = ax + (bx - ax) * t, py = ay + (by - ay) * t
      const d = distM(lon, lat, px, py)
      if (d < best.d) best = { d, a: cum[i] + (cum[i + 1] - cum[i]) * t, i }
    }
    return best
  }

  // GPS
  useEffect(() => {
    if (simulate || !('geolocation' in navigator)) { if (!simulate) setStatus('This device has no location.'); return }
    const id = navigator.geolocation.watchPosition((p) => {
      const { longitude: lon, latitude: lat, accuracy } = p.coords
      setAcc(Math.round(accuracy))
      if (accuracy > 50) { setStatus('Weak GPS signal…'); return }
      setStatus('')
      const s = snap(lon, lat)
      const limit = (mode === 'foot' ? 30 : 50) + accuracy
      if (s.d > limit) {
        if (++offCount.current >= 3) { offCount.current = 0; setStatus('Off the route. Planning again from here…'); say('Off the route. Planning again.', `off${Date.now()}`); onReroute({ lon, lat }) }
        return
      }
      offCount.current = 0
      idxRef.current = s.i
      const h = coords[Math.min(s.i + 1, coords.length - 1)]
      const heading = Math.atan2((h[0] - coords[s.i][0]) * Math.cos((lat * Math.PI) / 180), h[1] - coords[s.i][1]) * 180 / Math.PI
      show([lon, lat], s.a, heading)
    }, () => setStatus('Location is off or not allowed. Turn it on to follow the route.'),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 })
    return () => navigator.geolocation.clearWatch(id)
  }, [simulate, coords]) // eslint-disable-line react-hooks/exhaustive-deps

  // preview: a dot travels the route at the mode's speed, four times faster
  useEffect(() => {
    if (!simulate) return
    let a = 0, last = performance.now(), raf = 0, lastShow = 0
    const tick = (t: number) => {
      a = Math.min(total, a + ((t - last) / 1000) * (m.kmh / 3.6) * 4)
      last = t
      if (t - lastShow > 450 || a >= total) {
        lastShow = t
        let i = cum.findIndex((c) => c >= a); if (i < 1) i = 1
        const f = (a - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-6)
        const pos: [number, number] = [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f]
        const heading = Math.atan2((coords[i][0] - coords[i - 1][0]) * Math.cos((pos[1] * Math.PI) / 180), coords[i][1] - coords[i - 1][1]) * 180 / Math.PI
        show(pos, a, heading)
      }
      if (a < total) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [simulate, coords]) // eslint-disable-line react-hooks/exhaustive-deps

  // keep the screen on while navigating (location stops when it turns off)
  useEffect(() => {
    let lock: WakeLockLike | null = null
    const get = () => (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> } }).wakeLock?.request('screen').then((l) => { lock = l }).catch(() => {})
    get()
    const vis = () => { if (document.visibilityState === 'visible') get() }
    document.addEventListener('visibilitychange', vis)
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release().catch(() => {}); window.speechSynthesis?.cancel(); mv.setGeoJSON('me', null) }
  }, [mv])

  const k = stepAt.findIndex((s, i) => i > 0 && s > along + 5)
  const next = arrived ? steps[steps.length - 1] : k > 0 ? steps[k] : steps[steps.length - 1]
  const toNext = arrived ? 0 : k > 0 ? stepAt[k] - along : total - along
  const left = Math.max(0, total - along)
  const mins = Math.max(1, Math.round(left / (m.kmh / 3.6) / 60))
  // a portal: the card's blur and animation would otherwise trap this fixed banner inside the card
  return createPortal(
    <div className="nav-live" role="region" aria-label="Directions">
      <div className="nav-next">
        <div className="nav-dist">{arrived ? 'Arrived' : fmtDistance(Math.max(0, toNext))}</div>
        <div className="nav-text">{arrived ? `You have arrived at ${dest}` : next.text}</div>
      </div>
      <div className="nav-meta small">
        {arrived ? null : <>{fmtDistance(left)} · about {mins} min left · </>}
        {simulate ? 'preview, not your location' : status || (acc ? `GPS ± ${acc} m` : '')}
      </div>
      <div className="nav-honest small">Model estimate, not a sighting. If you see water above your ankle, turn back.</div>
      <div className="row" style={{ marginTop: 8 }}>
        {'speechSynthesis' in window && <button className="btn small-btn" aria-pressed={voice} onClick={() => { setVoice(!voice); window.speechSynthesis.cancel() }}>{voice ? 'Voice on' : 'Voice off'}</button>}
        <button className="btn small-btn" onClick={onEnd}>End</button>
      </div>
    </div>,
    document.body,
  )
}
