// "Save for offline": stores what HighGround needs to keep answering with no network, for the
// places you save. The service worker (src/sw.ts) serves these files first, by their normal URLs.
//
// A pack holds: the basemap (zoom 14), the street answers for every modelled storm within
// `radiusKm` of each saved place, the road graph and its depths for every storm (routing works for
// any storm), hourly road depths for tonight's forecast, parking, hospitals, the place list and the
// latest forecast. Packs are versioned; a new version is downloaded beside the old one, which is
// removed only once the new one is complete.
import { DATA_BASE, REPLAYS } from '../config'
import { getJSON, loadCurrent, loadStreetIndex } from '../lib/data'
import { distM } from '../lib/geo'

export interface SavedPlace { label: string; lon: number; lat: number }
export interface PackRecord {
  version: string
  places: SavedPlace[]
  radiusKm: number
  savedAt: string
  files: number
  bytes: number
  forecastRuns: string[]
  persisted: boolean
}
interface Manifest {
  version: string
  core: { path: string; bytes: number; gz: number }[]
  hourly: Record<string, { path: string; bytes: number; gz: number }[]>
}

const REC = 'hg-pack-record'
const abs = (path: string) => new URL(`${DATA_BASE}/${path}`, window.location.href).href

export function packRecord(): PackRecord | null {
  try { return JSON.parse(localStorage.getItem(REC) ?? 'null') } catch { return null }
}
const writeRecord = (r: PackRecord | null) => {
  try { if (r) localStorage.setItem(REC, JSON.stringify(r)); else localStorage.removeItem(REC) } catch { /* private mode */ }
}

export const offlineSupported = () => 'serviceWorker' in navigator && 'caches' in window

/** Street tiles (2 km squares) that come within `radiusKm` of any place. */
async function streetTiles(places: SavedPlace[], radiusKm: number) {
  const idx = await loadStreetIndex()
  const near = (p: SavedPlace, [w, s, e, n]: [number, number, number, number]) => {
    const x = Math.min(Math.max(p.lon, w), e), y = Math.min(Math.max(p.lat, s), n)
    return distM(p.lon, p.lat, x, y) <= radiusKm * 1000 + 600
  }
  const tiles = Object.entries(idx.tile_bounds_lonlat).filter(([, b]) => places.some((p) => near(p, b))).map(([t]) => t)
  return { tiles, runs: idx.runs }
}

/** The file list and an estimated download size in bytes (gzipped where the server compresses). */
export async function planPack(places: SavedPlace[], radiusKm = 3) {
  const m = await getJSON<Manifest>('offline/manifest.json?hgpack=1', true)
  const cur = await loadCurrent()
  const forecastRuns = cur?.scenario ? [...new Set([cur.scenario.lower, cur.scenario.upper])] : []
  // hour-by-hour road depths for tonight's forecast and for the storms the replay buttons offer
  const hourlyRuns = [...new Set([...forecastRuns, ...REPLAYS.map((r) => r.run)])]
  const { tiles, runs } = await streetTiles(places, radiusKm)
  const files = [...m.core.map((f) => f.path), 'current.json', 'offline/manifest.json']
  for (const t of tiles) {
    files.push(`streets/geom/${t}.json`)
    for (const r of runs) files.push(`streets/${r}/${t}.json`)
  }
  for (const r of hourlyRuns) for (const f of m.hourly[r] ?? []) files.push(f.path)
  // street tiles average ~8 KB gzipped each (measured on the Michaung and 2015 runs); the rest is listed
  const est = m.core.reduce((a, f) => a + f.gz, 0) + tiles.length * (runs.length + 1) * 8_000
    + hourlyRuns.reduce((a, r) => a + (m.hourly[r] ?? []).reduce((b, f) => b + f.gz, 0), 0)
  return { version: m.version, files, estBytes: est, forecastRuns, tiles: tiles.length }
}

export interface Progress { done: number; total: number; bytes: number }

/** Downloads the pack; safe to call again to resume (files already saved are skipped). */
export async function savePack(places: SavedPlace[], onProgress: (p: Progress) => void, radiusKm = 3, signal?: AbortSignal): Promise<PackRecord> {
  const persisted = await navigator.storage?.persist?.().catch(() => false) ?? false
  const plan = await planPack(places, radiusKm)
  const name = `hg-pack-${plan.version}`
  const cache = await caches.open(name)
  let done = 0, bytes = 0
  const queue = [...plan.files]
  const total = queue.length
  onProgress({ done, total, bytes })
  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) throw new DOMException('stopped', 'AbortError')
      const path = queue.shift()!
      const key = abs(path)
      // the forecast is always refreshed; everything else is immutable within a version
      if (path !== 'current.json' && await cache.match(key)) { done++; onProgress({ done, total, bytes }); continue }
      let tries = 0
      for (;;) {
        try {
          const r = await fetch(`${key}?hgpack=1`, { cache: 'no-store', signal })
          if (!r.ok) throw new Error(`${r.status} ${path}`)
          const body = await r.blob()
          bytes += body.size
          await cache.put(key, new Response(body, { headers: { 'content-type': r.headers.get('content-type') ?? 'application/octet-stream' } }))
          break
        } catch (e) {
          if (signal?.aborted || ++tries >= 3) throw e
          await new Promise((res) => setTimeout(res, 800 * tries))
        }
      }
      done++
      onProgress({ done, total, bytes })
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  // complete: older versions can go now
  for (const n of await caches.keys()) if (n.startsWith('hg-pack-') && n !== name) await caches.delete(n)
  const rec: PackRecord = {
    version: plan.version, places, radiusKm, savedAt: new Date().toISOString(), files: total, bytes,
    forecastRuns: plan.forecastRuns, persisted: !!persisted,
  }
  writeRecord(rec)
  return rec
}

export async function removePack() {
  for (const n of await caches.keys()) if (n.startsWith('hg-pack-')) await caches.delete(n)
  writeRecord(null)
}

/** Space this site uses on the phone, and how much it may use. */
export async function storageUse(): Promise<{ usage: number; quota: number } | null> {
  const e = await navigator.storage?.estimate?.().catch(() => null)
  return e && e.quota ? { usage: e.usage ?? 0, quota: e.quota } : null
}

/** Is a newer pack version available? (Only checked while online.) */
export async function packOutdated(): Promise<boolean> {
  const rec = packRecord()
  if (!rec) return false
  try { return (await getJSON<Manifest>('offline/manifest.json?hgpack=1', true)).version !== rec.version } catch { return false }
}

export const fmtMB = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(b >= 1e7 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)
