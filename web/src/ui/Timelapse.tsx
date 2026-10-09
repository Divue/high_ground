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
    ev.push({ hour: Math.max(1, hoursFrom(run.start_local, r.rising_from_local)), text: 'The Chembarambakkam release passes 10,000 cusecs where the Adyar enters the model (modelled from the CAG timeline).' })
    ev.push({ hour: Math.max(1, hoursFrom(run.start_local, r.peak_from_local)), text: `The release reaches its peak, ${r.peak_cusecs.toLocaleString('en-IN')} cusecs (modelled).` })
  }
  const w = run.wet_share_15cm_hourly
  if (w?.length) {
    const k = w.indexOf(Math.max(...w))
    ev.push({ hour: k + 1, text: `The most land under water in this storm: ${pct(w[k])} of the modelled area passes 15 cm.` })
  }
  let last = -1
  rain.forEach((r, i) => { if (r >= 1) last = i })
  if (last >= 0 && last + 2 <= run.hours) ev.push({ hour: last + 2, text: 'The rain stops. Water keeps moving downhill and draining to the sea.' })
  if (w?.length) ev.push({ hour: run.hours, text: `${run.hours} hours after the start, ${pct(w[w.length - 1])} of the land is still under 15 cm.` })
  // every caption carries its own time, so it never reads as a claim about a later hour
  const start = run.start_local
  return ev.sort((a, b) => a.hour - b.hour).map((e) => ({ ...e, text: start ? `${fmtShort(start, e.hour)}: ${e.text}` : e.text }))
}

export default function Timelapse({ run, hour, playing, onStop, onProof }: {
  run: RunInfo; hour: number; playing: boolean; onStop: () => void; onProof: (() => void) | null
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
          <span className="small muted">of the modelled land under 15 cm <span className="chip">from the model</span></span>
        </div>
      )}
      <p className="lapse-event" aria-live="polite">{now?.text ?? 'The storm is about to begin.'}</p>
      <div className="lapse-actions">
        {playing
          ? <button className="btn" onClick={onStop}>Stop</button>
          : <>
              <button className="btn" onClick={onStop}>Back to my street</button>
              {onProof && <button className="btn" onClick={onProof}>How we tested this</button>}
            </>}
      </div>
    </div>
  )
}
