# HighGround — project spec (read this first, every session)

HighGround shows Chennai residents where floodwater will go tonight, street by street, and what to do about it: whether their street floods, where to park their car on dry ground, a route that avoids water, and which hospitals get cut off.

Built for **Environmental Hacks (Bharat Builds Tour, AWS)**, Heat and Water track. Judging: idea and impact, built on AWS, design and usability, execution, 3-minute demo video. Every decision below serves one of those.

Positioning (use this language in the app and video): Chennai already has CFLOWS, a government flood warning system built for officials. HighGround is for the residents who still park their cars on the Velachery flyover every storm because nobody tells them where the water will go. We do not claim a better model than CFLOWS; we claim a tested one, built for citizens.

---

## Non-negotiables

1. **One hero flow works end to end before anything else is polished:** type an address → camera flies to the street → water rises to tonight's forecast depth → answer card with depth and time → nearest dry parking → "Email me if this changes" works for real.
2. **AWS is load-bearing, not decorative.** Open data from S3, Lambda, DynamoDB, SNS, EventBridge, Bedrock, Amazon Location Service, Amplify/CloudFront, and the Strands Agents SDK (AWS open source).
3. **60fps on a laptop.** No live hydraulic compute in the browser. Scenarios are precomputed; the browser only blends textures.
4. **Never invent numbers.** Every depth, time, and percentage on screen or in an LLM reply comes from model output files.
5. **Honest limits are shown in the app** ("About the model" panel). Judges trust projects that know their limits.
6. English only.

---

## Setup Claude handles itself (do not ask the user)

- Linux laptop. Install everything **in user space, without sudo** (sudo needs a password Claude cannot type): Miniforge in `~/miniforge3` (conda-forge env `highground` with gdal, rasterio, numba, anuga, geopandas, osmnx), Node LTS via nvm, AWS CLI v2 and SAM CLI to `~/.local`, Playwright browsers. If something truly needs sudo, find a user-space alternative or log it under "FOR THE USER".
- Read settings from `.env` in the repo root: `AWS_PROFILE`, `AWS_REGION`, `ALERT_TEST_EMAIL`.
- Check AWS access with the `highground` profile; create the $10 budget alarm via `aws budgets` if it does not exist.
- Check Bedrock model access via the CLI; if Claude Sonnet is not enabled, use the newest enabled Claude model and log it.
- Read the event rules page (wemakedevs.org, Environmental Hacks) if browsing is available and log the deadline in `PROGRESS.md`.

The only things Claude cannot do (the user does these once, outside the session): verify students on AWS Builder Center, configure AWS credentials, and click the SNS confirmation link in their inbox. Never wait on these; log them in `PROGRESS.md` under "FOR THE USER" and carry on.

---

## Architecture

```
OFFLINE (Python, run on laptop or one EC2 instance)
  Copernicus DEM (s3://copernicus-dem-30m) ─┐
  OpenStreetMap (buildings, roads, rivers,  ├─► conditioning ─► fast citywide model (local-inertial 2D)
    hospitals, bridges, parking)            │                  ─► ANUGA detail model (Velachery box)
  Rainfall scenarios + 2015 replay ─────────┘                  ─► validation vs 2015 reports + GCC zones
                                                                ─► outputs: depth tiles, street JSON,
                                                                   routing graph, proof.json ─► S3

ONLINE (AWS)
  CloudFront ─► S3 (static site via Amplify Hosting, terrain tiles, depth tiles, PMTiles basemap, JSON)
  EventBridge Scheduler (every 3 h) ─► Lambda forecast-check
        ─► Open-Meteo hourly precipitation for 4 Chennai points
        ─► pick/blend scenario ─► write current.json to S3
        ─► diff risk per street vs last run ─► Bedrock writes plain-English alert ─► SNS email
  API Gateway ─► Lambda subscribe (DynamoDB subscribers, SNS email subscription with filter policy)
  API Gateway ─► Lambda assistant (Strands agent on Bedrock, tools read model outputs)
  Amazon Location Service ─► address search (geocoding, biased to Chennai)

BROWSER
  MapLibre GL JS (3D terrain + dark basemap + extruded buildings)
  three.js custom layer (water plane + depth texture shader, instanced rain)
  Routing in-browser (A* over precomputed graph with per-scenario edge flags)
```

---

## Repo layout

```
highground/
  CLAUDE.md
  pipeline/                 # Python, offline
    00_fetch.py             # DEM tiles, OSM extract, validation KMLs
    01_condition.py         # DTM approximation, buildings, river burn, landcover
    02_fast_model.py        # local-inertial 2D solver (numba)
    03_anuga_velachery.py   # ANUGA detail run (timeboxed, optional)
    04_streets.py           # per-road-segment depth, time-to-15cm
    05_features.py          # parking candidates, routing graph, hospital reachability
    06_validate.py          # 2015 replay metrics -> proof.json
    07_export_tiles.py      # depth rasters -> PNG tiles; terrain-RGB; upload to S3
    config.yaml             # bbox, CRS, scenarios, thresholds, calibration params
  infra/                    # AWS SAM template (SAM CLI = AWS open source tool)
    template.yaml
    functions/
      forecast_check/
      subscribe/
      assistant/            # Strands Agents SDK
  web/                      # Vite + React + TypeScript
    src/
      map/                  # MapLibre setup, terrain, basemap style
      water/                # three.js custom layer, shaders, rain
      screens/              # Tonight, WhatIf, Proof, Hospitals
      lib/                  # routing (A*), data loaders, scenario blending
      ui/                   # answer card, timeline scrubber, assistant panel
  docs/
    architecture.png        # for the video and README
```

---

## Data sources (exact)

| What | Where | Notes |
|---|---|---|
| Elevation | `s3://copernicus-dem-30m/` (no AWS account needed, `--no-sign-request`) | Tiles `Copernicus_DSM_COG_10_N13_00_E080_00_DEM` and `..._N12_00_E080_00_DEM` cover Chennai. It is a surface model (buildings, trees included). |
| Roads, buildings, rivers, drains, hospitals, bridges, parking | OpenStreetMap via Geofabrik Southern Zone extract or Overpass API | Filter to bbox. |
| Forecast rain | Open-Meteo forecast API, hourly `precipitation` | Free, no key. Sample 4 points: Velachery, T. Nagar, Anna Nagar, Tambaram. |
| Validation: citizen reports | OpenCity "Chennai 2015 Crowd-sourced Flooding Locations" (KML, ~5 MB, public domain) | From the osm-in flood-map project. |
| Validation: official zones | OpenCity "Chennai Flood Hazard Zones Map" (KML, GCC) | High / moderate / low. |
| Basemap | Protomaps PMTiles extract for Chennai, hosted on S3 | Single file, custom dark style. |

**First command of the project:** `aws s3 ls --no-sign-request s3://copernicus-dem-30m/ | grep -E "N1[23]_00_E080"`. GLO-30 Public is missing some countries' tiles. If Chennai's tiles are absent, fall back to NASA SRTM 1-arc-second (30 m, bare-ish earth, older) and note it in the About panel. Do not use GLO-90; 90 m is too coarse for streets.

Model domain: Greater Chennai Corporation area (~462 km²). Working CRS: **EPSG:32644** (UTM 44N). Grid: 30 m citywide (~1000×1000 cells).

---

## The model

### Stage A — fast citywide model (must ship)

1. **Approximate a bare-earth DTM from the DSM:** mask OSM building footprints and dense tree areas, fill masked cells by interpolation from surrounding ground, then a light percentile filter (5th percentile, 3×3) to strip residual clutter.
2. **Re-add buildings as obstacles:** +3 m on building cells, so water flows along streets, not through houses.
3. **Burn waterways:** lower Adyar, Cooum, Buckingham Canal, and OSM `waterway=canal|drain|river` cells by 2 m so they convey water to the sea.
4. **Land cover → losses:** impervious (buildings, roads) vs pervious (parks, marsh). Infiltration only on pervious cells. Storm drains modelled as a uniform **drainage capacity in mm/hour** removed from ponded water on urban cells — a calibration parameter, not a claimed fact.
5. **Solver:** local-inertial 2D shallow-water scheme (the LISFLOOD-FP formulation, Bates et al. 2010): explicit, stable with an adaptive timestep, ~100 lines in numba. Rain is a source term. Sea boundary: fixed water level at the coast (two tide states: mean and high).
6. **Scenarios:** 24-hour storms of 50, 100, 150, 200, 300, 400 mm with a front-loaded temporal pattern, × 2 tide states = 12 runs; plus three **historical replays**:
   - **1–2 Dec 2015** (~374 mm in a day at the worst stations). Much of the 2015 damage came from the sudden Chembarambakkam reservoir release down the Adyar, not local rain. Model it as an **inflow hydrograph at the Adyar's upstream domain edge**, with the peak flow as a documented assumption in `config.yaml`. Run the replay twice: rain only, and rain + reservoir release.
   - **Cyclone Michaung, Dec 2023** (40+ cm in about 48 hours).
   - **Cyclone Fengal, Nov 2024.**
   Replays power the "Replay a storm" mode and the demo video, so the product never looks empty on a dry day.
7. **Outputs per scenario:** max depth raster, time-to-15 cm raster, depth snapshots every hour (for the timeline scrubber).

### Stage B — ANUGA detail model for Velachery (timeboxed: 4 hours)

- ANUGA (Geoscience Australia's open-source Python 2D shallow-water model) on a ~6×6 km box around Velachery and the Pallikaranai marsh, mesh refined to ~10 m along streets.
- Same rainfall inputs. Used for the "Detail" view and as a cross-check of Stage A (report agreement in the Proof screen).
- **If installation or runtime fails inside the timebox, drop it** and run Stage A at 10 m for the same box instead. Do not let Stage B block anything.

### Calibration without cheating

Calibrate the drainage-capacity parameter on **half** the GCC wards and report validation on the **other half**. Say so in the Proof screen. This one line separates us from every overfit student model.

### Validation (`06_validate.py` → `proof.json`)

Before writing the scoring, **inspect the KML**: print feature count, geometry types (points vs lines), any date or time fields, and plot them over the hillshade. Design the metric around what is actually there. The reports are cumulative over Nov–Dec 2015 and biased toward areas with more internet users; say so on the Proof screen.

Classify each reported location as **river-driven** (within 500 m of the Adyar or Cooum) or **rain-driven** (everything else), and report every metric for both groups, for both the rain-only and rain + reservoir runs. This shows exactly where rain modelling works and why the reservoir mattered.

Run the 2015 replay, then:

- **Hit rate:** share of citizen-reported flooded street segments where the model shows ≥15 cm on at least 30% of the segment's length.
- **Zone agreement:** share of model-flooded area falling in GCC high/moderate zones vs low zones.
- **Baseline comparison:** the same metrics for a naive "lowest 20% of elevation is flooded" map. The model must beat it, and the screen shows both.
- Write all numbers, the calibration/validation split, and thresholds to `proof.json`. The frontend reads only this file.

---

## Citizen features

All computed offline per scenario in `04_streets.py` and `05_features.py`, served as JSON from S3.

- **Will my street flood:** address → Amazon Location Service geocode (biased to Chennai) → nearest road segment → max depth, time it reaches 15 cm, depth at each hour for the scrubber. Risk bands: dry (<5 cm), wet (5–15), unsafe for two-wheelers (15–30), unsafe for cars (>30).
- **Safe car parking:** candidates from OSM (flyovers and bridges on roads, multi-storey parking, large elevated open ground). Keep only those dry in the current scenario; rank by walking distance from the user's street. Show "Check local traffic advisories before parking on a flyover."
- **Flood-safe route:** OSM road graph with per-scenario edge flags (impassable for cars >30 cm, for two-wheelers >15 cm). A* runs in the browser over a compact precomputed graph. Show the normal route greyed, the safe route in amber.
- **Hospital reachability:** for each hospital, whether a dry route exists from the main arterial network, and the share of the city that can still reach it. Panel: "4 of 31 hospitals cut off at 300 mm."

---

## LLM (Amazon Bedrock)

Use the latest Claude Sonnet model available in your Bedrock region (check the model access page in the console).

### Assistant (Strands Agents SDK in Lambda)

- Grounded tools only: `get_street_risk(lat, lon)`, `find_dry_parking(lat, lon)`, `safe_route(from, to)`, `hospital_status()`, `current_forecast()`, `model_limits()`.
- System prompt rules: answer only from tool results; quote the scenario and forecast time; if a tool has no data, say so; never give a number not in a tool result; for danger (water rising inside a home, someone trapped) tell the user to call **112** first.
- The panel shows small "from the model" chips next to every number so judges see the grounding.

### Alerts (forecast-check Lambda)

- Bedrock turns a risk change into two short sentences: what changed, what to do. Example: "Tonight's forecast rose to about 210 mm. Your street may reach 35 cm by 3 AM; move your car to the Velachery flyover before midnight."

---

## Alerts pipeline

- **EventBridge Scheduler** every 3 hours (and a manual "Run now" button in an admin view for the demo).
- Address search: test Amazon Location on 20 Chennai addresses on day one; if results are poor, fall back to Nominatim and say so in the README.
- Lambda: fetch Open-Meteo → 24-hour totals → choose the nearest scenario (interpolate depth between the two nearest) → write `current.json` → compare each subscribed segment's risk band with last run → publish to **SNS** with message attribute `segment_id`.
- **Subscribe:** user enters email + street → DynamoDB record → SNS email subscription with a filter policy on `segment_id` (they confirm via the SNS email).
- **SMS:** sending to Indian numbers requires DLT registration (TRAI), which takes days. Show SMS as "coming soon" in the UI and mention it honestly in the video. Email is the working channel.

---

## Frontend

### Concept

Chennai at 2 AM, mid-storm. The full-bleed 3D city is the hero; the water is the only bold element; everything else is quiet and disciplined.

### Tokens

| Token | Hex | Use |
|---|---|---|
| Storm sky | `#14303D` | base background, basemap land |
| Wet asphalt | `#3E5560` | roads, secondary surfaces |
| Shallow water | `#7FD3D8` | depth ramp start |
| Deep water | `#1C6E9C` | depth ramp end |
| Sodium amber | `#F2A541` | **only** safe ground, parking pins, safe route |
| Rain grey | `#C9D4D8` | text, UI chrome |

Danger is carried by depth colour, not by red. Red appears nowhere except the 112 emergency line.

Type: **Anek Latin** (variable width) for headlines and the depth readout; the readout widens and gains weight as depth increases. **Hind** for body. Sentence case everywhere. No all-caps labels, no arrows appended to buttons, no glassmorphism card grids, no gradient blobs, no hover animation on everything.

### Layout (desktop first)

```
┌──────────────────────────────────────────────────────────────┐
│ HighGround      Tonight   What if   Proof   Hospitals        │
│                                                              │
│              FULL-BLEED 3D CITY (MapLibre + three.js)        │
│              water · rain · amber pins · extruded buildings  │
│ ┌──────────────────┐                        ┌──────────────┐ │
│ │ Search address   │                        │ Ask HighGround│ │
│ │ Your street      │                        │ (assistant)   │ │
│ │ 38 cm by 2 AM    │                        └──────────────┘ │
│ │ Park: Velachery  │                                         │
│ │ flyover, 600 m   │                                         │
│ │ Email me if this │                                         │
│ │ changes          │                                         │
│ └──────────────────┘                                         │
│ 6 PM ──────●──────────────────────────────────────── 6 AM    │
└──────────────────────────────────────────────────────────────┘
```

### Screens

1. **Tonight:** search → fly-to → water rises → answer card → parking → route → subscribe. A **Replay a storm** switch (2015, Michaung 2023, Fengal 2024) runs a historical storm as if it were tonight; when the live forecast is dry, the card says so and offers the replay.
2. **What if:** rainfall slider 50–400 mm, tide toggle; the city responds instantly (texture blend).
3. **Proof:** swipe split-screen. Left: the model running the 2015 replay. Right: citizen-reported flooded streets. Centre: hit rate in large Anek type, the baseline's number beside it, the calibration/validation split in one plain sentence. Below: ANUGA vs fast model agreement for Velachery.
4. **Hospitals:** list and map; cut-off hospitals dim; tap one to see the dry route or "no dry route."
5. **About the model:** limits in plain words (30 m terrain, drains approximated, reservoir release modelled as an assumption, not an official warning, follow GCC/IMD advisories). **Attribution** lines: Copernicus DEM (with the licence's required notice), © OpenStreetMap contributors, Open-Meteo, NOAA/KMA where used, OpenCity and the osm-in flood-map contributors for 2015 data, GCC for hazard zones.

### The one orchestrated moment

On load: camera starts high over the Bay of Bengal at night, descends toward Velachery, rain begins, water rises to tonight's forecast, the answer card appears. Nothing else animates on its own. Respect `prefers-reduced-motion` (skip to the final frame).

### Rendering and performance

- **MapLibre GL JS** with `raster-dem` terrain from terrain-RGB tiles (made with rio-rgbify) on CloudFront; dark custom basemap from a Protomaps PMTiles file on S3; `fill-extrusion` buildings in wet-asphalt tones with faint amber window glow.
- **Water:** three.js custom layer. One plane draped over the terrain; per-scenario depth packed into 16-bit PNG tiles (depth in cm). Shader: depth → colour ramp, scrolling normal map for ripples, specular highlights from fake amber point lights at major junctions, fresnel edge. Scrubbing and the What-if slider blend two depth textures in the shader (`mix`), no reloads.
- **Rain:** GPU-instanced streaks (~5k), camera-relative, fade with zoom.
- Budget: first meaningful paint under 3 s on broadband; 60fps on an integrated-GPU laptop; lazy-load hourly snapshots.

---

## Build order (Friday → Sunday)

**Friday (today): data and model**
0. DEM tile check (see Data sources). Inspect the 2015 KML.
1. `00_fetch` + `01_condition` → render the conditioned DTM as a hillshade to sanity-check (rivers visible, buildings gone).
2. `02_fast_model` on one 200 mm scenario → look at the depth map. Velachery and Pallikaranai should be wet; T. Nagar mostly dry.
3. Run all scenarios + 2015 replay overnight.
4. Start `03_anuga_velachery` in the background; respect the 4-hour timebox.

**Saturday: product**
5. `04`–`07` → tiles and JSON on S3.
6. Frontend: map + terrain + water shader first, then the Tonight flow end to end.
7. Lambdas via SAM: subscribe, forecast-check, assistant. Wire SNS email.
8. What if, Hospitals, routing.

**Sunday: proof and polish**
9. `06_validate` → Proof screen.
10. Polish pass: load sequence, type, copy, empty and error states, reduced motion, README.
11. Record the demo; teammates finish the edit and the blog.

**Fallbacks, in order:** drop ANUGA → drop hospital reachability → simplify routing to "avoid flooded segments" highlighting. Never drop the Tonight flow, the Proof screen, or alerts.

---

## Demo video (3 minutes)

- **0:00–0:15** Footage-style still of cars on the Velachery flyover. "Every monsoon, Chennai parks its cars on flyovers, because nobody tells residents where the water will go."
- **0:15–1:15** The load sequence, then the Tonight flow on a real Velachery address with **Replay: Cyclone Michaung** switched on: depth, time, parking, route, subscribe; show the real alert email arriving.
- **1:15–1:50** What if: drag to 400 mm, the city floods; Hospitals panel.
- **1:50–2:30** Proof: the split-screen and the hit-rate number vs the baseline; one sentence on the calibration split; ANUGA agreement.
- **2:30–3:00** Architecture diagram (every AWS service named), honest limits, close on the city at dawn with water receding.

---

## Teammate tasks (non-code)

- **Teammate 1:** video editing (script above), AWS Builder Center blog post (problem, stack, what fought back), link it in the submission.
- **Teammate 2:** download and clean validation KMLs, list 20 real Chennai addresses across risk levels for testing, test every flow, write README with a GIF and the architecture diagram.

---

## Definition of done

- Live URL on AWS, loads into the cinematic sequence, hero flow works on 5 test addresses.
- Proof screen shows real numbers from `proof.json`, including the baseline and the rain-driven vs river-driven split.
- Replay a storm works for all three historical storms.
- A real alert email arrives from SNS during the demo.
- The assistant answers "Will my street flood tonight?" with grounded numbers and refuses to invent them.
- About panel states the limits.

---

## Phases and autonomy rules (the user is mostly AFK)

### Rules for working unattended

- **Keep going.** Work through phases in order without stopping to ask the user anything.
- **Log everything in `PROGRESS.md`:** current phase, what was done, what failed, decisions and assumptions made, what is next. Update it after every meaningful step so a fresh session can resume from it.
- **Self-verify every gate** with scripted checks, and save every visual (hillshades, depth maps, validation plots, app screenshots via Playwright) to `review/<phase>/` with a one-line caption in `PROGRESS.md`.
- **Commit and tag** each passed phase (`git tag p1`, `p2`, …). Never rewrite history.
- **When stuck:** try up to 3 genuinely different approaches, then take the fallback written in this file, log why, and move on. Never sit blocked.
- **Safety:** only use the `highground` AWS profile; only create or delete resources inside the SAM stack and the project S3 buckets; never touch other AWS resources; never print secrets into logs or commits.
- **Never stop between phases.** After each phase, add a 3-line summary at the top of `PROGRESS.md` and continue. Stop only if a gate fails three different fixes and its fallback.

### Phases

Phases are checkpoints, not stops. Finish one, commit, tag it, and start the next immediately.

| Phase | What | Gate (scripted check before moving on) |
|---|---|---|
| P1 Terrain | Setup, DEM tile check, KML inspection, conditioned terrain | Hillshade PNG shows rivers carved, buildings removed; elevations plausible (≈0–60 m) |
| P2 Model | Fast model (200 mm test run first), then all scenarios and 3 replays; ANUGA in the background, 4 h timebox | Mass balance within 2%; Velachery/Pallikaranai wet, T. Nagar mostly dry; all depth maps saved |
| P3 Proof | Validation → `proof.json` | Model beats the elevation baseline on hit rate; rain vs river split reported |
| P4 Backend | Street JSON, parking, routing graph, hospitals, tiles on S3/CloudFront; SAM stack with subscribe, forecast-check, assistant | Tiles reachable; SNS publish succeeds; assistant answers with grounded numbers |
| P5 Frontend | Hero flow first, then What if, Proof, Hospitals, About, Replay a storm, polish, README, Amplify deploy | Playwright run of the hero flow passes; screenshots saved; live URL works |

If time runs short, cut in the fallback order above. The hero flow and the Proof screen always ship.
