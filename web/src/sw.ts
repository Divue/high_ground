/// <reference lib="webworker" />
// HighGround's service worker: the app opens with no network, and model data comes from the phone.
//  - the app shell (JS, CSS, fonts, map glyphs and icons) is precached at install
//  - 'hg-pack-<version>': files saved by "Save for offline" (src/offline/pack.ts), served first
//  - 'hg-seen': model data you looked at while online, kept so it also works offline (best effort)
//  - current.json (the 3-hourly forecast) is network-first with a short timeout, then the saved copy
//  - the basemap is read in byte ranges; a saved copy answers them with 206 slices
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheExpiration } from 'workbox-expiration'
import { createPartialResponse } from 'workbox-range-requests'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

const SEEN = 'hg-seen'
const DATA = new URL((import.meta.env.VITE_DATA_BASE as string | undefined) ?? '/data', self.location.origin).href.replace(/\/$/, '')
const seenExpiry = new CacheExpiration(SEEN, { maxEntries: 900, maxAgeSeconds: 30 * 24 * 3600 })

const keyOf = (u: URL) => u.origin + u.pathname
const offline = () => new Response('offline', { status: 503, headers: { 'content-type': 'text/plain' } })

// saved packs first (any version still on the phone), then what you looked at
async function fromCaches(key: string): Promise<Response | undefined> {
  const names = (await caches.keys()).filter((n) => n.startsWith('hg-pack-')).reverse()
  for (const n of [...names, SEEN]) {
    const r = await (await caches.open(n)).match(key)
    if (r) return r
  }
  return undefined
}

async function remember(key: string, res: Response) {
  if (!res.ok || res.status !== 200 || res.type === 'opaque') return
  const c = await caches.open(SEEN)
  await c.put(key, res)
  await seenExpiry.updateTimestamp(key)
  seenExpiry.expireEntries().catch(() => {})
}

async function withTimeout(req: Request, ms: number): Promise<Response> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try { return await fetch(req, { signal: ctl.signal }) } finally { clearTimeout(t) }
}

async function handleData(event: FetchEvent, url: URL): Promise<Response> {
  const req = event.request
  const key = keyOf(url)
  // the pack downloader asks for the network copy explicitly
  if (url.searchParams.has('hgpack')) return fetch(req)

  // basemap byte ranges: answer from the saved file when there is one
  const range = req.headers.get('range')
  if (range) {
    const full = await fromCaches(key)
    if (full) return createPartialResponse(req, full)
    try { return await fetch(req) } catch { return offline() }
  }

  // the forecast: fresh if the network answers within 4 s, else the last saved copy
  if (url.pathname.endsWith('/current.json')) {
    try {
      const r = await withTimeout(req, 4000)
      if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) {
        event.waitUntil(remember(key, r.clone()))
        return r
      }
    } catch { /* offline or too slow */ }
    return (await fromCaches(key)) ?? offline()
  }

  const hit = await fromCaches(key)
  if (hit) {
    // small JSON is refreshed in the background when the network is up; images and binaries are immutable
    if (url.pathname.endsWith('.json')) event.waitUntil(fetch(req).then((r) => remember(key, r)).catch(() => {}))
    return hit
  }
  try {
    const r = await fetch(req)
    if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) event.waitUntil(remember(key, r.clone()))
    return r
  } catch { return offline() }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (!url.href.startsWith(DATA + '/')) return
  event.respondWith(handleData(event, url))
})

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting() })
