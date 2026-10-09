// Map key: what the water colours, the two contour lines and amber mean.
export function Legend() {
  return (
    <div className="legend" aria-label="Map key">
      <div className="ramp-row">
        <span>Ankle</span><i className="ramp" aria-hidden="true" /><span>Chest-deep</span>
      </div>
      <div className="key-row"><i className="iso" aria-hidden="true" />Cars stall past this line</div>
      <div className="key-row"><i className="dot" aria-hidden="true" />Dry parking and safe route</div>
    </div>
  )
}
