// Depth readout: Anek Latin widens and gains weight as the water gets deeper.
export default function Readout({ cm, size = 76 }: { cm: number; size?: number }) {
  const k = Math.max(0, Math.min(1, cm / 90))
  const wdth = 78 + k * 47
  const wght = 380 + k * 420
  return (
    <div className="readout" style={{ fontSize: size, fontVariationSettings: `'wdth' ${wdth}, 'wght' ${wght}` }}
      aria-label={`${cm} centimetres`}>
      {cm}<span className="unit">cm</span>
    </div>
  )
}
