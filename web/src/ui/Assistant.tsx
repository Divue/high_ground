import { useState } from 'react'
import { API_BASE } from '../config'
import { postAPI } from '../lib/data'
import { localIso, type Scenario } from '../lib/scenario'

interface Ans { answer: string; numbers: { value: string; grounded: boolean }[]; tools: { tool: string }[]; all_grounded: boolean }
interface Msg { who: 'user' | 'bot'; text: string; nums?: Ans['numbers']; tools?: string[] }

function Marked({ text, nums }: { text: string; nums?: Ans['numbers'] }) {
  if (!nums?.length) return <>{text}</>
  const grounded = new Map(nums.map((n) => [n.value, n.grounded]))
  const parts = text.split(/(\d+(?:[.,]\d+)?)/g)
  return (
    <>
      {parts.map((p, i) => {
        if (!grounded.has(p)) return <span key={i}>{p}</span>
        const ok = grounded.get(p)
        return <span key={i}><span className="num">{p}</span><span className={`chip${ok ? '' : ' bad'}`}>{ok ? 'from the model' : 'not in model output'}</span></span>
      })}
    </>
  )
}

export default function Assistant({ place, scenario }: {
  place: { label: string; lon: number; lat: number } | null; scenario: Scenario
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [log, setLog] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)

  if (!open) {
    return <div className="panel right collapsed" role="button" tabIndex={0} onClick={() => setOpen(true)}
      onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}><h2 style={{ margin: 0 }}>Ask HighGround</h2>
      <div className="muted small">Answers come only from the flood model</div></div>
  }

  const ask = async (question: string) => {
    if (!question.trim()) return
    setLog((l) => [...l, { who: 'user', text: question }])
    setQ('')
    setBusy(true)
    try {
      const sc = scenario.kind === 'replay' ? { run: scenario.mix[0].run, label: scenario.label, start_local: localIso(scenario.start) }
        : scenario.kind === 'whatif' ? (scenario.mix.length === 1 ? { run: scenario.mix[0].run, start_local: localIso(scenario.start) }
          : { lower: scenario.mix[0].run, upper: scenario.mix[1].run, w: scenario.mix[1].w, start_local: localIso(scenario.start) })
          : null
      const r = await postAPI<Ans>('/ask', { question, lat: place?.lat, lon: place?.lon, place: place?.label, scenario: sc })
      setLog((l) => [...l, { who: 'bot', text: r.answer, nums: r.numbers, tools: r.tools.map((t) => t.tool) }])
    } catch (e) {
      setLog((l) => [...l, { who: 'bot', text: !API_BASE ? 'The assistant needs the live service; this preview is offline.' : `Sorry, that failed: ${(e as Error).message}` }])
    } finally { setBusy(false) }
  }

  return (
    <div className="panel right assistant">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Ask HighGround</h2>
        <button className="btn" onClick={() => setOpen(false)} aria-label="Close assistant">Close</button>
      </div>
      <p className="muted small">It answers only from the model’s outputs and says so when it has no data. If water is entering a home or someone is trapped, call <span className="emergency">112</span> first.</p>
      <div className="log" aria-live="polite">
        {log.map((m, i) => (
          <div key={i} className={`msg ${m.who}`}>
            <Marked text={m.text} nums={m.nums} />
            {m.tools?.length ? <div className="muted small" style={{ marginTop: 4 }}>Used: {m.tools.join(', ')}</div> : null}
          </div>
        ))}
        {busy && <div className="msg bot muted">Checking the model…</div>}
      </div>
      {log.length === 0 && (
        <div className="seg" style={{ marginBottom: 8 }}>
          {['Will my street flood tonight?', 'Where can I park my car?', 'Which hospitals get cut off?'].map((s) =>
            <button key={s} onClick={() => ask(s)}>{s}</button>)}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); ask(q) }} className="row">
        <input className="field" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your street" aria-label="Question" />
        <button className="btn primary" disabled={busy}>Ask</button>
      </form>
    </div>
  )
}
