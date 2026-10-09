// The street's water level against an adult, a scooter with its rider and a small car, drawn at
// typical sizes (in metres). The depth is the model's number from the street JSON.
const SHALLOW = [0x7f, 0xd3, 0xd8], DEEP = [0x1c, 0x6e, 0x9c]
const TOP = 1.9      // metres shown
function rampColour(m: number) {
  const x = Math.max(0, Math.min(1, (m - 0.03) / 1.17)), t = x * x * (3 - 2 * x)
  const c = SHALLOW.map((s, i) => Math.round(s + (DEEP[i] - s) * t))
  return `rgb(${c.join(',')})`
}

export default function DepthGlyph({ cm }: { cm: number }) {
  const d = Math.max(0, cm / 100)
  const shown = Math.min(d, TOP)
  // y grows downward in SVG; ground at y = TOP
  const y = (m: number) => TOP - m
  const pts = (p: [number, number][]) => p.map(([x, m]) => `${x},${y(m)}`).join(' ')
  return (
    <figure className="glyph" aria-label={`Water at ${cm} cm against an adult, a scooter rider and a small car, at typical sizes`}>
      <svg viewBox={`-0.1 -0.02 6.6 ${TOP + 0.08}`} preserveAspectRatio="xMinYMax meet" role="img" aria-hidden="true">
        <g className="figs">
          {/* adult, 1.65 m */}
          <circle cx="0.3" cy={y(1.53)} r="0.11" />
          <rect x="0.12" y={y(1.40)} width="0.36" height="0.58" rx="0.08" />
          <rect x="0.15" y={y(0.84)} width="0.12" height="0.84" rx="0.04" />
          <rect x="0.33" y={y(0.84)} width="0.12" height="0.84" rx="0.04" />
          {/* step-through scooter and its rider */}
          <circle cx="1.15" cy={y(0.21)} r="0.21" />
          <circle cx="2.35" cy={y(0.21)} r="0.21" />
          <polygon points={pts([[0.92, 0.3], [1.62, 0.3], [1.62, 0.62], [1.5, 0.8], [0.95, 0.8], [0.88, 0.6]])} />
          <polygon points={pts([[1.6, 0.28], [2.05, 0.28], [2.05, 0.38], [1.6, 0.38]])} />
          <polygon points={pts([[2.0, 0.3], [2.2, 0.3], [2.4, 1.02], [2.24, 1.02]])} />
          <polygon points={pts([[2.12, 1.02], [2.5, 1.02], [2.5, 1.08], [2.12, 1.08]])} />
          <polygon points={pts([[1.18, 0.8], [1.5, 0.8], [1.52, 1.36], [1.24, 1.36]])} />
          <circle cx="1.38" cy={y(1.48)} r="0.12" />
          <polygon points={pts([[1.3, 0.8], [1.86, 0.84], [1.92, 0.4], [1.78, 0.4], [1.74, 0.7], [1.3, 0.68]])} />
          <polygon points={pts([[1.44, 1.3], [2.22, 1.08], [2.2, 1.02], [1.42, 1.22]])} />
          {/* small hatchback, 1.5 m tall */}
          <path d={`M3.0 ${y(0.25)} L3.0 ${y(0.85)} Q3.05 ${y(1.0)} 3.4 ${y(1.0)} L3.85 ${y(1.48)} L5.75 ${y(1.48)} Q6.2 ${y(1.4)} 6.3 ${y(0.95)} L6.35 ${y(0.25)} Z`} />
          <circle cx="3.65" cy={y(0.3)} r="0.3" className="wheel" />
          <circle cx="5.7" cy={y(0.3)} r="0.3" className="wheel" />
        </g>
        {shown > 0.005 && <rect x="-0.1" y={y(shown)} width="6.6" height={shown} fill={rampColour(d)} opacity="0.45" />}
        {shown > 0.005 && <line x1="-0.1" x2="6.5" y1={y(shown)} y2={y(shown)} className="surface" />}
        {/* outlines on top, so submerged figures stay readable */}
        <g className="outline">
          {/* adult, 1.65 m */}
          <circle cx="0.3" cy={y(1.53)} r="0.11" />
          <rect x="0.12" y={y(1.40)} width="0.36" height="0.58" rx="0.08" />
          <rect x="0.15" y={y(0.84)} width="0.12" height="0.84" rx="0.04" />
          <rect x="0.33" y={y(0.84)} width="0.12" height="0.84" rx="0.04" />
          {/* step-through scooter and its rider */}
          <circle cx="1.15" cy={y(0.21)} r="0.21" />
          <circle cx="2.35" cy={y(0.21)} r="0.21" />
          <polygon points={pts([[0.92, 0.3], [1.62, 0.3], [1.62, 0.62], [1.5, 0.8], [0.95, 0.8], [0.88, 0.6]])} />
          <polygon points={pts([[1.6, 0.28], [2.05, 0.28], [2.05, 0.38], [1.6, 0.38]])} />
          <polygon points={pts([[2.0, 0.3], [2.2, 0.3], [2.4, 1.02], [2.24, 1.02]])} />
          <polygon points={pts([[2.12, 1.02], [2.5, 1.02], [2.5, 1.08], [2.12, 1.08]])} />
          <polygon points={pts([[1.18, 0.8], [1.5, 0.8], [1.52, 1.36], [1.24, 1.36]])} />
          <circle cx="1.38" cy={y(1.48)} r="0.12" />
          <polygon points={pts([[1.3, 0.8], [1.86, 0.84], [1.92, 0.4], [1.78, 0.4], [1.74, 0.7], [1.3, 0.68]])} />
          <polygon points={pts([[1.44, 1.3], [2.22, 1.08], [2.2, 1.02], [1.42, 1.22]])} />
          {/* small hatchback, 1.5 m tall */}
          <path d={`M3.0 ${y(0.25)} L3.0 ${y(0.85)} Q3.05 ${y(1.0)} 3.4 ${y(1.0)} L3.85 ${y(1.48)} L5.75 ${y(1.48)} Q6.2 ${y(1.4)} 6.3 ${y(0.95)} L6.35 ${y(0.25)} Z`} />
          <circle cx="3.65" cy={y(0.3)} r="0.3" className="wheel" />
          <circle cx="5.7" cy={y(0.3)} r="0.3" className="wheel" />
        </g>
        <line x1="-0.1" x2="6.5" y1={y(0.15)} y2={y(0.15)} className="iso thin" />
        <line x1="-0.1" x2="6.5" y1={y(0.30)} y2={y(0.30)} className="iso bold" />
        <line x1="-0.1" x2="6.5" y1={TOP} y2={TOP} className="ground" />
      </svg>
      <figcaption className="small muted">Typical heights, for scale</figcaption>
    </figure>
  )
}
