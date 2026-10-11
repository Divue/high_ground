// "My flood plan": the answer for one street as an image and as plain text, to keep in the
// gallery or send to the family group. It works with no app and no network once saved.
// Every number comes from the model files, exactly as on the answer card.
import { useEffect, useRef, useState } from 'react'
import { TOKENS } from '../config'
import { getJSON, loadHospitals } from '../lib/data'
import { distM, fmtDistance } from '../lib/geo'
import { clockLabel, type Scenario } from '../lib/scenario'
import type { StreetAnswer } from '../lib/streets'
import { depthFeel } from '../lib/words'

export interface PlanInput {
  street: string
  place: { lon: number; lat: number }
  ans: StreetAnswer
  scenario: Scenario
  forecastAt: string | null          // "5:24 PM, Sun 11 Oct" when the scenario is the live forecast
  decision: string | null            // "Move your car to X by 8 PM", as on the card
  park: { name: string; kind: string; d: number } | null
  route: { coords: [number, number][]; edges: number[]; lengthM: number } | null
}

// plain characters only: curly quotes, dashes and no-break spaces turn an SMS into 70-character parts
const plain = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ').replace(/…/g, '...')

async function routeNames(edges: number[]): Promise<string[]> {
  const names = await getJSON<string[]>('graph/names.json').catch(() => null)
  if (!names) return []
  const out: string[] = []
  for (const e of edges) {
    const n = names[e]
    if (n && out[out.length - 1] !== n && !out.includes(n)) out.push(n)
  }
  return out.slice(0, 5)
}

async function nearestHospital(p: { lon: number; lat: number }, scenario: Scenario) {
  const h = await loadHospitals().catch(() => null)
  if (!h || !scenario.mix.length) return null
  const dom = [...scenario.mix].sort((a, b) => b.w - a.w)[0].run
  const reach = h.runs[dom]?.reach
  if (!reach) return null
  const best = h.hospitals.map((x, i) => ({ ...x, d: distM(p.lon, p.lat, x.lon, x.lat), ok: reach[i] === 1 }))
    .filter((x) => x.ok).sort((a, b) => a.d - b.d)[0]
  return best ? { name: best.name, d: best.d } : null
}

function lines(inp: PlanInput, names: string[], hosp: { name: string; d: number } | null) {
  const { ans, scenario } = inp
  const worst = ans.maxCm >= 5 && ans.peakHour
    ? `${depthFeel(ans.maxCm)} (${ans.maxCm} cm) at worst, around ${clockLabel(scenario.start, ans.peakHour)}`
    : 'Stays dry all night'
  const scooters = ans.hoursTo15 ? `Too deep for scooters from ${clockLabel(scenario.start, ans.hoursTo15)}` : ans.maxCm >= 5 ? 'Stays below scooter level' : null
  const scen = scenario.kind === 'replay' ? `${scenario.label.replace(/^Replay: /, '')}, replayed as if it were tonight`
    : inp.forecastAt ? `Forecast from ${inp.forecastAt}` : scenario.label
  const park = inp.park ? `Dry parking: ${inp.park.name} (${inp.park.kind}), ${fmtDistance(inp.park.d)}` : null
  const via = names.length ? `Route there avoids streets the model expects to flood: via ${names.join(', ')}` : inp.route ? `Route there: ${fmtDistance(inp.route.lengthM)}` : null
  const hos = hosp ? `Nearest hospital cars can still reach: ${hosp.name}, ${fmtDistance(hosp.d)}` : null
  return { worst, scooters, scen, park, via, hos }
}

export function planText(inp: PlanInput, names: string[], hosp: { name: string; d: number } | null): string {
  const l = lines(inp, names, hosp)
  return plain([
    `HighGround flood plan: ${inp.street}`,
    l.scen,
    l.worst + '.',
    l.scooters ? l.scooters + '.' : null,
    inp.decision ? inp.decision : null,
    l.park,
    l.via,
    l.hos,
    'Emergency 112. GCC 1913. Fallen power lines 94987 94987.',
    'Model estimate, not an official warning. Never walk, ride or drive into floodwater.',
  ].filter(Boolean).join('\n'))
}

async function drawPlan(cv: HTMLCanvasElement, inp: PlanInput, names: string[], hosp: { name: string; d: number } | null) {
  const W = 1080, H = 1500
  cv.width = W; cv.height = H
  const g = cv.getContext('2d')!
  await Promise.all(['600 64px "Anek Latin Variable"', '400 34px Hind', '600 34px Hind'].map((f) => document.fonts.load(f).catch(() => null)))
  const head = (w: number, px: number) => `${w} ${px}px "Anek Latin Variable", "Anek Latin", sans-serif`
  const body = (w: number, px: number) => `${w} ${px}px Hind, sans-serif`
  g.fillStyle = '#050D12'; g.fillRect(0, 0, W, H)
  const X = 72
  let y = 96
  const wrap = (text: string, font: string, color: string, lh: number, maxW = W - 2 * X) => {
    g.font = font; g.fillStyle = color
    const words = text.split(' ')
    let line = ''
    for (const w of words) {
      const t = line ? `${line} ${w}` : w
      if (g.measureText(t).width > maxW && line) { g.fillText(line, X, y); y += lh; line = w } else line = t
    }
    if (line) { g.fillText(line, X, y); y += lh }
  }
  const l = lines(inp, names, hosp)
  wrap('HighGround · my flood plan', body(500, 30), '#8FA2AA', 44)
  y += 18
  wrap(inp.street, head(640, 66), '#D6E0E4', 72)
  wrap(l.scen, body(400, 30), '#8FA2AA', 42)
  y += 30
  // the depth, big, in the water colour
  g.font = head(700, 150); g.fillStyle = inp.ans.maxCm >= 30 ? TOKENS.shallow : '#D6E0E4'
  g.fillText(`${inp.ans.maxCm}`, X, y + 110)
  const nw = g.measureText(`${inp.ans.maxCm}`).width
  g.font = head(500, 54); g.fillStyle = '#8FA2AA'; g.fillText('cm', X + nw + 14, y + 110)
  y += 160
  wrap(l.worst, body(500, 36), '#D6E0E4', 48)
  if (l.scooters) wrap(l.scooters, body(400, 34), '#D6E0E4', 48)
  y += 20
  if (inp.decision) {
    // the decision in a box; amber only for the dry place (the design rule)
    y += 24
    const top = y - 50
    wrap(inp.decision, body(600, 38), TOKENS.amber, 52, W - 2 * X - 40)
    g.strokeStyle = 'rgba(214,224,228,0.35)'; g.lineWidth = 2
    g.strokeRect(X - 20, top, W - 2 * X + 40, y - top - 22)
    y += 34
  }
  if (l.park) wrap(l.park, body(400, 32), '#D6E0E4', 44)
  // the route as a schematic line (no map tiles needed)
  if (inp.route && inp.route.coords.length > 1) {
    const box = { x: X, y: y + 10, w: W - 2 * X, h: 300 }
    g.strokeStyle = 'rgba(214,224,228,0.14)'; g.lineWidth = 2; g.strokeRect(box.x, box.y, box.w, box.h)
    const xs = inp.route.coords.map((c) => c[0]), ys = inp.route.coords.map((c) => c[1])
    const k = Math.cos((ys[0] * Math.PI) / 180)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const sx = (box.w - 80) / Math.max((maxX - minX) * k, 1e-6), sy = (box.h - 80) / Math.max(maxY - minY, 1e-6)
    const s = Math.min(sx, sy)
    const ox = box.x + (box.w - (maxX - minX) * k * s) / 2, oy = box.y + (box.h + (maxY - minY) * s) / 2
    const P = (c: [number, number]) => [ox + (c[0] - minX) * k * s, oy - (c[1] - minY) * s]
    g.strokeStyle = TOKENS.amber; g.lineWidth = 7; g.lineJoin = 'round'; g.lineCap = 'round'
    g.beginPath(); inp.route.coords.forEach((c, i) => { const [px, py] = P(c); if (i) g.lineTo(px, py); else g.moveTo(px, py) }); g.stroke()
    const [ax, ay] = P(inp.route.coords[0]), [bx, by] = P(inp.route.coords[inp.route.coords.length - 1])
    g.fillStyle = '#D6E0E4'; g.beginPath(); g.arc(ax, ay, 12, 0, 7); g.fill()
    g.fillStyle = TOKENS.amber; g.beginPath(); g.arc(bx, by, 14, 0, 7); g.fill()
    g.font = body(500, 26); g.fillStyle = '#8FA2AA'
    // label beside the start dot, on whichever side has room
    const right = ax < box.x + box.w - 170
    g.textAlign = right ? 'left' : 'right'
    g.fillText('your street', ax + (right ? 20 : -20), Math.min(ay + 34, box.y + box.h - 12))
    g.textAlign = 'left'
    y = box.y + box.h + 50
    if (l.via) wrap(l.via, body(400, 28), '#8FA2AA', 38)
  }
  if (l.hos) { y += 6; wrap(l.hos, body(400, 32), '#D6E0E4', 44) }
  // emergency numbers; red only for 112
  y = Math.max(y + 20, H - 230)
  g.font = body(600, 40); g.fillStyle = '#E5484D'; g.fillText('112', X, y)
  const w112 = g.measureText('112').width
  g.font = body(400, 30); g.fillStyle = '#D6E0E4'
  g.fillText('emergency  ·  1913 GCC  ·  94987 94987 fallen power lines', X + w112 + 18, y)
  y += 64
  wrap('Model estimate, not an official warning. Never walk, ride or drive into floodwater. Follow GCC and IMD advisories.', body(400, 26), '#8FA2AA', 36)
}

export default function PlanCard({ inp, onClose }: { inp: PlanInput; onClose: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const [text, setText] = useState('')
  const [img, setImg] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  useEffect(() => {
    let dead = false
    ;(async () => {
      const [names, hosp] = await Promise.all([inp.route ? routeNames(inp.route.edges) : Promise.resolve([]), nearestHospital(inp.place, inp.scenario)])
      if (dead || !cv.current) return
      setText(planText(inp, names, hosp))
      await drawPlan(cv.current, inp, names, hosp)
      if (dead) return
      cv.current.toBlob((b) => {
        if (!b || dead) return
        setImg(URL.createObjectURL(b))
        setFile(new File([b], `highground-plan-${inp.street.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`, { type: 'image/png' }))
      }, 'image/png')
    })()
    return () => { dead = true }
  }, [inp])
  useEffect(() => () => { if (img) URL.revokeObjectURL(img) }, [img])

  const canShareFile = !!file && 'canShare' in navigator && navigator.canShare({ files: [file] })
  const shareImage = async () => { if (file) try { await navigator.share({ files: [file], title: 'My flood plan', text: `HighGround flood plan: ${inp.street}` }) } catch { /* cancelled */ } }
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setCopied(false) } }

  return (
    <div className="sheet" role="dialog" aria-label="My flood plan" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet-card wide">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>My flood plan</h2>
          <button className="btn small-btn" onClick={onClose}>Close</button>
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>Keep it in your gallery or send it to your family. It works without the app or the internet.</p>
        <canvas ref={cv} style={{ display: 'none' }} />
        {img ? <img className="plan-img" src={img} alt={`Flood plan for ${inp.street}`} /> : <p className="small">Drawing your plan…</p>}
        <div className="row" style={{ marginTop: 10 }}>
          {canShareFile && <button className="btn primary" onClick={shareImage}>Share image</button>}
          {img && <a className={`btn${canShareFile ? '' : ' primary'}`} href={img} download={file?.name ?? 'highground-plan.png'}>Save image</a>}
          {text && <a className="btn" href={`sms:?&body=${encodeURIComponent(text)}`}>SMS</a>}
          {text && <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp</a>}
          {text && <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy text'}</button>}
        </div>
      </div>
    </div>
  )
}
