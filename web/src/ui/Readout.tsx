// Depth readout: Anek Latin widens and gains weight as the water gets deeper (eased over 0-150 cm).
export default function Readout({ cm, shown = cm, size = 68 }: { cm: number; shown?: number; size?: number }) {
  const x = Math.max(0, Math.min(1, shown / 150))
  const k = 1 - (1 - x) * (1 - x)
  const wdth = 78 + k * 47
  const wght = 380 + k * 420
  return (
    <div className="readout" style={{ fontSize: size, fontVariationSettings: `'wdth' ${wdth}, 'wght' ${wght}` }}
      aria-label={`${cm} centimetres`}>
      <span aria-hidden="true">{shown}</span><span className="unit" aria-hidden="true">cm</span>
    </div>
  )
}
