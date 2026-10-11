// "Save for offline" on the answer card: keeps this street (and up to two more places), the map
// and the routes on the phone, for when the power and the network go down.
import { useEffect, useState } from 'react'
import { fmtMB, offlineSupported, packOutdated, packRecord, planPack, removePack, savePack, storageUse, type PackRecord, type Progress, type SavedPlace } from '../offline/pack'

const MAX_PLACES = 3
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

export default function OfflineSave({ place, online }: { place: SavedPlace; online: boolean }) {
  const [rec, setRec] = useState<PackRecord | null>(() => packRecord())
  const [est, setEst] = useState<number | null>(null)
  const [prog, setProg] = useState<Progress | null>(null)
  const [err, setErr] = useState('')
  const [outdated, setOutdated] = useState(false)
  const [space, setSpace] = useState<{ usage: number; quota: number } | null>(null)
  const [ctl, setCtl] = useState<AbortController | null>(null)

  const here = rec?.places.some((p) => Math.abs(p.lon - place.lon) < 1e-4 && Math.abs(p.lat - place.lat) < 1e-4)
  const nextPlaces = here || !rec ? (rec?.places ?? [place]) : [...rec.places, place].slice(-MAX_PLACES)

  useEffect(() => {
    if (!online || !offlineSupported()) return
    let dead = false
    planPack(nextPlaces).then((p) => { if (!dead) setEst(p.estBytes) }).catch(() => {})
    packOutdated().then((o) => { if (!dead) setOutdated(o) })
    storageUse().then((s) => { if (!dead) setSpace(s) })
    return () => { dead = true }
  }, [online, place.lon, place.lat, rec?.version]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!offlineSupported()) return <p className="muted small">This browser cannot keep HighGround for offline use.</p>

  const run = async (places: SavedPlace[]) => {
    setErr('')
    const c = new AbortController()
    setCtl(c)
    try {
      const r = await savePack(places, setProg, 3, c.signal)
      setRec(r); setOutdated(false)
      storageUse().then(setSpace)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr('Saving stopped. Tap again to carry on from where it stopped.')
    } finally { setProg(null); setCtl(null) }
  }

  if (prog) {
    const pct = prog.total ? Math.round((100 * prog.done) / prog.total) : 0
    return (
      <div className="offline-save" aria-live="polite">
        <div className="small">Saving for offline… {fmtMB(prog.bytes)} <button className="linkbtn" onClick={() => ctl?.abort()}>Stop</button></div>
        <div className="lapse-progress"><i style={{ width: `${pct}%` }} /></div>
      </div>
    )
  }

  if (rec) {
    const when = new Date(rec.savedAt).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase().replace(/^(\w)(\w+)/, (_m, a, b) => a + b.toLowerCase())
    return (
      <div className="offline-save">
        <div className="small"><span className="saved-dot" />Saved for offline: {rec.places.map((p) => p.label).join(', ')} <span className="muted">· {when}</span></div>
        {!rec.persisted && <p className="muted small" style={{ margin: '2px 0 0' }}>The browser may clear it if the phone runs low on space.</p>}
        {isIOS() && !standalone() && <p className="muted small" style={{ margin: '2px 0 0' }}>On iPhone, add HighGround to your home screen to keep it saved.</p>}
        {online && (
          <div className="row" style={{ marginTop: 2 }}>
            {!here && rec.places.length < MAX_PLACES && <button className="linkbtn" style={{ paddingLeft: 0 }} onClick={() => run(nextPlaces)}>Add this street</button>}
            {outdated && <button className="linkbtn" onClick={() => run(rec.places)}>Update to the latest model</button>}
            <button className="linkbtn" onClick={async () => { await removePack(); setRec(null) }}>Remove</button>
          </div>
        )}
        {err && <p className="small" role="alert">{err}</p>}
      </div>
    )
  }

  return (
    <div className="offline-save">
      <button className="linkbtn" style={{ paddingLeft: 0 }} disabled={!online} onClick={() => run([place])}>Save for offline</button>
      <p className="muted small" style={{ margin: '2px 0 0' }}>
        {online
          ? <>Keeps this street, the map and routes that avoid flooded streets on your phone, for when the network goes down{est ? <>. About {fmtMB(est)}</> : null}.{space && space.quota < 200e6 ? ' Space on this phone is low.' : ''}</>
          : <>Connect once to save this street for offline use.</>}
      </p>
      {err && <p className="small" role="alert">{err}</p>}
    </div>
  )
}
