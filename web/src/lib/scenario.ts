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
      return [{ run: `design_${t[i]}_${tide}`, w: 1 - w }, { run: `design_${t[i + 1]}_${tide}`, w }]
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
  const mix = s.lower === s.upper ? [{ run: s.lower, w: 1 }] : [{ run: s.lower, w: 1 - s.w }, { run: s.upper, w: s.w }]
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

export function clockLabel(start: Date, hours: number): string {
  const t = new Date(start.getTime() + hours * 3600_000)
  return t.toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true }).replace(' ', ' ').toUpperCase()
}

export function mixDescription(mix: MixPart[], runs: Runs): string {
  if (mix.length === 1) return runs[mix[0].run]?.label ?? mix[0].run
  const [a, b] = mix
  return `blend of ${runs[a.run]?.total_mm} mm and ${runs[b.run]?.total_mm} mm runs`
}
