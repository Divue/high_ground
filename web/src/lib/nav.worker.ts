// Navigation runs off the main thread: the map keeps drawing while routes are searched.
import { directions } from './directions'
import { loadNav, navigate, type NavRequest } from './nav'

self.onmessage = async (e: MessageEvent<{ id: number; req: NavRequest }>) => {
  const { id, req } = e.data
  try {
    const res = await navigate(req)
    const steps = res.route && res.dest ? directions(await loadNav(), res.route, res.dest.name) : []
    ;(self as unknown as Worker).postMessage({ id, res, steps })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
