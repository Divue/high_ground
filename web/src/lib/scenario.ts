// What the map and the answer card are showing: tonight's forecast blend, a replayed storm,
// or a what-if rainfall total. Every scenario resolves to a weighted mix of precomputed runs.
import { DESIGN_TOTALS } from '../config'
import type { Current, Runs } from './data'

export interface MixPart { run: string; w: number }

export interface Scenario {
  kind: 'forecast' | 'replay' | 'whatif' | 'dry'
  mix: MixPart[]
  label: string
  start: Date          // clock time of model hour 0
  hours: number
  forecastMm?: number
  tide?: 'mean' | 'high'
}

export function tonightAt6pm(now = new Date()): Date {
  const d = new Date(now)
  if (d.getHours() < 6) d.setDate(d.getDate() - 1)
  d.setHours(18, 0, 0, 0)
  return d
}

export function designMix(mm: number, tide: 'mean' | 'high'): MixPart[] {
  const t = DESIGN_TOTALS
  if (mm <= t[0]) return [{ run: `design_${t[0]}_${tide}`, w: 1 }]
  if (mm >= t[t.length - 1]) return [{ run: `design_${t[t.length - 1]}_${tide}`, w: 1 }]
  for (let i = 0; i < t.length - 1; i++) {
    if (mm >= t[i] && mm <= t[i + 1]) {
      const w = (mm - t[i]) / (t[i + 1] - t[i])
      // a run with no weight is never fetched (it may not even exist)
      return [{ run: `design_${t[i]}_${tide}`, w: 1 - w }, { run: `design_${t[i + 1]}_${tide}`, w }].filter((p) => p.w > 0)
    }
  }
  return [{ run: `design_200_${tide}`, w: 1 }]
}

export function fromCurrent(cur: Current | null, runs: Runs): Scenario {
  if (!cur || !cur.scenario) {
    return {
      kind: 'dry', mix: [], label: 'Tonight looks dry', start: tonightAt6pm(), hours: 12,
      forecastMm: cur?.forecast.mean_24h_mm,
    }
  }
  const s = cur.scenario
  const mix = s.lower === s.upper ? [{ run: s.lower, w: 1 }]
    : [{ run: s.lower, w: 1 - s.w }, { run: s.upper, w: s.w }].filter((p) => p.w > 0)
  return {
    kind: 'forecast', mix, start: new Date(cur.start_local), hours: runs[s.lower]?.hours ?? 30,
    label: `Tonight's forecast, about ${Math.round(cur.forecast.mean_24h_mm)} mm in 24 hours`,
    forecastMm: cur.forecast.mean_24h_mm, tide: 'mean',
  }
}

export function replay(run: string, runs: Runs): Scenario {
  const r = runs[run]
  return {
    kind: 'replay', mix: [{ run, w: 1 }], label: `Replay: ${r?.label ?? run}`, start: tonightAt6pm(),
    hours: r?.hours ?? 24,
  }
}

export function whatIf(mm: number, tide: 'mean' | 'high', runs: Runs): Scenario {
  const mix = designMix(mm, tide)
  return {
    kind: 'whatif', mix, label: `What if ${mm} mm fell in 24 hours`, start: tonightAt6pm(),
    hours: runs[mix[0].run]?.hours ?? 30, tide,
  }
}

export function clockLabel(start: Date, hours: number, withDay = hours > 12): string {
  const t = new Date(start.getTime() + hours * 3600_000)
  // minutes only when not on the hour (historical replays start at :30); U+00A0 so every font has the space
  const time = t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: t.getMinutes() ? '2-digit' : undefined, hour12: true })
    .replace(/\s+/g, '\u00a0').toUpperCase()
  return withDay ? `${t.toLocaleDateString('en-IN', { weekday: 'short' })} ${time}` : time
}

export function mixDescription(mix: MixPart[], runs: Runs): string {
  if (!mix.length) return ''
  if (mix.length === 1) return runs[mix[0].run]?.label ?? mix[0].run
  const [a, b] = mix
  return `blend of ${runs[a.run]?.total_mm} mm and ${runs[b.run]?.total_mm} mm runs`
}

/** Local wall-clock ISO string without a zone (what the Lambdas expect, like current.json). */
export function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
