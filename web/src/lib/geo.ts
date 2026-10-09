export function distM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const k = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180)
  return Math.hypot((lon2 - lon1) * 111_320 * k, (lat2 - lat1) * 110_540)
}

export function pointSegM(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const k = Math.cos(py * Math.PI / 180)
  const axk = ax * k, bxk = bx * k, pxk = px * k
  const dx = bxk - axk, dy = by - ay
  const L = dx * dx + dy * dy
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((pxk - axk) * dx + (py - ay) * dy) / L))
  return distM(px, py, (axk + t * dx) / k, ay + t * dy)
}

export function fmtDistance(m: number): string {
  if (m < 950) return `${Math.round(m / 50) * 50 || 50} m`
  return `${(m / 1000).toFixed(1)} km`
}
