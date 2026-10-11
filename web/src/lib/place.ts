import { API_BASE } from '../config'
import type { Place } from '../ui/Search'
import { loadPlaces, postAPI } from './data'

interface GeoResp { source: string; results: { label: string; lon: number; lat: number }[] }

/** First match for a typed address: the address service when it is online, else OSM places and streets. */
export async function findPlace(q: string): Promise<Place | null> {
  const ql = q.trim().toLowerCase()
  if (ql.length < 3) return null
  if (API_BASE) {
    try {
      const r = await postAPI<GeoResp>('/geocode', { q })
      if (r.results.length) return r.results[0]
    } catch { /* fall back to local places */ }
  }
  const places = await loadPlaces().catch(() => [])
  const hit = places.filter(([n]) => n.toLowerCase().includes(ql))
    .sort((a, b) => (a[0].toLowerCase().startsWith(ql) ? 0 : 1) - (b[0].toLowerCase().startsWith(ql) ? 0 : 1) || a[0].length - b[0].length)[0]
  return hit ? { label: `${hit[0]}, Chennai`, lon: hit[1], lat: hit[2] } : null
}
