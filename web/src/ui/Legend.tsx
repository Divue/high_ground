// Map key: what the water colours, the two contour lines and amber mean.
// In battery saver the water is drawn on the streets themselves, so the key shows those lines.
export function Legend({ lite = false }: { lite?: boolean }) {
  if (lite) {
    return (
      <div className="legend" aria-label="Map key">
        <div className="key-row"><i className="line l1" aria-hidden="true" />5–15 cm: ankle-deep</div>
        <div className="key-row"><i className="line l2" aria-hidden="true" />15–30 cm: scooters stall</div>
        <div className="key-row"><i className="line l3" aria-hidden="true" />30 cm and more: cars stall</div>
        <div className="key-row"><i className="dot" aria-hidden="true" />Dry parking, suggested route</div>
      </div>
    )
  }
  return (
    <div className="legend" aria-label="Map key">
      <div className="ramp-row">
        <span>Ankle</span><i className="ramp" aria-hidden="true" /><span>Chest-deep</span>
      </div>
      <div className="key-row"><i className="iso" aria-hidden="true" />Cars stall past this line</div>
      <div className="key-row"><i className="dot" aria-hidden="true" />Dry parking, suggested route</div>
    </div>
  )
}
