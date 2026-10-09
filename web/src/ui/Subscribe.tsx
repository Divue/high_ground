import { useState } from 'react'
import { API_BASE } from '../config'
import { postAPI } from '../lib/data'

const MSG: Record<string, string> = {
  confirmation_sent: 'Check your inbox and confirm the email from AWS Notifications. After that, we email you when this street’s risk changes.',
  pending_confirmation: 'You still need to confirm the first email we sent. Your street has been added.',
  subscribed: 'Done. We will email you when this street’s risk changes.',
}

export default function Subscribe({ lat, lon, street }: { lat: number; lon: number; street: string }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Email me if this changes</button>

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setState('busy')
    try {
      const r = await postAPI<{ status: string; street: string }>('/subscribe', { email, lat, lon })
      setState('ok')
      setMsg(MSG[r.status] ?? 'Subscribed.')
    } catch (err) {
      setState('err')
      setMsg(!API_BASE ? 'Alerts need the live service; this preview is offline.' : (err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} aria-label={`Email alerts for ${street}`}>
      <label className="muted small" htmlFor="email">Email alerts for {street}</label>
      <div className="row" style={{ marginTop: 6 }}>
        <input id="email" className="field" type="email" required placeholder="you@example.com" value={email}
          onChange={(e) => setEmail(e.target.value)} style={{ flex: 1 }} />
        <button className="btn primary" disabled={state === 'busy'}>{state === 'busy' ? 'Sending' : 'Subscribe'}</button>
      </div>
      {msg && <p className="small" role="status">{msg}</p>}
      <p className="muted small">SMS alerts are coming soon. Sending to Indian numbers needs TRAI DLT registration, which takes days.</p>
    </form>
  )
}
