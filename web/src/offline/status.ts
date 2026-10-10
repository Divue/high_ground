// Is the network really there? navigator.onLine === false is reliable; true is not (captive
// portals, a tower with no backhaul). So we also probe the forecast file past the service worker.
import { useEffect, useState } from 'react'
import { DATA_BASE } from '../config'

async function probe(): Promise<boolean> {
  if (!navigator.onLine) return false
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 5000)
  try {
    const r = await fetch(new URL(`${DATA_BASE}/current.json?hgpack=1&t=${Date.now()}`, window.location.href).href,
      { cache: 'no-store', signal: ctl.signal })
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')
  } catch { return false } finally { clearTimeout(t) }
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    let alive = true
    const check = () => probe().then((ok) => { if (alive) setOnline(ok) })
    check()
    const id = window.setInterval(check, 60_000)
    const on = () => check()
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { alive = false; clearInterval(id); window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

/** "5:24 PM (6 h ago)" for the forecast's update time; `stale` after 6 h, `old` after 24 h. */
export function forecastAge(updatedAt: string | undefined, now = Date.now()) {
  if (!updatedAt) return null
  const t = new Date(updatedAt).getTime()
  if (!isFinite(t)) return null
  const h = (now - t) / 3600_000
  const time = new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s+/g, ' ').toUpperCase()
  const ago = h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`
  return { time, ago, hours: h, stale: h > 6, old: h > 24 }
}
