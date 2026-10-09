// Map key: what the water colours, the two contour lines and amber mean.
export function Legend() {
  return (
    <div className="legend" aria-label="Map key">
      <div className="ramp-row">
        <span>5 cm</span><i className="ramp" aria-hidden="true" /><span>1.2 m+</span>
      </div>
      <div className="key-row"><i className="iso" aria-hidden="true" />30 cm, cars stall</div>
      <div className="key-row"><i className="dot" aria-hidden="true" />Dry parking and safe route</div>
    </div>
  )
}
