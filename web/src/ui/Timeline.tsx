import type { Runs } from '../lib/data'
import { clockLabel, type Scenario } from '../lib/scenario'

export default function Timeline({ scenario, runs, hour, setHour }: {
  scenario: Scenario; runs: Runs; hour: number; setHour: (h: number) => void
}) {
  const hours = scenario.hours
  // rain bars from the runs' own hyetographs (blended like the depths)
  const rain = new Array<number>(hours).fill(0)
  for (const { run, w } of scenario.mix) {
    runs[run]?.rain_mm_h.forEach((r, i) => { if (i < hours) rain[i] += w * r })
  }
  const maxR = Math.max(1, ...rain)
  const ticks = [0, Math.round(hours / 4), Math.round(hours / 2), Math.round((3 * hours) / 4), hours]
  return (
    <div className="timeline" aria-label="Storm timeline">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="now">{clockLabel(scenario.start, hour)}</span>
        <span className="muted small">{Math.round(rain[hour - 1] ?? 0)} mm of rain in this hour{scenario.kind === 'forecast' ? ' (modelled storm)' : ''}</span>
      </div>
      <div className="bars" aria-hidden>
        {rain.map((r, i) => <i key={i} className={i < hour ? 'on' : ''} style={{ height: `${Math.max(3, (r / maxR) * 100)}%` }} />)}
      </div>
      <input type="range" min={1} max={hours} step={1} value={hour} onChange={(e) => setHour(Number(e.target.value))}
        aria-label="Hour of the storm" />
      <div className="ticks">{ticks.map((t) => <span key={t}>{clockLabel(scenario.start, t)}</span>)}</div>
    </div>
  )
}
