// "Watch the whole storm": captions for a replay played hour by hour. Every number comes from
// runs.json (pipeline output): hourly rainfall, the hourly share of land under 15 cm, and the
// documented reservoir-release assumption.
import type { RunInfo } from '../lib/data'

const fmtClock = (start: string, h: number) => {
  const d = new Date(new Date(start).getTime() + h * 3.6e6)
  const day = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/,/g, '')
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toUpperCase()}`)
  return `${day}, ${time}`
}
const fmtShort = (start: string, h: number) => {
  const d = new Date(new Date(start).getTime() + h * 3.6e6)
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined }).replace(/\s+/g, '\u00a0').toUpperCase()
  return `${d.toLocaleDateString('en-IN', { weekday: 'short' })} ${time}`
}
const hoursFrom = (start: string, t: string) => Math.round((new Date(t).getTime() - new Date(start).getTime()) / 3.6e6)
const pct = (x: number) => `${Math.round(x * 100)}%`

export interface LapseEvent { hour: number; text: string }

export function lapseEvents(run: RunInfo): LapseEvent[] {
  const ev: LapseEvent[] = []
  const rain = run.rain_mm_h
  const first = rain.findIndex((r) => r >= 1)
  if (first >= 0) ev.push({ hour: first + 1, text: 'Rain begins.' })
  const heavy = rain.indexOf(Math.max(...rain))
  if (heavy >= 0) ev.push({ hour: heavy + 1, text: `${Math.round(rain[heavy])} mm fell in this one hour, the heaviest of this storm.` })
  if (run.reservoir && run.start_local) {
    const r = run.reservoir
    ev.push({ hour: Math.max(1, hoursFrom(run.start_local, r.rising_from_local)), text: 'Chembarambakkam reservoir starts releasing water down the Adyar (10,000 cusecs; timing from the CAG audit).' })
    ev.push({ hour: Math.max(1, hoursFrom(run.start_local, r.peak_from_local)), text: `The reservoir release peaks at ${r.peak_cusecs.toLocaleString('en-IN')} cusecs.` })
  }
  const w = run.wet_share_15cm_hourly
  if (w?.length) {
    const k = w.indexOf(Math.max(...w))
    ev.push({ hour: k + 1, text: `The worst hour: ${pct(w[k])} of the city is too deep for scooters.` })
  }
  let last = -1
  rain.forEach((r, i) => { if (r >= 1) last = i })
  if (last >= 0 && last + 2 <= run.hours) ev.push({ hour: last + 2, text: 'The rain stops. Water keeps moving downhill and draining to the sea.' })
  if (w?.length) ev.push({ hour: run.hours, text: `${run.hours} hours in, ${pct(w[w.length - 1])} of the city is still too deep for scooters.` })
  // every caption carries its own time, so it never reads as a claim about a later hour
  const start = run.start_local
  // events in the same hour share one caption (otherwise the later one hides the earlier)
  const merged: LapseEvent[] = []
  for (const e of ev.sort((a, b) => a.hour - b.hour)) {
    const last = merged[merged.length - 1]
    if (last && last.hour === e.hour) last.text = `${last.text} ${e.text}`
    else merged.push({ ...e })
  }
  return merged.map((e) => ({ ...e, text: start ? `${fmtShort(start, e.hour)}: ${e.text}` : e.text }))
}

export default function Timelapse({ run, hour, state, onBack, onPause, onResume, onAgain, onProof }: {
  run: RunInfo; hour: number; state: 'playing' | 'paused' | 'done' | 'off'
  onBack: () => void; onPause: () => void; onResume: () => void; onAgain: () => void; onProof: (() => void) | null
}) {
  const events = lapseEvents(run)
  const now = [...events].reverse().find((e) => e.hour <= hour)
  const w = run.wet_share_15cm_hourly?.[hour - 1]
  return (
    <div className="lapse">
      <div className="lapse-clock">{run.start_local ? fmtClock(run.start_local, hour) : `Hour ${hour}`}</div>
      {w !== undefined && (
        <div className="lapse-share">
          <span className="num">{pct(w)}</span>
          <span className="small muted">of the city too deep for scooters <span className="chip">from the model</span></span>
        </div>
      )}
      <div className="lapse-progress" aria-hidden="true"><i style={{ width: `${(100 * hour) / run.hours}%` }} /></div>
      <p className="lapse-event" aria-live="polite" key={now?.text}>{now?.text ?? 'The storm is about to begin.'}</p>
      <div className="lapse-actions">
        {state === 'playing' && <button className="btn" onClick={onPause}>Pause</button>}
        {state === 'paused' && <button className="btn primary" onClick={onResume}>Resume</button>}
        {state === 'done' && <button className="btn primary" onClick={onAgain}>Watch again</button>}
        <button className="btn" onClick={onBack}>Back to my street</button>
      </div>
      {state === 'done' && onProof && <button className="linkbtn" style={{ marginTop: 8 }} onClick={onProof}>How we tested this model against 2015</button>}
      {state !== 'done' && <p className="small muted" style={{ marginTop: 8 }}>Drag the timeline to any hour.</p>}
    </div>
  )
}
