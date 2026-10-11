// Navigation runs off the main thread: the map keeps drawing while routes are searched.
import { directions } from './directions'
import { leaveBy, loadNav, navigate, type NavRequest } from './nav'

type LeaveByReq = Parameters<typeof leaveBy>[0]

self.onmessage = async (e: MessageEvent<{ id: number; req: NavRequest; leaveBy?: LeaveByReq }>) => {
  const { id, req } = e.data
  try {
    if (e.data.leaveBy) {
      ;(self as unknown as Worker).postMessage({ id, leave: await leaveBy(e.data.leaveBy) })
      return
    }
    const res = await navigate(req)
    const steps = res.route && res.dest ? directions(await loadNav(), res.route, res.dest.name) : []
    ;(self as unknown as Worker).postMessage({ id, res, steps })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
