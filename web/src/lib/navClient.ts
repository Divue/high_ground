// Main-thread side of the navigation worker (falls back to the main thread if workers fail).
import type { Step } from './directions'
import type { NavRequest, NavResult } from './nav'

export interface NavAnswer { res: NavResult; steps: Step[] }
let worker: Worker | null = null
let next = 0
const pending = new Map<number, { ok: (a: NavAnswer) => void; fail: (e: Error) => void }>()

export async function navigateAsync(req: NavRequest): Promise<NavAnswer> {
  try {
    if (!worker) {
      worker = new Worker(new URL('./nav.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<{ id: number; error?: string } & NavAnswer>) => {
        const p = pending.get(e.data.id)
        if (!p) return
        pending.delete(e.data.id)
        if (e.data.error) p.fail(new Error(e.data.error)); else p.ok({ res: e.data.res, steps: e.data.steps })
      }
    }
    const id = next++
    return await new Promise<NavAnswer>((ok, fail) => { pending.set(id, { ok, fail }); worker!.postMessage({ id, req }) })
  } catch {
    const [{ navigate, loadNav }, { directions }] = await Promise.all([import('./nav'), import('./directions')])
    const res = await navigate(req)
    return { res, steps: res.route && res.dest ? directions(await loadNav(), res.route, res.dest.name) : [] }
  }
}
