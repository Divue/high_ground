import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../config'
import { loadPlaces, postAPI } from '../lib/data'

/** street: the place is a named street from the list (the answer covers that street, not one point) */
export interface Place { label: string; lon: number; lat: number; street?: string }

interface GeoResp { source: string; results: { label: string; lon: number; lat: number }[] }

export default function Search({ onPick, initial = '' }: { onPick: (p: Place) => void; initial?: string }) {
  const [q, setQ] = useState(initial)
  const [items, setItems] = useState<Place[]>([])
  const [source, setSource] = useState('')
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const seq = useRef(0)

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (q.trim().length < 3) { setItems([]); return }
    timer.current = window.setTimeout(async () => {
      const my = ++seq.current
      let listMissing = false
      const places = await loadPlaces().catch(() => { listMissing = true; return [] as [string, number, number, string][] })
      const ql = q.toLowerCase()
      const rank = ([n, , , kind]: [string, number, number, string]) =>
        (n.toLowerCase().startsWith(ql) ? 0 : 2) + (kind === 'street' ? 1 : 0)
      const local = places.filter(([n]) => n.toLowerCase().includes(ql))
        .sort((a, b) => rank(a) - rank(b) || a[0].length - b[0].length).slice(0, 6)
        .map(([n, lon, lat, kind]) => ({ label: `${n}, Chennai`, lon, lat, street: kind === 'street' ? n : undefined }))
      if (my === seq.current) {
        setItems(local)
        setSource(local.length ? 'Places and streets from OpenStreetMap'
          : listMissing && !navigator.onLine ? 'Offline: the list of streets was not saved on this phone. Use Save for offline next time you are connected.'
          : (API_BASE ? '' : 'No matching place or street. Try a street name or a neighbourhood.'))
      }
      if (!navigator.onLine) return
      if (!API_BASE) return
      setBusy(true)
      try {
        const r = await postAPI<GeoResp>('/geocode', { q })
        if (my !== seq.current) return
        const remote = r.results.map((x) => ({ label: x.label, lon: x.lon, lat: x.lat }))
        if (remote.length) { setItems([...remote, ...local].slice(0, 6)); setSource(`Address search: ${r.source}`) }
      } catch { /* keep local results */ } finally { if (my === seq.current) setBusy(false) }
    }, 280)
    return () => window.clearTimeout(timer.current)
  }, [q])

  const pick = (p: Place) => { setQ(p.label.split(',')[0]); setItems([]); onPick(p) }

  return (
    <div className="search">
      <input spellCheck={false} autoCorrect="off"
        aria-label="Search your address in Chennai"
        placeholder="Search your street or area"
        value={q}
        onChange={(e) => { setQ(e.target.value); setActive(0) }}
        onFocus={(e) => e.currentTarget.select()}        // typing replaces the last place
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setActive((a) => Math.min(a + 1, items.length - 1)); e.preventDefault() }
          if (e.key === 'ArrowUp') { setActive((a) => Math.max(a - 1, 0)); e.preventDefault() }
          if (e.key === 'Enter' && items[active]) pick(items[active])
        }}
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls="search-list"
      />
      {items.length > 0 && (
        <ul className="suggest" id="search-list" role="listbox">
          {items.map((p, i) => (
            <li key={`${p.label}-${i}`} role="option" aria-selected={i === active} onMouseDown={() => pick(p)}>{p.label}</li>
          ))}
        </ul>
      )}
      {(source || busy) && <div className="source">{busy ? 'Searching…' : source}</div>}
    </div>
  )
}
