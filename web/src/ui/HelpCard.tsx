// Help that works with no data at all: numbers to call, and your location as a message.
// Which channel survives in a Chennai flood (calls, SMS, data) is unpredictable, so we offer all of them.
import { useState } from 'react'

/** Checked 11 Oct 2026 against TNSDMA, GCC and TNPDCL sources (see docs/OFFLINE_AND_NAVIGATION_PLAN.md). */
export const HELP_NUMBERS: { n: string; tel: string; what: string; red?: boolean }[] = [
  { n: '112', tel: '112', what: 'Emergency: police, fire, ambulance', red: true },
  { n: '1913', tel: '1913', what: 'Greater Chennai Corporation: flooding, fallen trees' },
  { n: '1070', tel: '1070', what: 'Tamil Nadu emergency operations centre' },
  { n: '1077', tel: '1077', what: 'District emergency operations centre' },
  { n: '108', tel: '108', what: 'Ambulance' },
  { n: '101', tel: '101', what: 'Fire and rescue' },
  { n: '94987 94987', tel: '9498794987', what: 'Minnagam (power): fallen wires, flooded transformers' },
]

type Fix = { lat: number; lon: number; acc: number | null; gps: boolean }

export default function HelpCard({ onClose, street, fallback }: { onClose: () => void; street?: string; fallback?: { lon: number; lat: number } }) {
  const [fix, setFix] = useState<Fix | null>(null)
  const [state, setState] = useState<'idle' | 'finding' | 'ok' | 'err'>('idle')
  const [copied, setCopied] = useState(false)

  const locate = () => {
    setState('finding')
    if (!('geolocation' in navigator)) { fallBack(); return }
    // GPS works without mobile data; the first fix can take a while without it
    navigator.geolocation.getCurrentPosition(
      (p) => { setFix({ lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy), gps: true }); setState('ok') },
      () => fallBack(),
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 60_000 })
  }
  const fallBack = () => {
    if (fallback) { setFix({ lat: fallback.lat, lon: fallback.lon, acc: null, gps: false }); setState('ok') } else setState('err')
  }

  // plain characters only, so the SMS stays at 160 characters a part
  const text = fix ? [
    'I need help.',
    `My location: ${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}${fix.acc ? ` (within ${fix.acc} m)` : ''}`,
    street ? `Near ${street}, Chennai.` : 'Chennai.',
    `Map: https://maps.google.com/?q=${fix.lat.toFixed(5)},${fix.lon.toFixed(5)}`,
  ].join('\n') : ''

  const share = async () => { try { await navigator.share({ text }) } catch { /* cancelled */ } }
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setCopied(false) } }

  return (
    <div className="sheet" role="dialog" aria-label="Help numbers" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet-card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Help</h2>
          <button className="btn small-btn" onClick={onClose}>Close</button>
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>These work without mobile data if calls get through. If water is rising inside your home or someone is trapped, call 112 first.</p>
        <ul className="numbers">
          {HELP_NUMBERS.map((h) => (
            <li key={h.n}>
              <a href={`tel:${h.tel}`} className={h.red ? 'emergency' : ''}>{h.n}</a>
              <span>{h.what}</span>
            </li>
          ))}
        </ul>
        <div className="divider" />
        <h3 style={{ marginTop: 0 }}>Send my location</h3>
        {state === 'idle' && <button className="btn" onClick={locate}>Find my location</button>}
        {state === 'finding' && <p className="small">Finding you… GPS works without mobile data, but the first fix can take a minute outdoors.</p>}
        {state === 'err' && <p className="small">Could not find your location. Allow location for this site, or describe the nearest landmark when you call.</p>}
        {state === 'ok' && fix && (
          <>
            {!fix.gps && <p className="muted small">GPS did not answer, so this is the street you chose, not where you are.</p>}
            <pre className="msg">{text}</pre>
            <div className="row">
              <a className="btn primary" href={`sms:?&body=${encodeURIComponent(text)}`}>SMS</a>
              <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp</a>
              {'share' in navigator && <button className="btn" onClick={share}>Share</button>}
              <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
          </>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>Numbers checked on 11 Oct 2026. HighGround is not an emergency service and does not send this for you.</p>
      </div>
    </div>
  )
}
