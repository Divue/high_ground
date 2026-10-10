import { useEffect, useState } from 'react'
import { getJSON } from '../lib/data'
import { prefersReducedMotion, setMotionChoice } from '../config'

export default function About() {
  const [drain, setDrain] = useState<number | null>(null)
  useEffect(() => { getJSON<{ split: { value_mm_h: number } }>('proof.json').then((p) => setDrain(p.split.value_mm_h)).catch(() => {}) }, [])
  return (
    <div className="panel about">
      <h2>About the model</h2>
      <div className="seg" role="group" aria-label="Animations" style={{ margin: '4px 0 10px' }}>
        <span className="muted small" style={{ alignSelf: 'center', marginRight: 4 }}>Animations</span>
        <button aria-pressed={!prefersReducedMotion()} onClick={() => { setMotionChoice('on'); window.location.reload() }}>On</button>
        <button aria-pressed={prefersReducedMotion()} onClick={() => { setMotionChoice('off'); window.location.reload() }}>Off</button>
      </div>
      <p>Chennai already has CFLOWS, a government flood warning system built for officials. HighGround is for the residents who still park their cars on the Velachery flyover every storm because nobody tells them where the water will go. We do not claim a better model than CFLOWS; we claim a tested one, built for citizens.</p>
      <h3>How it works</h3>
      <ul>
        <li>A 2D shallow-water model (local-inertial scheme, Bates et al. 2010) runs over the whole Greater Chennai Corporation area on a 30 m grid. Storms of 50 to 400 mm in 24 hours, at mean and high tide, and three real storms are computed ahead of time. Your browser only blends the results.</li>
        <li>Every few hours an AWS Lambda reads the Open-Meteo rainfall forecast for Velachery, T. Nagar, Anna Nagar and Tambaram, and picks the two nearest storms to blend.</li>
        <li>Storm drains are one uniform capacity{drain != null ? ` (${drain} mm per hour)` : ''}. We tried to tune it on half of the GCC wards, but the 2015 reports could not tell 0 from 30 mm per hour apart, so it is a stated assumption (see Proof).</li>
      </ul>
      <h3>Limits, in plain words</h3>
      <ul>
        <li>Terrain is 30 m satellite elevation (Copernicus GLO-30). Buildings and trees were removed by approximation. A kerb, a raised gate or a dip under a bridge is invisible to it.</li>
        <li>Drains are not mapped pipe by pipe. They are one uniform capacity, so a blocked drain on your street will make things worse than shown.</li>
        <li>At street level, the 2015 citizen reports only barely separate this model from chance, and distance to a canal predicts them a little better than the model does. Treat a single street's number as a guide to how your area behaves, not a measurement.</li>
        <li>The model does not reproduce GCC's hazard map, which shows Velachery flooding far more than T. Nagar. In the model, flooding follows small closed hollows in the 30 m terrain, some of them artefacts of how buildings and trees were removed.</li>
        <li>Some low ground beside channels already holds water when a storm starts, because the channels are filled to their measured level. The answer card says so for those streets.</li>
        <li>The 2015 Chembarambakkam reservoir release is modelled as an assumption, built from the release timeline in the CAG audit. Other tank surpluses that year are not included.</li>
        <li>Closed low pockets deeper than 1 m in the terrain are treated as errors or unseen culverts and partly filled. Small drains are represented as shallow channels on the 30 m grid.</li>
        <li>Storm surge from cyclones is not modelled. High tide is a fixed sea level 0.5 m above mean.</li>
        <li>Rain falls evenly across the city in each scenario. Real storms are patchier.</li>
        <li>This is not an official warning. Follow GCC, IMD and Tamil Nadu State Disaster Management Authority advisories. In danger, call <span className="emergency">112</span>.</li>
      </ul>
      <h3>Data and attribution</h3>
      <ul className="small">
        <li>Elevation: Copernicus DEM GLO-30, © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA; all rights reserved. Read from the AWS Open Data registry.</li>
        <li>Land cover: ESA WorldCover 2021 (CC BY 4.0), © ESA WorldCover project / contains modified Copernicus Sentinel data (2021), from the AWS Open Data registry.</li>
        <li>Roads, buildings, rivers, hospitals, bridges and parking: © OpenStreetMap contributors (ODbL). Basemap tiles: Protomaps.</li>
        <li>Rainfall forecasts and storm timing: Open-Meteo (CC BY 4.0), including ERA5 reanalysis (Copernicus Climate Change Service).</li>
        <li>Storm totals: India Meteorological Department station reports as published in the press; reservoir release timeline: CAG audit and PWD statements.</li>
        <li>2015 citizen flood reports: OpenCity and the osm-in flood-map contributors. GCC flood hazard zones and ward boundaries: Greater Chennai Corporation via OpenCity. NRSC 2015 inundation extent via OpenCity.</li>
        <li>Cross-check model: ANUGA, Geoscience Australia (Apache 2.0).</li>
      </ul>
    </div>
  )
}
