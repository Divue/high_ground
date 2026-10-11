// The landing page at /: a pinned 3D story (city, water, your street, the way out) and then the
// pitch, proof and limits. Numbers below come from the model outputs of 10 Oct 2026
// (docs/LANDING_PAGE_CONTEXT.md, sections 6 and 8) or, for the street story, from
// web/public/landing/scene.json (pipeline/08_landing_scene.py).
import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../config'
import { loadRealScene } from './scene/real'
import { stylisedCity } from './scene/stylised'
import type { SceneData } from './scene/types'
import { clockAt, startStory, startTextOnly } from './story'
import './landing.css'

const STORMS: [string, string, number, number, boolean][] = [
  ['100 mm design storm', '100 mm in 24 h', 2.4, 0, false],
  ['200 mm design storm', '200 mm in 24 h', 17, 9, false],
  ['300 mm design storm', '300 mm in 24 h', 25, 15, false],
  ['400 mm design storm', '400 mm in 24 h', 30, 16, false],
  ['Dec 2015, with reservoir release', '374 mm', 29, 16, true],
  ['Cyclone Michaung, 2023', '415 mm', 23, 15, true],
  ['Cyclone Fengal, 2024', '114 mm', 3.6, 0, true],
]

const AWS: [string, string][] = [
  ['Amazon S3 and CloudFront', 'Depth tiles, street files, routing graph'],
  ['AWS Amplify Hosting', 'This site'],
  ['Amazon EventBridge Scheduler', 'Checks the rain forecast every 3 hours'],
  ['AWS Lambda', 'Forecast check, subscribe, assistant, address search'],
  ['Amazon API Gateway', 'The app’s API'],
  ['Amazon DynamoDB', 'Who wants alerts for which street'],
  ['Amazon SNS', 'Alert email, filtered to each street'],
  ['Amazon Bedrock', 'Writes alerts in plain words and answers questions'],
  ['Strands Agents SDK', 'The assistant, limited to model numbers'],
  ['Amazon Location Service', 'Address search, biased to Chennai'],
  ['AWS Open Data', 'Copernicus elevation and ESA land cover'],
  ['AWS SAM', 'The whole stack in one template'],
]

// proof chart: one scale from 40% to 60%
const LO = 40, HI = 60
const sx = (v: number) => ((v - LO) / (HI - LO)) * 100
const BARS: [string, number, [number, number] | null][] = [
  ['Distance to canal', 56, null],
  ['HighGround model', 53, [51, 55]],
  ['Coin toss', 50, null],
  ['Low ground alone', 47, null],
]

function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch { return false }
}

const km = (m: number) => `${(m / 1000).toFixed(1)} km`

export default function Landing() {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<SceneData | null>(null)
  const [noGL] = useState(() => !hasWebGL())
  const [addr, setAddr] = useState('')

  useEffect(() => {
    document.documentElement.classList.add('lp')
    document.title = 'HighGround · Know your ground'
    return () => document.documentElement.classList.remove('lp')
  }, [])

  useEffect(() => {
    if (noGL) return
    let alive = true
    loadRealScene().then((real) => { if (alive) setData(real ?? stylisedCity()) })
    return () => { alive = false }
  }, [noGL])

  useEffect(() => {
    if (noGL) return startTextOnly(root.current!)
    if (!data) return
    return startStory(root.current!, canvas.current!, data, prefersReducedMotion())
  }, [data, noGL])

  const scrollToStory = (f: number) => {
    const story = root.current!.querySelector<HTMLElement>('.lp-story')!
    window.scrollTo({ top: story.offsetTop + (story.offsetHeight - window.innerHeight) * f, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  const real = data?.kind === 'real' ? data : null
  const run = real?.run
  const street = real?.street
  const route = real?.route

  return (
    <div className="lp-root" ref={root}>
      <header className="lp-nav">
        <a className="lp-brand" href="/">HighGround</a>
        <nav className="lp-links" aria-label="Page">
          <a href="#lp-answers">What it answers</a>
          <a href="#lp-offline">Offline</a>
          <a href="#lp-proof">Proof</a>
          <a href="#lp-limits">Limits</a>
          <a className="lp-btn primary" href="/app">Open the map</a>
        </nav>
      </header>

      <section className="lp-story" aria-label="How HighGround works, told as you scroll">
        <div className={`lp-stage${noGL ? ' nogl' : ''}`}>
          <canvas ref={canvas} className="lp-canvas" aria-hidden="true" />
          <div className="lp-scrim" />
          <div className="lp-steps">
            <div className="lp-step hero on" data-in="0" data-out="0.085">
              <div className="lp-eyebrow"><b>Chennai</b> · flood answers, street by street</div>
              <h1>Know your ground.</h1>
              <div className="lp-sub">Before the water rises.</div>
              <p className="lp-lede">See where floodwater will go tonight, how deep your street gets and when, where to park on dry ground, and a route that avoids flooded streets.</p>
              <div className="lp-row">
                <a className="lp-btn primary" href="/app">Open the map</a>
                <button className="lp-btn" onClick={() => scrollToStory(0.18)}>See how it works</button>
              </div>
              <div className="lp-hint"><i />Scroll to follow one street through a storm</div>
            </div>

            <div className="lp-step" data-in="0.1" data-out="0.25">
              <div className="lp-stepnum"><span>1 of 4</span> The city</div>
              <h2>Flood warnings tell you a storm is coming. Not what to do on your street.</h2>
              <p>Every monsoon, residents still park their cars on the Velachery flyover, because nobody tells them where the water will go. HighGround is built for them.</p>
            </div>

            <div className="lp-step" data-in="0.27" data-out="0.43">
              <div className="lp-stepnum"><span>2 of 4</span> The water</div>
              <h2>Flooding isn't uniform.</h2>
              {run?.wetShare != null ? (
                <>
                  <p>Rain collects in hollows and along the rivers first. In {run.label}, the model puts <span className="lp-stat">{Math.round(run.wetShare * 1000) / 10}%</span> of the city's land under water too deep for scooters.</p>
                  <p className="lp-note">Model output for {run.label}, {run.totalMm} mm, replayed as if it started at 6 PM. This is Velachery from the model's own terrain.</p>
                </>
              ) : (
                <>
                  <p>Rain collects in hollows and along the rivers first. In a 200 mm storm, the model puts <span className="lp-stat">17%</span> of the city's land under water too deep for scooters.</p>
                  <p className="lp-note">{real ? 'Model output for the 200 mm design storm. This is Velachery from the model’s own terrain.' : 'Model output for the 200 mm design storm. The city drawn here is an illustration, not Chennai’s terrain.'}</p>
                </>
              )}
            </div>

            <div className="lp-step" data-in="0.45" data-out="0.6">
              <div className="lp-stepnum"><span>3 of 4</span> Your street</div>
              <h2>{street?.name ? street.name : 'See what the model sees on your road.'}</h2>
              <div className="lp-gauge" aria-label="Depth on the street">
                <div className="lp-tube"><div className="lp-fill" />
                  <div className="lp-tick" style={{ bottom: '12.5%' }} /><div className="lp-tick" style={{ bottom: '37.5%' }} /><div className="lp-tick" style={{ bottom: '75%' }} />
                </div>
                <div className="lp-gauge-right">
                  {street?.seriesCm && (
                    <div className="lp-readout"><span className="lp-readout-cm">0</span><span className="lp-unit">cm</span><span className="lp-readout-at" /></div>
                  )}
                  <div className="lp-bands">
                    <div className="lp-band" data-b="3"><b>Cars stall</b><small>over 30 cm</small></div>
                    <div className="lp-band" data-b="2"><b>Too deep for scooters</b><small>15–30 cm</small></div>
                    <div className="lp-band" data-b="1"><b>Wet but passable</b><small>5–15 cm</small></div>
                    <div className="lp-band" data-b="0"><b>Dry</b><small>under 5 cm</small></div>
                  </div>
                </div>
              </div>
              {street?.peakCm != null ? (
                <p className="lp-note">At its worst the model puts {street.peakCm} cm on this street{street.t15Hour != null ? `, too deep for scooters by ${clockAt(street.t15Hour)}` : ''}. {run?.label} replay; the same numbers the app shows.</p>
              ) : (
                <p className="lp-note">Illustration. In the app, your street's depth and the hour it gets too deep come straight from the model.</p>
              )}
            </div>

            <div className="lp-step" data-in="0.62" data-out="0.8">
              <div className="lp-stepnum"><span>4 of 4</span> The way out</div>
              <h2>Find a way around the water.</h2>
              {route?.dryM != null ? (
                <p>Nearest dry parking: <b>{route.parking.name}</b>{route.parking.kind === 'flyover' ? ', a flyover' : ''}. The suggested route gets there in {km(route.dryM)} on roads the model keeps under 20 cm{route.usual ? (route.usualM != null && route.usualM < route.dryM * 0.97 ? `; the usual ${km(route.usualM)} way goes through water` : '; the usual way goes through water') : ''}.</p>
              ) : (
                <p>A suggested route draws itself around flooded streets and ends at dry parking, usually a flyover. The model checks 168 dry-parking spots across the city, 122 of them flyovers.</p>
              )}
              <div className="lp-legend">
                <span><i className="lp-sw" style={{ background: 'var(--amber)' }} />Suggested route and dry parking</span>
                <span><i className="lp-sw" style={{ background: 'var(--grey-dim)', opacity: 0.6 }} />Your usual route, through water</span>
                <span><i className="lp-sw" style={{ background: 'linear-gradient(90deg, var(--shallow), var(--deep))' }} />Water, shallow to deep</span>
              </div>
            </div>

            <div className="lp-step" data-in="0.84" data-out="1.01">
              <h2>From the story to your street.</h2>
              <p>Search any Chennai address. The map flies there, plays the night hour by hour, and tells you what to do.</p>
              <form className="lp-search" onSubmit={(e) => { e.preventDefault(); window.location.href = addr.trim() ? `/app?q=${encodeURIComponent(addr.trim())}` : '/app' }}>
                <label htmlFor="lp-addr" className="sr-only">Your street or area</label>
                <input id="lp-addr" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Try Velachery Main Road" autoComplete="off" spellCheck={false} />
                <button className="lp-btn primary" type="submit">Open the map</button>
              </form>
            </div>
          </div>
          <div className="lp-rail" aria-hidden="true">
            {['The city', 'The water', 'Your street', 'The way out'].map((t) => <div key={t}><span>{t}</span><i /></div>)}
          </div>
        </div>
      </section>

      <main className="lp-main">
        <section className="lp-sec" id="lp-answers">
          <div className="lp-head">
            <div className="lp-eyebrow">What it answers</div>
            <h2>Six questions people ask when it starts to rain.</h2>
          </div>
          <div className="lp-qs">
            <div className="lp-q"><h3>Will my street flood tonight?</h3><p>How deep, in plain words, with a picture of an adult, a scooter and a car against the water.</p></div>
            <div className="lp-q"><h3>When does it get too deep?</h3><p>The hour your road passes 15 cm, the point where scooters should stay off it.</p></div>
            <div className="lp-q safe"><h3>Where can I park on dry ground?</h3><p>The nearest dry parking, usually a flyover, and by when to move the car.</p></div>
            <div className="lp-q safe"><h3>Which way avoids the water?</h3><p>A route that avoids flooded streets, on foot, by two-wheeler or by car, planned across 206,223 road links hour by hour, with step-by-step directions that follow your GPS.</p></div>
            <div className="lp-q"><h3>Which hospitals get cut off?</h3><p>All 46 major hospitals, and whether a dry road still reaches each one.</p></div>
            <div className="lp-q"><h3>Tell me if this changes.</h3><p>Every three hours the forecast is checked. If your street's risk changes, you get an email.</p></div>
          </div>
        </section>

        <section className="lp-sec" id="lp-offline">
          <div className="lp-head">
            <div className="lp-eyebrow">When the power goes</div>
            <h2>It keeps working without the internet.</h2>
            <p>On 4 December 2023, 712 of Chennai's 1,814 power feeders were switched off. The next day, 30% of the city's 42,747 mobile towers were down. Save your area before the storm, and HighGround still opens on your phone.</p>
          </div>
          <div className="lp-qs">
            <div className="lp-q"><h3>Save for offline</h3><p>One tap keeps the app, the map and your street (and two more places) for every storm on your phone. Offline it says how old its forecast is and switches to a battery-saver map with streets coloured by depth.</p></div>
            <div className="lp-q safe"><h3>Take me to dry ground</h3><p>Still works offline: a way to dry parking, a hospital or high ground, on foot, by two-wheeler or by car. Live directions follow your GPS, which needs no mobile data.</p></div>
            <div className="lp-q"><h3>Help numbers</h3><p>Tap to call 112, the Corporation's 1913, the state and district emergency lines, and the power line for fallen wires. Send your location by SMS or WhatsApp.</p></div>
            <div className="lp-q"><h3>My flood plan</h3><p>Your street's depth, when to move the car, where to park and the way there, as one image to send to family. Works with no app and no network.</p></div>
          </div>
          <p className="lp-tnote">Sources: The News Minute, 4 Dec 2023; The Week / PTI, 5 Dec 2023. GPS works without mobile data, but the first fix can be slow; open HighGround once before the storm.</p>
        </section>

        <section className="lp-sec" id="lp-proof">
          <div className="lp-head">
            <div className="lp-eyebrow">Proof</div>
            <h2>Did the model get 2015 right?</h2>
            <p>We kept half of the city's wards aside and never tuned on them. On those wards, we paired a street residents reported flooded in December 2015 with one they did not, and asked which one the model puts more water on.</p>
          </div>
          <div className="lp-proof">
            <div className="lp-proof-text">
              <p className="lp-verdict">The model picks the flooded street <em>53%</em> of the time. A coin toss gets 50%. That is slightly better than chance.</p>
              <p><strong>Read a street's number as a guide to how the area behaves, not a promise.</strong> A simple rule, distance to the nearest canal, does a little better at 56%. We show it because it is true.</p>
              <p>3,200 reported street segments in the held-out wards. The range shown is 95%, resampling whole wards. Adding the Chembarambakkam reservoir release lifts riverside streets from 51% to 53%.</p>
            </div>
            <div className="lp-chart">
              <h3>How often each method ranks the flooded street higher</h3>
              <div className="lp-bars">
                <div className="lp-axis">
                  {[40, 45, 50, 55, 60].map((v) => <div key={v} className={`lp-t${v === 50 ? ' coin' : ''}`} style={{ left: `${sx(v)}%` }}><span>{v}%</span></div>)}
                </div>
                {BARS.map(([label, v, ci]) => (
                  <div key={label} className={`lp-bar${ci ? ' me' : ''}`}>
                    <span className="lbl">{label}</span>
                    <span className="track">
                      <span className="b" style={{ width: `${sx(v)}%` }} />
                      {ci && <span className="ci" style={{ left: `${sx(ci[0])}%`, width: `${sx(ci[1]) - sx(ci[0])}%` }} />}
                    </span>
                    <span className="val">{v}%</span>
                  </div>
                ))}
              </div>
              <div className="lp-anuga">
                <b>73%</b>
                <p>agreement on flooded area between our model and ANUGA, an independent flood model from Geoscience Australia, over Velachery in a 200 mm storm. This checks the maths, not the terrain.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-sec" id="lp-storms">
          <div className="lp-head">
            <div className="lp-eyebrow">Sixteen storms, run in advance</div>
            <h2>What a storm does to the city.</h2>
            <p>Twelve design storms and three real ones. The browser never runs the flood model; it blends results computed ahead of time, so the map stays smooth.</p>
          </div>
          <div className="lp-tablewrap">
            <table>
              <thead><tr><th>Storm</th><th>Rain</th><th>Land too deep for scooters</th><th>Hospitals cut off, of 46</th></tr></thead>
              <tbody>
                {STORMS.map(([name, rain, share, cut, rp]) => (
                  <tr key={name} className={rp ? 'replay' : ''}>
                    <td>{name}</td><td>{rain}</td>
                    <td><div className="m"><span className="num">{share}%</span><i style={{ width: `${(share / 35) * 180}px` }} /></div></td>
                    <td className="num">{cut}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lp-tnote">Too deep for scooters means 15 cm or more. Replays run a real storm as if it started at 6 PM tonight.</p>
        </section>

        <section className="lp-sec" id="lp-aws">
          <div className="lp-head">
            <div className="lp-eyebrow">Built on AWS</div>
            <h2>Precomputed in Python, served and kept current on AWS.</h2>
          </div>
          <div className="lp-aws">{AWS.map(([a, b]) => <div key={a}><b>{a}</b><span>{b}</span></div>)}</div>
        </section>

        <section className="lp-sec" id="lp-limits">
          <div className="lp-head">
            <div className="lp-eyebrow">Limits</div>
            <h2>What the model cannot see.</h2>
          </div>
          <div className="lp-limits">
            <p><strong>Terrain is 30 m satellite elevation</strong> with buildings and trees removed by approximation. Kerbs, gates and small dips are invisible to it.</p>
            <p><strong>Drains are one uniform capacity</strong>, 10 mm an hour. It is an assumption, not a drain network.</p>
            <p><strong>It does not reproduce GCC's finding</strong> that Velachery floods far more than T. Nagar. Its flooding follows small hollows in the 30 m terrain.</p>
            <p><strong>The 2015 reservoir release</strong> is modelled from the CAG audit timeline. Other tanks are not included.</p>
            <p><strong>No storm surge.</strong> Rain falls evenly across the city in each scenario.</p>
            <p><strong>The forecast check is live; the flood model is not.</strong> Every three hours the app picks the nearest storms it already ran.</p>
          </div>
          <div className="lp-danger"><span>Not an official warning. Follow GCC and IMD advisories.</span><span className="e">In danger, call 112.</span></div>
        </section>

        <section className="lp-sec lp-final">
          <h2>Know your ground.</h2>
          <p>Explore modelled flood risk for your street, what it rests on, and where it falls short.</p>
          <div className="lp-row"><a className="lp-btn primary" href="/app">Open the map</a><a className="lp-btn" href="#lp-proof">Read the proof</a></div>
        </section>
      </main>

      <footer className="lp-foot">
        <p>Elevation: Copernicus DEM GLO-30, © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA; all rights reserved. Land cover: ESA WorldCover 2021 (CC BY 4.0). Map data © OpenStreetMap contributors; basemap by Protomaps. Rainfall: Open-Meteo (CC BY 4.0), including ERA5. 2015 flood reports: OpenCity and osm-in/flood-map contributors. Hazard zones and ward map: Greater Chennai Corporation via OpenCity. Cross-check model: ANUGA, Geoscience Australia.</p>
        <p>{real ? 'The 3D story shows Velachery from the model’s terrain and outputs; building heights come from OpenStreetMap where mapped, otherwise a drawing default.' : 'The 3D story shows an illustrative city; the numbers on this page come from the HighGround model outputs.'}</p>
      </footer>
    </div>
  )
}
