// Main-thread side of the navigation worker (falls back to the main thread if workers fail).
import type { Step } from './directions'
import type { NavRequest, NavResult, NavRoute, Mode } from './nav'
import type { MixPart } from './scenario'

export interface NavAnswer { res: NavResult; steps: Step[] }
let worker: Worker | null = null
let next = 0
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pending = new Map<number, { ok: (a: any) => void; fail: (e: Error) => void }>()

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./nav.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; error?: string; leave?: LeaveBy } & NavAnswer>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.error) p.fail(new Error(e.data.error))
      else p.ok(e.data.leave ?? { res: e.data.res, steps: e.data.steps })
    }
  }
  return worker
}

export interface LeaveBy { leaveByHour: number | null; route: NavRoute | null; usual: NavRoute | null }
/** The card's "move your car by" decision, planned by the same router as the directions. */
export async function leaveByAsync(req: { from: [number, number]; to: [number, number]; mix: MixPart[]; until: number; mode: Mode }): Promise<LeaveBy> {
  try {
    const w = getWorker()
    const id = next++
    return await new Promise<LeaveBy>((ok, fail) => { pending.set(id, { ok, fail }); w.postMessage({ id, leaveBy: req }) })
  } catch {
    const { leaveBy } = await import('./nav')
    return leaveBy(req)
  }
}

export async function navigateAsync(req: NavRequest): Promise<NavAnswer> {
  try {
    const w = getWorker()
    const id = next++
    return await new Promise<NavAnswer>((ok, fail) => { pending.set(id, { ok, fail }); w.postMessage({ id, req }) })
  } catch {
    const [{ navigate, loadNav }, { directions }] = await Promise.all([import('./nav'), import('./directions')])
    const res = await navigate(req)
    return { res, steps: res.route && res.dest ? directions(await loadNav(), res.route, res.dest.name) : [] }
  }
}
