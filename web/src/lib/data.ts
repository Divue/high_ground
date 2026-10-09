// Loaders for model outputs. Everything the UI shows as a number comes through here.
import { API_BASE, DATA_BASE } from '../config'

const cache = new Map<string, Promise<unknown>>()

export function getJSON<T>(path: string, fresh = false): Promise<T> {
  const url = `${DATA_BASE}/${path}`
  if (!fresh && cache.has(url)) return cache.get(url) as Promise<T>
  const p = fetch(url, fresh ? { cache: 'no-store' } : undefined).then((r) => {
    if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`missing ${url}`)
    return r.json() as Promise<T>
  })
  if (!fresh) {
    cache.set(url, p)
    p.catch(() => cache.delete(url))
  }
  return p
}

export async function getBin(path: string): Promise<ArrayBuffer> {
  const key = `bin:${path}`
  if (!cache.has(key)) {
    cache.set(key, fetch(`${DATA_BASE}/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${path}`)
      return r.arrayBuffer()
    }))
  }
  return cache.get(key) as Promise<ArrayBuffer>
}

export async function postAPI<T>(path: string, body: unknown): Promise<T> {
  if (!API_BASE) throw new Error('offline')
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j as T
}

// ---------------------------------------------------------------- types
export interface RunInfo {
  label: string
  kind: 'design' | 'replay'
  total_mm: number
  tide: 'mean' | 'high'
  hours: number
  start_local: string | null
  rain_mm_h: number[]
  drainage_mm_h: number
  wet_share_15cm: number
  wet_share_15cm_hourly?: number[]     // share of modelled land >= 15 cm at each hour
  reservoir?: { peak_cusecs: number; peak_from_local: string; rising_from_local: string; note: string } | null
}
export type Runs = Record<string, RunInfo>

export interface WaterMeta {
  bbox_lonlat: [number, number, number, number]
  bbox_mercator: [number, number, number, number]
  width: number
  height: number
}

export interface Current {
  updated_at: string
  start_local: string
  forecast: { points: Record<string, { total_24h_mm: number; hourly_mm: number[] }>; mean_24h_mm: number; demo_override?: boolean }
  scenario: { lower: string; upper: string; w: number; tide: string } | null
  note?: string | null
}

export interface StreetIndex {
  tiles: string[]
  tile_bounds_lonlat: Record<string, [number, number, number, number]>
  runs: string[]
  series_bytes?: number
}
export interface StreetGeom { segs: [string, string, string, number, number[]][] }
export interface StreetVals { max: number[]; t15: number[]; series: string[] }

export interface Parking {
  note: string
  rule: Record<string, string>
  candidates: { id: string; kind: string; name: string; lon: number; lat: number; area?: number }[]
  dry: Record<string, number[]>
}

export interface Hospitals {
  rule: string
  hospitals: { id: string; name: string; lon: number; lat: number; node: number; beds?: string }[]
  runs: Record<string, { reach: number[]; share: number[]; cut_off: number }>
}

export const loadRuns = () => getJSON<Runs>('runs.json')
export const loadWaterMeta = () => getJSON<WaterMeta>('water/meta.json')
export const loadStreetIndex = () => getJSON<StreetIndex>('streets/index.json')
export const loadParking = () => getJSON<Parking>('parking.json')
export const loadHospitals = () => getJSON<Hospitals>('hospitals.json')
export const loadPlaces = () => getJSON<[string, number, number, string][]>('places.json')

export async function loadCurrent(): Promise<Current | null> {
  try {
    return await getJSON<Current>('current.json', true)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- images -> pixel arrays
// PNG decoding runs in a worker: getImageData on the main thread cost ~1 s in every 5 s while
// hourly frames preloaded, which dropped the map to ~10 fps.
type Decoded = { data: Uint8Array | Uint8ClampedArray; width: number; height: number }
let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { ok: (d: Decoded) => void; fail: (e: Error) => void }>()
function decode(path: string, gray: boolean): Promise<Decoded> {
  if (!worker) {
    worker = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; error?: string } & Decoded>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.error) p.fail(new Error(e.data.error))
      else p.ok(e.data)
    }
  }
  const id = nextId++
  const url = new URL(`${DATA_BASE}/${path}`, window.location.href).href
  return new Promise((ok, fail) => { pending.set(id, { ok, fail }); worker!.postMessage({ id, url, gray }) })
}

export async function loadPixels(path: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const key = `px:${path}`
  if (!cache.has(key)) {
    cache.set(key, decode(path, false))
    cache.get(key)!.catch(() => cache.delete(key))
  }
  return cache.get(key) as Promise<{ data: Uint8ClampedArray; width: number; height: number }>
}

/** Greyscale depth frame: only the red channel is kept (4x less memory than RGBA). */
export async function loadGray(path: string): Promise<Uint8Array> {
  const key = `gray:${path}`
  if (!cache.has(key)) {
    cache.set(key, decode(path, true).then((d) => d.data as Uint8Array))
    cache.get(key)!.catch(() => cache.delete(key))
  }
  return cache.get(key) as Promise<Uint8Array>
}
