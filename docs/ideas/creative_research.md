# HighGround: creative research for the last 48 hours

Written Fri 9 Oct 2026, about 19:00 IST. The deadline is Sun 11 Oct, 20:00 IST. This report covers frontend ideas that would make the app more memorable and faster while keeping it honest. No project code was changed. Every idea fits the current stack: MapLibre GL JS 6.13.0, a three.js 0.186.1 custom layer, React 19 and Vite 8, hosted on S3, CloudFront and Amplify.

---

## 0. What the current build tells us (read this first)

I read CLAUDE.md, the last 170 lines of PROGRESS.md, README.md and docs/DEMO.md. I also looked at the screenshots in `review/design`, `review/qa`, `review/p5-dev` and `review/judge`, and read `web/src`. Eight findings shape everything below.

1. **The sea is drawn as floodwater in the high-tide replays.** In `water/michaung2023/h01.png`, 236,530 cells at 15 cm or more fall inside the sea mask (`water/sea.png`); only 7,690 fall outside it. Fengal has the same problem. The mean-tide design runs are not affected. `WaterLayer` never loads `sea.png`. The result is a blocky cyan "flooded Bay" (`review/qa/19_loop_road_michaung2023.png`). The demo opens with `?replay=michaung2023` and the camera starts over the Bay, so the video's first shot shows this. Fix it first (quick win 1).
2. **The map redraws at full frame rate all the time.** On any hardware GPU, `WaterLayer.render()` calls `map.triggerRepaint()` every frame. It does so even when ripples are faded out (below zoom 13), when rain is off, and when the About panel covers the map. Each repaint redraws the terrain, tens of thousands of building extrusions, the labels, and a water mesh of about 300k vertices and 600k triangles. On a 2-core laptop with a Vega 3 GPU this is the largest single cost, and it heats the machine until it throttles.
3. **Heavy CPU work runs on the main thread during the opening flight.**
   - `preload()` decodes every hourly frame, 54 of them for Michaung. Each decode is `drawImage`, then `getImageData`, then a loop over 1.2M pixels.
   - `blendedFrame()` allocates a 4.8 MB `Float32Array` on every call, and `leaveByPlan` calls it once per hour.
   - `showFrame()` mixes 1.2M pixels on the CPU whenever a fade is interrupted.

   All of this runs while the camera flies, so the one orchestrated moment stutters.
4. **The water rise is a uniform multiplier, not the model's timing.** The `rise` uniform scales every depth from 0 to 1 at once, so half-depth water appears everywhere at the same moment. The hourly frames already exist. Playing hour 1 to the peak would show where water arrives first, which is both truer and more dramatic.
5. **The most dangerous water is the hardest to see.** On storm sky `#14303D`, deep water `#1C6E9C` has a contrast ratio of 2.5:1, while shallow water `#7FD3D8` has 8.0:1. Shallow water is also drawn at 0.72 alpha. The eye therefore goes to puddles, not to 1.5 m of water.
6. **Water edges show the 30 m grid.** Zoomed in, the bilinear-sampled 30 m texture gives rounded squares and stair steps.
7. **The city is a flat carpet.** Almost every building footprint falls back to the default 8 m height, so the 3D buildings read as uniform boxes.
8. **A dry night opens on an empty flight** (`review/judge/a_default_8s.png`). A judge who opens the plain link on a dry Sunday sees no water until they press a button.

---

## 1. Three signature moments

All three moments share one new piece: a GPU "time engine." It renders any fractional hour of one or two model runs without blending on the CPU. Build it once (about 1.5 hours, section 1.0); after that, each moment is mostly camera work and captions.

### 1.0 Shared foundation: the time engine

For rendering, replace the CPU blend (`blendedFrame` plus `showFrame`) with four texture slots and two uniforms:

```glsl
uniform sampler2D dA0, dA1;   // run A at floor(hour) and floor(hour)+1
uniform sampler2D dB0, dB1;   // run B (forecast blend); unused for replays
uniform float fHour;          // fractional part of the hour, 0..1
uniform float wB;             // weight of run B, 0..1
float depthM(vec2 uv) {
  float a = mix(texture2D(dA0, uv).r, texture2D(dA1, uv).r, fHour);
  float b = mix(texture2D(dB0, uv).r, texture2D(dB1, uv).r, fHour);
  return mix(a, b, wB) * 2.55;            // texture holds cm/255 -> metres
}
```

- **Decoding and upload.** Decode each frame with `createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })`, which works off the main thread. Upload it as `new THREE.Texture(bitmap)` with `flipY = false`, `colorSpace = THREE.NoColorSpace`, `generateMipmaps = false` and linear filters. There is no `getImageData` call and no per-pixel JavaScript loop. Keep an LRU cache of about 12 textures (roughly 5 MB each as RGBA).
- **Changing the time.** `setTime(hour)` swaps texture slots only when `floor(hour)` changes; between hours it only writes `fHour`. Scrubbing becomes continuous (set the timeline input's `step` to 0.05), and a time-lapse costs one texture upload per modelled hour.
- **Alternative for full replays.** To play a replay from start to finish, you could use a `THREE.DataArrayTexture` instead: R8, one layer per hour, each layer filled with `addLayerUpdate(i)` as it decodes. The 2015 run would take 36 × 1.2 MB = 43 MB. This needs `glslVersion: THREE.GLSL3` and a `sampler2DArray`. The four-slot version is simpler and good enough.
- **Routing.** Routing still needs pixel arrays on the CPU. Move that work into a worker (performance item 2).

### Moment A: "The storm comes ashore" (the opening, rebuilt)

Why a judge remembers it: in nine seconds the water arrives the way the model says it arrives, and the sequence lands on one number.

| Time | What the viewer sees |
|---|---|
| 0.0 s | A poster frame, a pre-rendered still of the Bay at night (about 60 KB as WebP), is already on screen, so the page is never blank. The live map fades in underneath it. |
| 0.0–1.5 s | The camera is low over a calm, dark Bay of Bengal, looking west; the sea is masked out of the flood colours. The coast reads as a thin band of soft city glow. Rain streaks fade in at the first hour's intensity. |
| 1.5–6.0 s | One continuous glide, without flyTo's zoom-out arc: straight in over the Marina, banking from bearing −70° to −18° and descending to Velachery. Buildings fade in from zoom 13.5. |
| 2.5–7.5 s | The timeline slides up and its clock runs from 6 PM to the peak hour. The water follows the model's hourly frames (six keyframes, interpolated on the GPU): low ground and channels fill first, then the streets. |
| 7.5–9.0 s | The camera settles on the street. The readout counts up from 0 to tonight's depth, and the Anek Latin numerals widen and gain weight as they climb. Then "Reaches 15 cm by 11 PM" and the decision line appear. After this, only rain and ripples move. |
| Dry night | The same glide with no water: the city glows, and the card says "No rain forecast tonight" with the replay button as the primary action. |
| Reduced motion | Jump to the final frame and show the numbers immediately, as now. |

How to build it:
- **Camera.** Use two Catmull-Rom splines, one for the camera position and altitude and one for the look-at target. On every `requestAnimationFrame`, call `map.jumpTo(map.calculateCameraOptionsFromTo(new LngLat(cx, cy), altCam, new LngLat(tx, ty), altTarget))`, with an ease-in-out on t. Keep the camera at least 150 m above `map.queryTerrainElevation()`.
- **Water.** Call `timeEngine.play(run, 1, peakHour, durationMs)`. Prefetch keyframes h1, h3, h6, h9, h12 and the peak (about 2 MB in total) during the first second.
- **City glow, with no new data and no amber.** Add a line layer on the Protomaps `roads` layer (major roads and highways only): `line-color` rain grey, `line-blur` 6–10 px, and `line-opacity` 0.08–0.15 interpolated by zoom, placed under the water. Optionally, download NASA Black Marble night lights once (public domain) and host them on S3 as a raster layer for the Bay view.
- **Count-up.** Run a `requestAnimationFrame` tween on the readout value, with the same duration and easing as the last hour of the rise. `aria-live` announces only the final value.
- **Effort:** 5 hours on its own, or 3 hours once the time engine exists.
- **GPU cost:** the same as today's flight plus one line layer. Once frame decoding leaves the main thread, it will cost less than the current flight. The flight is still the heaviest moment, because tiles stream in while terrain and extrusions draw, so cap the pixel ratio at 1 during it.
- **Risk:** medium. A spline camera can clip into terrain or reveal the edge of the model domain. Keep the fog, and keep the current `flyTo` as a fallback behind a flag. The time engine is new code on the critical path, so ship it behind `?engine=1` until the Playwright hero test passes.

### Moment B: "Thirty-six hours in thirty seconds" (the storm time-lapse)

Why a judge remembers it: they watch the 2015 flood come in, the Chembarambakkam release push down the Adyar, and the city drain, and every caption is a number from the model files. It is also the storm the Proof screen tests against, so it hands over to Proof naturally.

Trigger: a "Watch the whole storm" button in the replay row. The user starts it, so it does not break the "one orchestrated moment" rule.

| Time | What the viewer sees |
|---|---|
| 0–2 s | The card collapses to a one-line caption strip, and the timeline widens to full width with the rainfall bars. The camera eases to a wide framing: zoom about 11.6, pitch 50, bearing −25, centred near Saidapet so the Adyar (from the west edge to the sea), Velachery and Pallikaranai are all in view. |
| 2–14 s | Hours 1–11 play at about one hour per second. Rain intensity follows `rain_mm_h`. Captions: "8:30 AM, 1 Dec 2015: rain begins" and "{hour}: {mm} mm in one hour". |
| 14–24 s | The release: the Adyar channel brightens and swells from the west edge. Caption: "Chembarambakkam release, peak {cusecs} cusecs (CAG timeline; modelled as an assumption)". If flow textures exist, ripples visibly run downstream (optional, below). |
| 24–30 s | The rain stops and the shorelines recede; the camera rises and turns about 20°. Caption: "36 hours later, {x}% of the modelled land is still under 15 cm." |
| 30–32 s | For one beat, the 2015 citizen-reported streets fade in as grey lines (`proof/crowd_2015.geojson`): "Grey: streets residents reported flooded." Then two buttons: "Back to my street" and "See how we tested this", which opens Proof. |

How to build it:
- **Data.** Add per-hour statistics to the pipeline output; never compute them in the browser from 8-bit textures.
  - Add `wet_share_15cm_hourly` (land only, with the same masks as `wet_share_15cm`) and `segments_15cm_hourly` (from the street series) to `runs.json`.
  - Add `story/dec2015_reservoir.json`, holding the caption templates and the values they need. The frontend only formats them.
  - A rough count on the raw frames shows the 2015 replay rising for about 11 hours and then draining slowly over the next day, so the "drain" beat exists in the data. Use the pipeline's land-only numbers for the captions, not my raw frame counts.
- **Rendering.** Use the time engine (`play(run, 1, 36, 30_000)`), an `easeTo` for the framing, and a slow `rotateTo` during the drain.
- **Optional flow (+2.5 hours).**
  - A new `pipeline/08_flow.py` derives a flow direction field for each hour from the model's own water surface: −∇(z + h), masked where h < 5 cm. Reproject it like the depth frames and save it as RG8 PNGs.
  - In the water shader, use flow-map texture distortion (Vlachos 2010): advect the ripple normal along the flow with two phase-offset samples cross-faded. There are no particles, only two extra texture reads, and nothing runs on the CPU.
  - Label it in About: "Ripples move in the direction the model's water surface slopes; they do not show speed."
  - If a rerun happens anyway, saving the solver's `qx, qy` at snapshot time takes about 6 lines in `02_fast_model.py` and gives real fluxes. The Michaung run took 52 minutes on this laptop, so do not rerun only for this.
- **Effort:** 4 hours, plus 2.5 hours for the optional flow.
- **GPU cost:** low. Playback uploads one texture per second, and the map repaints continuously only while the time-lapse plays.
- **Risk:** low to medium. The captions must come from pipeline JSON, so allow 30 minutes for that pipeline step.

### Moment C: "Stand in your street" (human scale)

Why a judge remembers it: "154 cm" becomes water at an adult's shoulders on their own street.
- The Weather Channel's 2018 storm-surge segment did this, and a clip of it passed 23 million views.
- NYU's GeoFlood Studio lets users set a human silhouette to their own height to judge depth.
- NYU's Sunset Park study found that 92% of residents preferred a dynamic street-level 3D view to a flood map.

HighGround can do the same with real model numbers.

Trigger: a "See it at street level" button on the answer card.

| Time | What the viewer sees |
|---|---|
| 0–2.5 s | Terrain exaggeration eases from 1.5 to 1.0 (true scale, labelled as such) while the camera drops along the street to eye level: zoom about 18.8, pitch about 78, bearing aligned with the segment so the street recedes into the distance. |
| 2.5 s | Three flat, rain-grey cut-outs stand on the kerb: an adult, a person on a scooter and a hatchback. A gauge post next to them has two marks, 15 cm and 30 cm. A small note says "Figures are typical sizes, for scale." |
| 3–11 s | The street's own hourly series (from the street JSON) plays. A clock in the corner ticks hour by hour as the water rises around the figures. At 15 cm the band chip changes to "Unsafe for two-wheelers", at 30 cm to "Unsafe for cars", and the water keeps rising to the peak. Rain rings dot the surface, and a street lamp's reflection stretches toward the camera. |
| 11–15 s | The camera rises and turns toward the amber route; the flyover pin is the only warm thing in the frame. "Move your car to Velachery MRTS Bridge by 10 PM." |

How to build it, in the same custom layer and with no new library:
- **Figures.** Make three `THREE.ExtrudeGeometry` shapes from hand-drawn SVG paths (loaded with three's `SVGLoader` example module), 0.1 m thick, using an unlit `MeshBasicMaterial` in rain grey at 0.9 opacity. Place them with `MercatorCoordinate.fromLngLat(point, groundElevation)` and scale them by `meterInMercatorCoordinateUnits()`. Flat cut-outs look deliberate and avoid any licence question. Kenney's Car Kit (CC0, glTF) is an optional 3D car.
- **Local water.** Draw a `CircleGeometry` of about 80 m radius at ground level plus depth(t), using the same water colours and a soft radial fade. Fade the regional 30 m water out inside that radius with a `focus` uniform, so the two water levels never conflict.
- **Ground.** With exaggeration at 1.0, `map.queryTerrainElevation(point)` gives the ground height.
- **Depth(t).** Use only the street series values. Interpolate between hours for smooth motion, but display only the hourly numbers.
- **Effort:** 5 hours.
- **GPU cost:** the geometry is tiny. The expensive part is the 78° pitch, so call `map.setSourceTileLodParams()` (see performance item 5) and keep the fog on.
- **Risk:** medium. The 30 m terrain can leave the figures floating or buried by up to a metre. Mitigate this with a small ground disc under the figures and by keeping the camera low. Skip this moment on mobile.

### Considered and dropped

- **Photoreal water** (planar or screen-space reflections): it needs a second scene render or access to the colour buffer, and a MapLibre custom layer has neither. It is too expensive on a Vega 3 GPU. The cheap tricks in section 2 get most of the look.
- **Raindrops on the lens** (Codrops' 2015 rain experiments, Shadertoy rain-on-glass shaders): a full-screen pass that reads as a gimmick. Shadertoy code is also often under a non-commercial licence.
- **A scrollytelling article:** HighGround is a tool. Put the narrative in the blog and in Moment B.
- **Satellite before/after for Michaung:** NRSC's Michaung inundation map (RISAT-1A, 7 Dec 2023) exists only as a PDF, and georeferencing it in 48 hours is not worth it. The NRSC 2015 extent is already in the Proof data, so a third swipe state, "what the satellite saw", is a cheap Proof upgrade if time remains.

---

## 2. Ten quick wins (each under 2 hours)

| # | Win | Hours | Why |
|---|---|---|---|
| 1 | Sea mask | 0.75 | Removes the "flooded Bay" in Michaung and Fengal, which is the demo's opening shot |
| 2 | Organic shorelines | 1 | Hides the 30 m grid |
| 3 | 15 cm and 30 cm contour lines, plus a deep-water rebalance | 1 | Puts the two safety thresholds on the map and gives deep water the most visual weight |
| 4 | Light streaks on wet streets and rain rings | 1.5 | Makes the night streets look wet |
| 5 | Readout count-up and a human-scale glyph in the card | 1.5 | Gives the number a body |
| 6 | Moonlit buildings and extrusion LOD | 1 | Adds depth and removes triangles |
| 7 | Poster first paint and self-hosted glyphs and sprites | 1 | No blank screen, and one fewer third-party dependency |
| 8 | Smooth timeline with your street's depth curve | 1.5 | Scrubbing feels like video, and the card's numbers appear on the timeline |
| 9 | A "live" provenance pill naming AWS | 0.5 | Shows the AWS pipeline at work inside the product |
| 10 | Dawn ending | 1 | The closing shot the spec asks for in the video |

**1. Sea mask.**
- Load `water/sea.png` as a texture. In the fragment shader, either discard sea pixels so the basemap's dark sea shows through (`if (texture2D(seaTex, vUv).r > 0.5) discard;`), or draw the sea with its own calm material: `#0B2029` lifted by a slow fresnel sheen, with no depth ramp.
- Also zero the sea cells in `07_export_tiles.py` (`frame[seam] = 0`). Browser routing samples the same frames per hour, and this keeps it from reading sea depth near coastal roads.

**2. Organic shorelines.** This is display only; no numbers change.
```glsl
// B-spline 4-tap filter (Sigg & Hadwiger) rounds the 30 m cells
vec4 cubicW(float v){ vec4 n = vec4(1.,2.,3.,4.) - v; vec4 s = n*n*n;
  float x = s.x, y = s.y - 4.*s.x, z = s.z - 4.*s.y + 6.*s.x; return vec4(x, y, z, 6. - x - y - z) / 6.; }
float bicubicR(sampler2D t, vec2 uv, vec2 size) {
  vec2 inv = 1.0 / size; uv = uv * size - 0.5; vec2 f = fract(uv); uv -= f;
  vec4 xc = cubicW(f.x), yc = cubicW(f.y);
  vec4 c = uv.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (c + vec4(xc.yw, yc.yw) / s) * inv.xxyy;
  float a = texture2D(t, o.xz).r, b = texture2D(t, o.yz).r, c2 = texture2D(t, o.xw).r, d = texture2D(t, o.yw).r;
  float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
  return mix(mix(d, c2, sx), mix(b, a, sx), sy);
}
// ground-anchored jitter of the visible edge only (about ±2 cm)
float jitter = (noise(vUv * vec2(1700.0, 2950.0)) - 0.5) * 0.04;
if (depth + jitter < minDepth) discard;
```
The bicubic filter costs four texture reads per depth texture, so switch it on with a uniform only at zoom 14 and above.

**3. Contour lines and deep-water weight.**
```glsl
float iso(float d, float level) { float w = fwidth(d); return 1.0 - smoothstep(0.5 * w, 1.5 * w, abs(d - level)); }
float lines = max(0.45 * iso(depth, 0.15), 0.9 * iso(depth, 0.30)) * zoomIn;   // zoomIn: 0 below zoom 14
col = mix(col, vec3(0.79, 0.83, 0.85), lines);                               // rain grey
float a = opacity * edge * mix(0.45, 1.0, t);                                // shallow translucent, deep opaque
```
Add a legend line to the card: "Thin line: 15 cm, two-wheelers stall. Bold line: 30 cm, cars stall."

**4. Light streaks and rain rings.** Wet asphalt reflects a lamp as a streak running toward the viewer, not a round dot, so replace the round glints with streaks, and add rain rings when zoomed in. Compute both in local metres derived from `vUv`: Mercator world coordinates divided down to metres lose float32 precision (around ±2 m).
```glsl
uniform vec2 domainM;      // grid size in metres
uniform vec2 camUv;        // camera position projected into the grid's uv, set per frame on the CPU
uniform vec2 lightsUv[12];
vec2 toCam = normalize((camUv - vUv) * domainM);  vec2 side = vec2(-toCam.y, toCam.x);
float streak = 0.0;
for (int i = 0; i < 12; i++) {
  vec2 d = (vUv - lightsUv[i]) * domainM;
  float along = dot(d, toCam), across = dot(d, side);
  streak += step(0.0, along) * exp(-across * across / 36.0) * exp(-along / 140.0);
}
col += mix(amber, rainGrey, 0.5) * streak * (0.6 + 0.4 * n1) * 0.5;   // desaturated: pure amber stays for safety

// rain rings: one drop per 1.2 m cell, only above zoom 16; p = vUv * domainM
float rings(vec2 p, float t, float rate) {
  vec2 g = p / 1.2, id = floor(g), f = fract(g) - 0.5;
  float h = hash(id), ph = fract(t * 0.9 + h);
  vec2 c = (vec2(hash(id + 7.1), hash(id + 3.7)) - 0.5) * 0.6;
  float r = length(f - c);
  return sin(48.0 * (r - 0.45 * ph)) * smoothstep(0.45 * ph + 0.08, 0.45 * ph, r) * (1.0 - ph) * step(h, rate);
}
```
Feed the rings into the normal perturbation. `rate` is the hourly rain divided by 25 mm, the same scale the rain streaks already use.

**5. Count-up and human-scale glyph.**
- Animate the readout as in Moment A. Today the width and weight mapping saturates at 90 cm (`k = cm / 90`), so 93 cm and 154 cm look identical. Map it over 0–150 cm with an ease-out curve instead.
- Add an inline SVG to the card: an adult, a scooter rider and a hatchback drawn at true relative size. Fill a water band up to the street's peak in the depth ramp, mark 15 cm and 30 cm with ticks, and caption it "Typical sizes, for scale". No new numbers.

**6. Buildings.**
- Add a style-level `light`, for example `{ anchor: 'viewport', color: '#B8C7D9', intensity: 0.35, position: [1.15, 200, 35] }`, so walls facing the moon separate from walls in shadow. Make roofs one step lighter than walls.
- Set `minzoom: 13.5` and `'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.2, 0.85]`, so buildings fade in instead of popping and the horizon carries fewer of them.
- Optional window glow: use a 64×64 sprite with two or three dim warm windows as `fill-extrusion-pattern` above zoom 15.5. This delivers the spec's "faint amber window glow". Test the cost first, because patterned extrusions draw in an extra pass.

**7. Poster first paint.**
- Render one 1440×900 still of the opening's first frame offline with Playwright, using the same script that makes the review shots. Save it as WebP and set it as the `.map` container's background; remove it on the map's first `render`.
- Self-host `glyphs` and `sprite`, which are currently fetched from `protomaps.github.io`, in the S3 bucket behind CloudFront.
- Add `<link rel=preload>` for `water/meta.json` and `water/elev.png`.

**8. Smooth timeline.**
- With the time engine in place, set the timeline input's `step` to 0.05.
- Draw your street's depth series as a thin line over the rain bars (in the depth ramp colour), with a dashed 15 cm reference line.
- Draw the leave-by marker in rain grey or white; amber stays reserved for the safe place itself.
- Show the clock in `font-variant-numeric: tabular-nums` so it does not jitter during playback. If Anek Latin lacks `tnum`, give the clock a fixed width instead.

**9. Provenance pill.** Add a pill to the top bar, filled from `current.json`: "Forecast checked 2:00 AM · AWS Lambda on an EventBridge schedule · Open-Meteo". Clicking it opens a small panel naming the path: EventBridge → Lambda → S3 → this map, SNS for email, and Bedrock for the alert text. This makes "built on AWS" visible in the product and in the video without a diagram.

**10. Dawn ending.** On the last hour of a replay, or when the What-if slider is dragged back to 50 mm, tween `setSky` and the background from storm sky to a pale blue-grey over 3 seconds, take the rain to 0 and reduce the ripples. The spec closes the video "on the city at dawn with water receding", and this produces that shot honestly from the last modelled hour.

---

## 3. Performance on an integrated GPU, ranked by impact

Measure before and after on an idle machine; the model runs kept the load average at 7–12. Record p50 and p95 frame time for four states: idle on the answer card, the opening flight, scrubbing, and the time-lapse. Budget: p95 under 20 ms when idle and scrubbing, and under 33 ms during the flight. The existing `tests/profile_idle.mjs` measures the requestAnimationFrame rate; add frame-time percentiles from `map.on('render')`.

1. **Stop redrawing when nothing changes. This is the biggest win (0.5 hours).** In `WaterLayer.render()`:
   - Request a repaint every frame only while something is animating: the rise, a cross-fade, the time-lapse or a camera move.
   - For ambient ripples and rain, throttle repaints to 30 Hz with a `setTimeout`.
   - When ripples are faded out (below zoom 13) and rain is off, request nothing.
   - After 20 seconds without input, let ambient motion stop until the next pointer event.

   MapLibre already renders on demand; this change lets it.
   ```ts
   const animating = this.anim.length > 0 || this.playing
   const ambient = !this.lowPower && !this.still && (rainVisible || ripplesVisible)
   if (animating) this.map.triggerRepaint()
   else if (ambient && !this.tick) this.tick = window.setTimeout(() => { this.tick = 0; this.map.triggerRepaint() }, 33)
   ```
2. **Move decoding, blending and A* off the main thread (2 hours).**
   - One module worker, using `comlink` 4.4.2, owns frame decoding, run blending, and `leaveByPlan` with A* over the 206k-edge graph. `OffscreenCanvas` is available in workers for the decoding.
   - The worker returns only the route and the leave-by hour.
   - Rendering uses ImageBitmap textures through the time engine, so the main thread never touches pixel arrays.

   This is what makes the opening flight smooth.
3. **Blend on the GPU with the time engine (1.5 hours).** This removes the CPU mix in `showFrame` and the 4.8 MB `Float32Array` allocated on every call. Textures upload only when the hour changes.
4. **Cap the pixel ratio and MSAA (0.5 hours).**
   - Set `pixelRatio: Math.min(devicePixelRatio, 1.5)` in the Map options, and enable `antialias` only when the ratio is 1.25 or less.
   - Add a one-way governor: if p95 frame time stays above 25 ms for 3 seconds during motion, step quality down.
     - Step 1: glints and rings off.
     - Step 2: rain from 4k to 1.5k streaks, and a coarser water mesh.
     - Step 3: `map.setPixelRatio(1)`.
   - Never step back up within a session: three.js forum reports show that switching back and forth causes oscillation and black frames.
5. **Load fewer tiles at high pitch (0.5 hours).**
   - Call `map.setSourceTileLodParams(maxZoomLevelsOnScreen, tileCountMaxMinRatio, 'protomaps')`. Lower `tileCountMaxMinRatio` from the example's default of 3 to about 1.5–2, and keep or raise `maxZoomLevelsOnScreen`; a higher value makes tiles coarsen faster toward the horizon. Tune both with MapLibre's level-of-detail example sliders.
   - Start extrusions at zoom 13.5 with a fade.
   - Set `maxPitch` to 70, except during Moment C.
   - Set `renderWorldCopies: false`.
6. **Water mesh LOD (0.5 hours).** The mesh is 417 × 725 vertices (step 2, about 600k triangles) at every zoom. Build a second mesh at step 6 and draw it below zoom 13. Depth is sampled per pixel anyway, so the shorelines do not change.
7. **A lighter shader (0.5 hours).**
   - Replace the sin-hash value noise (8 `sin` calls per pixel for two octaves) with a 256² tiling noise texture.
   - Skip the 12-light loop below zoom 13.
   - Keep the early `discard` ahead of any lighting maths.
8. **Network and first paint (1 hour).**
   - CloudFront: compression on for JSON and GeoJSON and off for PMTiles and PNG.
   - Send `Cache-Control: public, max-age=31536000, immutable` on versioned model outputs and a short TTL on `current.json`.
   - Turn on HTTP/3 and self-host the glyphs and sprites.
   - Load Proof, Hospitals, About and the Assistant with `React.lazy`.
9. **Proof's second map (0.5 hours).** Give the right-hand map `pixelRatio: 1` and no `antialias`; it redraws only on the synced `move` events. With item 1 in place, the main map also stops redrawing at idle on the Proof screen.
10. **Frame-perfect footage for the video (2 hours, optional).**
    - Playwright's `recordVideo` captures in real time, so any stutter ends up in the video.
    - Playwright's `page.clock` controls `requestAnimationFrame`, `performance` and timers. Call `page.clock.install()`, then loop `page.clock.runFor(1000 / 60)` and `page.screenshot()`.
    - Assemble the frames with `ffmpeg -framerate 60 -i f%05d.png -c:v libx264 -crf 16 -pix_fmt yuv420p out.mp4`; `/usr/bin/ffmpeg` is installed.
    - Tiles still stream in real time, so run each shot once to warm the cache and wait for the map's `idle` event before stepping.
    - A simpler alternative: a teammate screen-records the live site with OBS on a faster laptop.

---

## 4. Richer 3D: what is feasible and licence-safe

| Option | What it adds | Licence and terms | Fit here | Verdict |
|---|---|---|---|---|
| Google Photorealistic 3D Tiles | Photogrammetry of the city | Map Tiles API key and billing. The Google logo and live data attributions must stay visible. No offline use. Reading heights or measurements from the tiles is prohibited. | Needs CesiumJS, deck.gl or 3DTilesRendererJS alongside MapLibre, and streams hundreds of MB of textured meshes on a Vega 3. It also puts Google into an AWS story, and Chennai coverage is unverified. | No |
| Cesium ion (OSM Buildings, or Google tiles through ion) | Similar | Needs an ion account and token | Another platform with the same weight | No |
| **Google Open Buildings 2.5D Temporal** | Building-height raster: 0.5 m pixels, about 4 m effective resolution, 2016–2023 | Your choice of CC BY 4.0 or ODbL. Cite Sirko et al. 2023; the data includes Copernicus Sentinel-2 imagery. | Verified: 16 Cloud-Optimized GeoTIFF tiles in a public bucket cover the model domain. Reading one tile at its 3.5 m overview took about 60 s. In that tile, building pixels had a median height of 6 m, p90 of 14.6 m and a maximum of 97 m. | **Yes, if time allows (2.5–3 hours)** |
| GlobalBuildingAtlas (TUM) | LoD1 blocks and heights worldwide | Heights and LoD1 are CC BY-NC 4.0; the code is MIT plus Commons Clause | The non-commercial terms are a grey zone for an event with prizes | Avoid |
| 3D-GloBFP; GOBS (India) | Per-footprint heights | No licence stated on the pages I could read | — | Skip |
| Copernicus DSM minus DTM (already on disk) | Rough heights | Already credited | At 30 m, 2–4 storey buildings smear to 1–2 m | Fallback only |
| glTF landmarks (temple gopurams, Chennai Central) | Recognisable buildings | Licences vary by model | Does not help anyone read flood depth | No |
| Kenney Car Kit | Low-poly cars | CC0 | Optional, for Moment C | Optional |

**Recommendation:** skip photogrammetry. If an evening is left after the shortlist, give the buildings real heights from Open Buildings 2.5D Temporal. These commands use the GDAL already in the `highground` environment:

```bash
source pipeline/env.sh
B=https://storage.googleapis.com/open-buildings-temporal-data/v1/geotiffs/3
for t in a524_2023_06_30/tile_bMAyJhwF04o a524_2023_06_30/tile_2ZOrWfuSyvw a524_2023_06_30/tile_xB3P2zEVTXY \
         a524_2023_06_30/tile_5MgVJxIbdgc a524_2023_06_30/tile_EhGKuQzFK5M a524_2023_06_30/tile_QRmV1ZcMwPI \
         a524_2023_06_30/tile_MNfG-fd5bJU a524_2023_06_30/tile_IKOw5SMaQxI a524_2023_06_30/tile_h6BXqAc59Qw \
         a524_2023_06_30/tile_4eb0AlaCM3s a524_2023_06_30/tile_400NJ7e-swM a524_2023_06_30/tile_x8aEdHJZP9M \
         a52c_2023_06_30/tile_JaML0xxcj1U a52c_2023_06_30/tile_xECnh9sQxCI a52c_2023_06_30/tile_KXzByBm39lI \
         a52c_2023_06_30/tile_Dk2qnJOt5vM; do echo "/vsicurl/$B$t.tif"; done > data/work/ob_tiles.txt
gdalbuildvrt -b 2 -input_file_list data/work/ob_tiles.txt data/work/ob_height.vrt     # band 2 = building_height
gdalbuildvrt -b 3 -input_file_list data/work/ob_tiles.txt data/work/ob_presence.vrt   # band 3 = building_presence
gdalwarp -ovr AUTO -tr 4 4 -r average -te 402000 1420000 428000 1465000 data/work/ob_height.vrt   data/work/ob_height_4m.tif
gdalwarp -ovr AUTO -tr 4 4 -r average -te 402000 1420000 428000 1465000 data/work/ob_presence.vrt data/work/ob_presence_4m.tif
```

The tiles come from the bucket's manifest `v1/manifests/3b_EPSG_32644_2023_06_30.json` and are already in EPSG:32644, the project CRS.

Then:
1. Rasterize the OSM footprint IDs from `data/work/osm.gpkg` onto the same 4 m grid (`rasterio.features.rasterize`).
2. For each building, take the 75th percentile of height where presence is above 0.5 (`scipy.ndimage` labelled statistics). Default to 6 m when nothing matches, and clamp to 3–100 m.
3. Write newline-delimited GeoJSON and build tiles with `tippecanoe -o buildings.pmtiles -l buildings -Z13 -z16 --drop-densest-as-needed -y height` (tippecanoe 2.79.0 is on conda-forge).
4. Host the file on S3 and point `buildings-3d` at the new source.
5. Add the attribution to About and to the map credits: "Building heights: Google Open Buildings 2.5D Temporal (CC BY 4.0), contains modified Copernicus Sentinel-2 data".
6. Say in About that building heights are approximate and decorative; the flood model uses footprints only.

---

## 5. Design direction (a short design.md)

### Concept
Chennai at 2 AM, mid-storm, seen by someone who has to decide whether to move their car. Sodium light on wet asphalt. The water is the protagonist; everything else is a quiet instrument around it.

### Seven principles
1. **Light, not colour, carries the night.** Land, roads and buildings sit within a narrow dark band (contrast against storm sky of 1.0–1.8:1). Brightness is spent only on water, answers and safe places.
2. **Depth is the message, and deeper means more weight.** Shallow water is translucent; deep water is opaque, carries a rim and specular highlights, and is marked by the 30 cm contour. Never let a puddle outshine a metre of water.
3. **Amber means safety, and nothing else.** Pure `#F2A541` appears only on safe ground, parking pins and the safe route. Junction glints and window glow use a desaturated mix (amber with rain grey, 50/50) at low intensity, so the eye still finds the one truly amber thing in the frame.
4. **Human scale before map scale.** Every depth can be read against a body: the glyph in the card, the figures at street level.
5. **Every number shows its source.** "From the model" chips stay. Captions in the time-lapse come from pipeline JSON. Typical object sizes are labelled as typical.
6. **Motion has a reason.** Things move only because time passes or water rises. The only autonomous motion is the opening; the time-lapse and the street dive are user-triggered. Ambient rain and ripples stop when the user stops.
7. **Quiet chrome.** Solid panels, 1 px rules, sentence case, no glass, no gradient blobs, no hover animation. Red appears only on the 112 line.

### Luminance budget (contrast against storm sky `#14303D` unless noted)

| Element | Token | Contrast | Rule |
|---|---|---|---|
| Answer text and readout | Rain grey `#C9D4D8` on panel `#0E2530` | 10.5:1 | The brightest thing on screen |
| Shallow water, contours | `#7FD3D8` | 8.0:1 | Translucent (alpha about 0.45) so it does not outshine deep water |
| Safe place, route | `#F2A541` | 6.7:1 | The only warm hue at full saturation |
| Deep water | `#1C6E9C` | 2.5:1 | Compensate with opacity 1.0, the 30 cm rim and specular highlights |
| Roads | `#3E5560` | 1.8:1 | Background |
| Land | `#14303D` | — | Base |

### Water material
Use the depth ramp (shallow to deep) with alpha `mix(0.45, 1.0, t)`. Add:
- 15 cm and 30 cm isolines in rain grey above zoom 14;
- a fresnel lift toward sky colour;
- light streaks toward the camera and rain rings above zoom 16;
- ripples advected along flow, if the flow textures are built;
- a masked sea with its own calm, dark material;
- shorelines with the B-spline filter and a ±2 cm visual jitter.

### Type
- **Anek Latin** for the readout. Width runs from 78 to 125 and weight from 380 to 800, mapped over 0–150 cm with an ease-out curve. Use tabular digits for clocks.
- **Hind** for body text.
- Sentence case everywhere.
- The number is set large, and the unit is set at 40% of its size in rain grey dim.

### Motion
- Camera moves take 1.2–3.2 s with an ease-in-out cubic curve. UI transitions take 200–240 ms with fades, not bounces.
- The water rise is always the model's own hourly frames, never a uniform scale.
- With `prefers-reduced-motion`, jump to final frames.

### Sound (optional, off by default)
- A single "Sound" toggle in the top bar; browsers require a user gesture before audio can start.
- A rain bed whose level follows the hourly rainfall. No music and no alert sounds.
- Either procedural Web Audio (filtered noise plus random droplet bursts, no files) or the CC0 "Rain (loopable)" pack on OpenGameArt.

### AWS visibility
Show the provenance pill, name Amazon Location as the source of address results in the search hint, show the real SNS email, and use an "Answers from Amazon Bedrock, grounded in the model files" line in the assistant panel. Self-host every asset on CloudFront.

### References worth opening

- **Human-scale water**
  - The Weather Channel's immersive storm-surge segments (Pew write-up): https://www.pew.org/en/research-and-analysis/articles/2018/12/03/the-weather-channel-uses-animation-to-show-dangers-of-storm-surge
  - NYU GeoFlood Studio (3D neighbourhood floods, adjustable human silhouette): https://engineering.nyu.edu/news/nyu-tandon-researchers-launch-interactive-3d-flood-map-help-new-yorkers-visualize-climate
  - NYU Sunset Park street-level flood study (92% preferred 3D): https://engineering.nyu.edu/news/new-3d-flood-visualizations-help-communities-understand-rising-water-risks
  - Submerse, storm-surge simulation visualisation (Stony Brook): https://arxiv.org/html/2304.06872v2
- **Flood-model storytelling**
  - Washington Post, Gulf Coast flooding and sea-level rise (one modelled area, scenarios compared): https://www.washingtonpost.com/climate-environment/interactive/2024/flooding-sea-level-rise-gulf-coast/
  - Washington Post, D.C. flood risk: https://www.washingtonpost.com/climate-environment/interactive/2023/dc-low-lying-city-flood-risks/
  - Overstroom ik? (Dutch government "how high could the water get at my postcode"): https://overstroomik.nl/en
  - Google Flood Hub (inundation maps instead of river levels): https://blog.google/technology/ai/expanding-our-ml-based-flood-forecasting/
- **Flow and motion**
  - Mapbox "How I built a wind map with WebGL" (GPU particles): https://blog.mapbox.com/how-i-built-a-wind-map-with-webgl-b63022b5537f
  - earth.nullschool.net: https://earth.nullschool.net/
  - Windy: https://www.windy.com/
  - SCALGO Modelspaces velocity animation styles (semi-transparent white traces over depth): https://scalgo.com/de/blog/modelspaces-new-features
  - Esri FlowRenderer for flood simulations: https://www.esri.com/arcgis-blog/products/arcgis-online/3d-gis/arcgis-flowrenderer-flood-simulation-visualization
- **Water rendering**
  - Vlachos, "Water Flow in Portal 2" (flow maps): https://www.advances.realtimerendering.com/s2010/Vlachos-Waterflow(SIGGRAPH%202010%20Advanced%20RealTime%20Rendering%20Course).pdf
  - Catlike Coding, texture distortion: https://catlikecoding.com/unity/tutorials/flow/texture-distortion/
  - Evan Wallace, WebGL Water: https://madebyevan.com/webgl-water
  - Evan Wallace, caustics write-up: https://medium.com/@evanwallace/rendering-realtime-caustics-in-webgl-2a99a29a0b2c
  - Evan Wallace, anti-aliased grid and isolines: https://madebyevan.com/shaders/grid
  - Codrops rain-on-glass experiments (reference, not recommended): https://tympanus.net/codrops/2015/11/04/rain-water-effect-experiments/
- **Night city and 3D restraint**
  - Mapbox Standard light presets: https://docs.mapbox.com/map-styles/standard/guides
  - The Pudding, Human Terrain: https://pudding.cool/2018/10/city_3d/
  - NASA Black Marble: https://www.earthdata.nasa.gov/data/projects/black-marble
- **MapLibre examples**
  - Level-of-detail control: https://maplibre.org/maplibre-gl-js/docs/examples/level-of-detail-control/
  - Sky, fog and terrain: https://maplibre.org/maplibre-gl-js/docs/examples/sky-fog-terrain/
  - three.js models: https://maplibre.org/maplibre-gl-js/docs/examples/add-3d-tiles-3d-objects-and-models-using-threejs/
  - Performance metrics: https://maplibre.org/maplibre-gl-js/docs/examples/display-performance-metrics/
  - August 2026 newsletter (6.x features): https://maplibre.org/news/2026-09-02-maplibre-newsletter-august-2026/
- **Data and licences**
  - Open Buildings 2.5D Temporal: https://sites.research.google/gr/open-buildings/temporal
  - Open Buildings in the Earth Engine catalog: https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1
  - GlobalBuildingAtlas licences: https://github.com/zhu-xlab/GlobalBuildingAtlas
  - Google Map Tiles API policies: https://developers.google.com/maps/documentation/tile/policies
  - Kenney Car Kit (CC0): https://kenney-assets.itch.io/car-kit
  - OpenGameArt "Rain (loopable)" (CC0): https://opengameart.org/content/rain-loopable
  - Procedural Web Audio textures: https://dev.to/hexshift/how-to-generate-procedural-audio-textures-in-the-browser-no-samples-needed-332l
  - NRSC Michaung inundation map (PDF): https://www.nrsc.gov.in/sites/default/files/pdf/DMSP/TN_7_12_2023_Michaung_Cyclone1of2.pdf
- **Tooling**
  - Playwright clock: https://playwright.dev/docs/clock
  - Mediabunny (WebCodecs MP4): https://mediabunny.dev/
  - canvas-record 6.0.0: https://npmjs.com/package/canvas-record
  - drei PerformanceMonitor (idea to port): https://drei.docs.pmnd.rs/performances/performance-monitor
  - three.js forum on pixel-ratio switching pitfalls: https://discourse.threejs.org/t/changing-pixelratio-based-on-fps-good-or-bad-idea/34563

Library versions checked today: maplibre-gl 6.13.0 and three 0.186.1 (both already installed), comlink 4.4.2, howler 2.2.4 (not needed if you use raw Web Audio), stats-gl 4.2.3, canvas-record 6.0.0, and tippecanoe 2.79.0 (conda-forge). If you add Mediabunny, pin a release that is at least two weeks old; 1.61.3 came out on 5 Oct.

---

## 6. Shortlist: the next 24 hours, in order

| # | Build | Hours | Gate |
|---|---|---|---|
| 1 | **Water truth pass:** sea mask, organic shorelines, 15/30 cm contours and the deep-water rebalance (quick wins 1–3) | 2.5 | Michaung opening and Loop Road screenshots show a dark sea and smooth shores; the hero test passes |
| 2 | **Performance pass:** idle throttle, pixel-ratio cap, tile LOD, extrusion fade, and the worker for decoding, blending and A* (performance items 1, 2, 4, 5) | 3.5 | p95 frame time under 20 ms when idle and under 33 ms in the flight on an idle machine; no main-thread task over 50 ms during the flight |
| 3 | **Time engine plus Moment B**, the 2015 time-lapse with captions from the pipeline (including the hourly-stats step) | 4.5 | Every caption number traces to `runs.json` or `story/*.json`; plays at 60 fps on the dev server |
| 4 | **Moment A on the time engine:** model-timed rise, spline glide, city glow, count-up and the human-scale glyph (quick win 5) | 3 | `review/design` load sequence at 3, 9 and 18 s; reduced motion jumps to the final frame |
| 5 | **Moment C, "Stand in your street"** | 5 | Five demo streets: figures sit on the ground, and the depth shown equals the street series |

That is 18.5 hours, leaving room for deployment, the video and fixes.

- **If an hour is left:** the provenance pill (0.5 h) and the dawn ending (1 h).
- **Then, in this order:** frame-perfect footage capture (2 h), flow-map ripples (2.5 h), and Open Buildings heights (3 h).
- **Zero code:** submit the live URL twice, once plain and once with `?replay=michaung2023`, so a judge on a dry Sunday still lands on the story. The replay is clearly labelled in the app.
- **Honesty checks for every new item:**
  - Any number on screen comes from pipeline JSON, never from the 8-bit textures.
  - Typical object sizes are labelled as typical.
  - Flow ripples are described as direction only.
  - Building heights are described as decorative.
