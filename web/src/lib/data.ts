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
export async function loadPixels(path: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const key = `px:${path}`
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const blob = await fetch(`${DATA_BASE}/${path}`).then((r) => {
        // a dev server may answer a missing file with index.html (SPA fallback)
        if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`missing ${path}`)
        return r.blob()
      })
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = c.getContext('2d', { colorSpace: 'srgb' }) as OffscreenCanvasRenderingContext2D
      ctx.drawImage(bmp, 0, 0)
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height)
      return { data: img.data, width: bmp.width, height: bmp.height }
    })())
  }
  return cache.get(key) as Promise<{ data: Uint8ClampedArray; width: number; height: number }>
}

/** Greyscale depth frame: only the red channel is kept (4x less memory than RGBA). */
export async function loadGray(path: string): Promise<Uint8Array> {
  const key = `gray:${path}`
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const blob = await fetch(`${DATA_BASE}/${path}`).then((r) => {
        if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`missing ${path}`)
        return r.blob()
      })
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D
      ctx.drawImage(bmp, 0, 0)
      const rgba = ctx.getImageData(0, 0, bmp.width, bmp.height).data
      const out = new Uint8Array(bmp.width * bmp.height)
      for (let i = 0; i < out.length; i++) out[i] = rgba[4 * i]
      bmp.close()
      return out
    })())
    cache.get(key)!.catch(() => cache.delete(key))
  }
  return cache.get(key) as Promise<Uint8Array>
}
