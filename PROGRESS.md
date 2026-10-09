# HighGround — progress log

## Phase summaries (newest first)

**P1 Terrain — PASSED (tag p1).**
Copernicus GLO-30 DSM → bare-earth DTM on an 836×1440 grid (30 m, EPSG:32644). Masks come from 372k OSM buildings, WorldCover tree cover, bridges/flyovers and unmapped tall objects; masked cells are filled and percentile-filtered, then the datum is restored.
Rivers sit 4.5 m below banks; DSM−DTM is 1.6 m on buildings vs 0.24 m on open ground; land is −0.9…48 m. The validation KMLs were inspected (7,894 crowd street segments, all positives, no timestamps).

---

## Deadline

- Event: **Environmental Hacks**, event 02 of the Bharat Builds Tour (WeMakeDevs × AWS). Hybrid, **Oct 8–11, 2026**. Optional in-person build day Sat Oct 10 at DTU Delhi.
- The Luma listing for the Delhi stop says online submissions close **Sunday 8:00 PM IST**, which means **Sun Oct 11, 2026, 20:00 IST**. Confirm on the wemakedevs.org/aws/env submission form.
- Rules: project must be built during the event; must use AWS and *show it in the video*; 3-minute video; teams of 1–4; blog on AWS Builder Center for the blog prize.

## FOR THE USER (things Claude cannot do) — do these in order

1. **Create the AWS profile `highground`** (blocks P4/P5: nothing can deploy without it; Claude will not touch `default`):
   `aws configure --profile highground` → keys for the AWS account you want to use, region `us-east-1`.
2. **Put your real inbox in `.env`**: `ALERT_TEST_EMAIL=you@yourdomain` (currently the placeholder `you@example.com`).
3. **Bedrock model access**: in the AWS console (us-east-1) → Amazon Bedrock → Model access → enable an Anthropic Claude Sonnet model. `infra/deploy.sh` picks the newest enabled Claude Sonnet inference profile automatically.
4. Then run (or ask Claude to run): `infra/deploy.sh`. It creates the $10 budget alarm, deploys the SAM stack, uploads the model outputs (~200 MB), builds the site, deploys it to Amplify, and runs the first forecast check. It prints the live URL and writes `data/deploy_outputs.json`; the admin token for `#admin` is in `data/admin_token`.
5. **Subscribe once from the live site** with the `.env` email → **click the AWS Notifications confirmation link** in that inbox. Then `#admin` → "Run and send alerts" (e.g. 300 mm) sends a real alert email for the video.
6. Verify student status on AWS Builder Center (eligibility). Teammates: video (script in `docs/DEMO.md`) and blog.

## Review workflow (user instruction, Fri 15:30 IST)

After each piece of work, run the relevant reviewer and fix every blocker and major issue it reports:
- `model-reviewer` for pipeline changes; `design-critic` and `qa-tester` for frontend/backend changes.
- `judge` at the end of each phase; act on its top suggestion.

The definitions live in `.Claude/Agents/` (capitalised), which Claude Code does not discover, so they were copied to `.claude/agents/`. In this session they run as general-purpose agents briefed with each definition. Reviewer reports and fixes are logged below under "Reviews".

## Current phase

P2 Model — in progress.

## Log

### 2026-10-09 (Fri)

- Environment: 4 cores, 13 GB RAM, Node 20 via nvm already present, AWS CLI 2.27 present at /usr/local/bin. Installed Miniforge to `~/miniforge3`.
- DEM tile check: `Copernicus_DSM_COG_10_N12_00_E080_00_DEM` and `..._N13_00_E080_00_DEM` **both present** in `s3://copernicus-dem-30m/`. Downloaded to `data/raw/dem/`. No SRTM fallback needed.
- Network: German hosts (Geofabrik, overpass-api.de) run at ~150–350 B/s from here; everything else at 250–650 KB/s. **Decision:** OSM comes from the openstreetmap.fr Tamil Nadu extract (130 MB) instead of the Geofabrik Southern Zone file (558 MB).
- Validation data downloaded from OpenCity to `data/raw/validation/`:
  - `crowd_2015.kml`: Chennai 2015 crowd-sourced flooding locations (osm-in/flood-map, public domain). OSM street **LineStrings** with an `is_flooded` flag.
  - `gcc_hazard_zones.kml`: GCC flood hazard zones (Very Low … High), 38 MB.
  - `gcc_inundation_points_depth.kml`: GCC inundation points with depth (inches) and remarks.
  - `gcc_hotspots_2015.kml`, `gcc_stagnation_2015.kml`, `inundation_2015.kml`: supporting layers.
  - `gcc_wards_2022.kml` (200 wards) and `gcc_wards_2011.kml`, used for the calibration/validation split.
- Rainfall for replays (all in `pipeline/config.yaml` with sources):
  - 2015: 374 mm/24 h (spec). ERA5 at Chennai gives only 142 mm over 4 days, so ERA5 badly underestimates it. A front-loaded design shape is used, starting 08:30 on 1 Dec to align with the release timeline.
  - Chembarambakkam release: CAG/PWD timeline (10k → 12k → 20,960 → 29,000 cusecs; 29,000 held 21 h). Modelled as Adyar inflow at the west edge. Assumption: no added catchment inflow.
  - Michaung 2023: 415 mm (IMD Meenambakkam, 3 Dec to 13:30 4 Dec). Timing from ERA5 (Open-Meteo archive), scaled to the total.
  - Fengal 2024: 114 mm (IMD Meenambakkam bulletin). Timing from ERA5, scaled. ERA5 overestimates here (220 mm).

#### P1 terrain details
- Added **ESA WorldCover 2021 10 m** (AWS Open Data, `s3://esa-worldcover`, windowed COG read) because OSM canopy tagging is patchy (Guindy National Park is not tagged as wood). Used for the tree mask (dilated 60 m so the fill draws from open ground) and for land cover (pervious, wetland, water).
- DTM masking: buildings >30% of a cell, tree cover ≥50%, bridges/flyovers (OSM `bridge=*`/`layer>0` roads and rail, buffered 15 m, so decks do not dam rivers), objects >2.5 m above a 210 m morphological opening, and Copernicus void pits (<−1 m; one quarry lake was −64 m).
- **Datum restore:** the 5th-percentile 3×3 filter lowered open ground by ~0.5 m, so that median offset is added back to land cells. The filter cleans clutter; it should not move the city relative to the fixed sea level.
- Sea = cells ≤0.2 m connected to the east edge, seaward of the first land cell per row.
- Building obstacles (+3 m) only where footprints cover >55% of a cell and no road passes, so 1.2% of cells. Most of the city stays passable along streets.
- Known limitation: the Guindy/IIT forest interpolates as a gentle rise (~15 m). It is not a flood area, and the limit will be noted in About.
- Review images:
  - `review/p1/hillshade_dsm_vs_dtm.png`: raw DSM vs conditioned model terrain, whole domain.
  - `review/p1/hillshade_zoom_adyar.png`: Saidapet–Adyar–Velachery zoom; buildings stripped, Adyar carved.
  - `review/p1/landcover.png`: urban / road / pervious / wetland / water / obstacle / sea classes.
  - `review/p1/validation_layers.png`: 2015 crowd streets, GCC hazard zones, GCC inundation points and 200 wards over the hillshade.
- **KML inspection → metric design** (`data/work/kml_inspection.json`):
  - crowd_2015: 7,894 OSM street LineStrings; `is_flooded`=1 on 7,884 (positives only); no date/time fields (cumulative Nov–Dec 2015). Because there are no negatives, hit rate alone rewards flooding everything. P3 therefore also reports the **share of all streets the model floods** and the **lift** (hit rate ÷ flooded share), and compares the baseline at a matched flooded share.
  - gcc_hazard_zones: 7,453 polygons, CATEGORY Very High/High/Moderate/Low/Very Low.
  - gcc_inundation_points_depth: 192 points with DEPTH (inches; date unknown).
  - inundation_2015: 4,001 multipolygons, the NRSC 2015 inundation extent; usable for an areal cross-check.
  - Wards 2022: 200 polygons; ward number in `Name` (whitespace-padded).

### P2 model — decisions and findings (Fri)

- **Solver** (`pipeline/02_fast_model.py`): local-inertial (Bates 2010), numba, branchless float32 momentum kernel (hf^(1/3) by rational guess and two Halley steps, ≤0.7% error), donor-cell outflow limiter (exact mass conservation, no clipping), Froude ≤ 1 cap. 200 mm test run: **mass error 0.0000%**, 36,745 steps, ~12 min wall on this 2-core Ryzen 3 3250U.
- Speed work: the first version took ~35 min/run. Fixes: (1) fused, vectorisable kernels (2.3× faster); (2) channel beds follow the sink-filled surface so burnt channels drain instead of pooling; (3) **free-outfall outlets on the N/S/W domain edges**, because closed edges turned valleys draining out of the domain into 19 m "lakes"; (4) **depression cap 2.5 m**: closed pits deeper than 2.5 m below their spill level are DSM artefacts or embankments whose culverts 30 m data cannot see (1% of cells raised). Max depth fell from 15 m to ~5 m and dt rose from 1.7 s to 3.2 s.
- Antecedent state: channels start full to their measured surface (burn depth), then a 2 h dry spin-up.
- **Permanent water** (lakes, ponds, temple tanks, channels: 35% of "wet" cells in the first run) is excluded from flood statistics, street and edge sampling, validation and textures. A lake is not a flooded street.
- Hospitals: OSM tags 790 named features as hospitals, mostly clinics. **Selection = campuses ≥ 4,000 m² or ≥100 beds → 47 major hospitals.**
- Parking candidates: 181 (135 flyovers ≥150 m on trunk–tertiary roads, multi-storey, open grounds ≥3,000 m²).
- **Calibration objective changed** (logged in `data/out/calibration.json`). The KML holds only positives. Reported streets sit slightly *higher* than unreported ones (reports come from better-connected central neighbourhoods), so hit − false rate is ~0 for every map: the naive elevation baseline scores −0.016 and the model +0.018. The objective is now the **hit-rate gain over an elevation-only map that floods the same share of land**. It needs no "dry" labels and cannot be gamed by flooding more. First candidate (drainage 0 mm/h, 2015 rain + reservoir, odd wards): hit 38.3% vs matched baseline 18.6%, gain +0.197.
- Calibration candidates reduced to 0, 5, 10, 20, 30 mm/h (compute budget). Two restarts lost about 45 min: a scoring index bug after `explode()`, then the objective change.
- ANUGA 4.0.1 installed (separate env). The feasibility test with 233k triangles ran 30 sim-min in 386 s, so a full storm would take about 7 h. Plan: ~25 m core mesh, first 14 h of the 200 mm storm, niced, after calibration (same drainage). **Deviation from spec:** the core is not ~10 m along streets. Timebox: 4 h from the ANUGA start.

### P4/P5 groundwork (Fri, while the model runs)

- SAM template (`infra/template.yaml`): S3 data bucket + CloudFront (OAC, CORS), DynamoDB subscribers, SNS topic, HTTP API, Lambdas `subscribe`, `forecast_check` (EventBridge Scheduler `rate(3 hours)` + `/admin/run`), `assistant` (Strands Agents SDK layer, 94 MB, built for py3.12/manylinux), `geocode` (Amazon Location Places v2 with Nominatim fallback), Amplify app + branch.
- Shared layer `hg.py`: nearest street, scenario blend, risk bands, dry parking, hospital status, A* safe route. Every number comes from S3 model files.
- Assistant: every number in the reply is checked against tool outputs, and the UI marks it "from the model" or "not in model output".
- Frontend (Vite + React + TS, MapLibre 6, three.js): Protomaps dark basemap from the token palette, terrain-RGB raster-dem (exaggeration 1.5), 3D buildings, three.js water mesh (vertex displacement from elevation + blended depth textures, ripples, fresnel, amber junction glints), 4k instanced rain, the opening flight from the Bay of Bengal, Tonight / What if / Proof (swipe split) / Hospitals / About / hidden `#admin`.
- Gotchas fixed: MapLibre 6 needs `setWorkerUrl`; MapLibre's CSS overrode the full-bleed container (`position: relative`); the Protomaps basemap already has a layer called `water` (renamed ours `flood-water`); custom-layer matrix is `defaultProjectionData.mainMatrix` in v5+.
- Playwright hero test runs on the real GPU (`--use-angle=gl-egl`). All steps pass on the dev server; 36–58 fps while the model hogs the CPU.
- `data/out/web/current.json` is currently a **dev placeholder** (200 mm, flagged `demo_override`). The forecast-check Lambda overwrites it in production.

### Terrain experiments before the final calibration (Fri 06:55–07:10 IST)

Problem: the 200 mm test flooded scattered pits everywhere. Velachery's wet share was 13%, the same as T. Nagar's. Closed depressions in the 30 m DSM could hold **124 Mm³**, against 173 Mm³ for the whole 200 mm storm, so rain stayed where it fell. Separately, every OSM waterway was burnt as a 30 m × 2 m channel, so a street drain carried as much as the Adyar and water left the city far too efficiently.

Experiments (200 mm, drainage 10 mm/h, scored on odd wards = calibration half only):

| Terrain | Velachery wet | Pallikaranai | T. Nagar | hit | matched baseline | gain |
|---|---|---|---|---|---|---|
| depression cap 2.5 m, all channels 2 m | 13% | 37% | 13% | 0.192 | 0.074 | 0.118 |
| cap 1.0 m | 16% | 37% | 18% | 0.225 | 0.086 | 0.139 |
| **cap 1.0 m + burn depth by type (river 2, canal 1.5, stream 0.6, drain 0.4 m)** | 15% | 35% | 19% | 0.241 | 0.091 | **0.150** |

**Decision:** adopt the last row. It is physically motivated, and it improves the calibration-half score only; the validation half is untouched. Calibration and all runs were restarted at 07:10 IST. The previous terrain is backed up in `data/work_backup_v1/`. The P2 place gate (Velachery wet, T. Nagar mostly dry) will be judged on the calibrated runs.

### Calibration result (Fri 08:16 IST)

Objective (pre-registered before any results): hit-rate gain over the matched-area elevation baseline, odd wards, 2015 rain + reservoir.

| drain capacity | hit | matched baseline | gain | flooded share |
|---|---|---|---|---|
| **0 mm/h** | 0.426 | 0.214 | **0.212** | 0.379 |
| 5 | 0.398 | 0.196 | 0.202 | 0.356 |
| 10 | 0.371 | 0.177 | 0.194 | 0.330 |
| 20 | 0.300 | 0.143 | 0.157 | 0.279 |
| 30 | 0.217 | 0.101 | 0.116 | 0.224 |

**Chosen: 0 mm/h**, the low edge of the range. Reading: for the 2015 event the model needs all its water, consistent with overwhelmed drains and with tank surpluses the model leaves out. This is stated on the Proof screen (`calibration_note`). The objective was not changed after seeing results. A ratio objective would have picked 5 mm/h; it was rejected to avoid metric-shopping.

### P2 place gate (200 mm, calibrated)

- Velachery 23.5% of land ≥15 cm, Pallikaranai 48.7%, T. Nagar 29.0%. Mass error −0.0000%.
- **Partial fail:** Velachery is under the 25% threshold set before the run and below T. Nagar. Three distinct fixes were tried: depression cap 2.5 → 1.0 m, burn depth by waterway type, calibrated drains.
- **Evidence the expectation is not supported by observed data:** the 2015 citizen reports flag 38.8% of Velachery's road length (1.2 km circle) and 38.3% of T. Nagar's (1 km circle) as flooded, which is equal, and Pallikaranai 21.8%. The model's ranking matches the reports better than the spec's intuition does.
- Decision (autonomy rule: three fixes tried, never sit blocked): log it, keep the 25% threshold unchanged, continue. The Proof screen reports validation honestly.
- ANUGA first launch failed: the env lacked numba, which it needs to import the scenario helper. Installed numba and restarted at 08:28 IST, 103k triangles, 14 h of the 200 mm storm, 4 h timebox (until 12:28).

### P3 validation (Fri 09:15 IST): **gate PASSED** (`proof.json`)

Held-out even wards, 3,200 reported segments, 2015 rain + Chembarambakkam release:
- Model hit rate **39.4%**; lowest-20% elevation baseline 10.0%; same-area elevation map 26.0% (**+13.4 pts**).
- Rain-driven streets: 41.4% vs 25.4% (+16.1). River-driven (≤500 m from Adyar/Cooum): rain only 14.5%, with the release 18.8%. So the release matters, but an elevation map scores 32.6% there: river flooding is the model's weakest part, plausibly because other tank surpluses are not included.
- NRSC 2015 satellite inundation: the model covers 38.7% of it (CSI 0.169) vs the baseline's 12.4% (CSI 0.07).
- GCC hazard zones: 22.8% of the model's flooded area falls in moderate+ zones (which are 20.2% of the city); the baseline gets 23.4%. Weak agreement, reported as is.
- Calibration half (odd wards) gain 0.212. Validation half gain 0.134: a drop out of sample, as expected.

### Hero-flow realism experiments (Fri 09:30–10:45 IST, main chain paused)

Problem: at five well-known places the 2015 replay answered "stays dry" at street level. The model's water sits in DSM pockets: in a 600 m window around Seva Nagar the median cell is ~1 cm while the deepest 10% reach 50–100 cm. Around Velachery, 34% of land passes 15 cm at hour 12; residents reported 39% of Velachery's road length, so the area share is close but the answer depends on which street you pick.

Decision rule, fixed before results: adopt a variant only if the calibration-half gain beats the current model by at least 0.01.

| Variant (2015 + release, drainage 0) | gain | hit | flooded | Velachery wet |
|---|---|---|---|---|
| current | 0.212 | 0.426 | 0.379 | 0.31 |
| A: wet antecedent (pockets and tanks full) | 0.217 | 0.478 | 0.428 | 0.35 |
| B: DTM smoothed (σ 1.5 cells) | 0.142 | 0.323 | 0.342 | 0.23 |
| C: A + B | 0.149 | 0.359 | 0.374 | 0.25 |

**Kept the current model.** Smoothing clearly hurts, so the fine DSM structure carries signal. The wet antecedent is +0.005, below the pre-set bar. The main chain resumed at 10:45 IST. For the demo, use addresses where the model floods. Teammate 2's address list should span risk levels as the spec says.

### Stage B: ANUGA cross-check, done within the timebox (08:28 → 10:49 IST, 2 h 21 min)

- ANUGA 4.0.1, DE0 flow algorithm, 103,159 triangles: max 900 m² overall, 350 m² in the Velachery core (~25–40 m spacing; the spec's ~10 m along streets did not fit the timebox). Box 80.19–80.25 E, 12.925–12.99 N. Same terrain, rain, losses and channel antecedent water as Stage A; transmissive boundaries. First 14 h of the 200 mm storm (covers the front-loaded peak). Hourly maxima in both models.
- **Agreement:** 92.8% of 45,907 land cells agree on ≥15 cm; CSI 0.78; depth correlation 0.90; median |Δdepth| 0.7 cm; wet share 28.4% (ANUGA) vs 30.6% (Stage A).
- `review/p2/anuga_vs_fast.png`: side-by-side peak depth. Included in `proof.json` → Proof screen.
- Caveat for the Proof screen: same 30 m terrain, so this checks the numerics, not the terrain.

### Initial-condition fix, full rerun (Fri 11:05–11:14 IST)

- Found while picking demo streets: in every scenario, ~17,700 land cells (2% of the city) were already ≥15 cm when the storm started, e.g. streets around Velachery Lake at ~150 cm with time-to-15 cm of 0. Cause: channels started full to the **sink-filled spill level**, which in raised pit reaches sits up to 0.5 m+ above the measured water surface, so water spilled onto adjacent land during the 2 h spin-up.
- Fix: channels start at their **measured water surface** (`clip(DTM − bed, 0, burn depth)`), in both Stage A and ANUGA. A 1 h check of the 50 mm storm leaves 6,205 wet land cells (0.7%), mostly Pallikaranai marsh holding ~22 cm and low land beside channels, which is realistic for the monsoon.
- All v1 outputs archived in `data/out/runs_v1/` (calibration, runs, ANUGA 92.8% agreement on the v1 setup). Calibration, the 16 runs and ANUGA restarted at 11:14 IST; expected done ~16:30.

### v2 results so far (Fri 15:00 IST)

- Calibration (odd wards) chose **0 mm/h** again: gains 0.210 / 0.203 / 0.191 / 0.154 / 0.106 for 0 / 5 / 10 / 20 / 30 mm/h.
- **P3 PASS** on v2: model 39.3% vs same-area elevation map 25.8% vs lowest-20% 10.0% (held-out wards, 3,200 segments). Rain-driven 41.3% vs 25.1%; river-driven 13.8% (rain only) → 18.8% (with release) vs 32.6%.
- **ANUGA v2:** 92.4% cell agreement, CSI 0.77, depth correlation 0.90, median |Δ| 0.7 cm; 2 h 18 min (12:33 → 14:51), within the timebox. Proof screen has a **Detail** toggle: ANUGA vs fast model on the Velachery box, identical styling (`proof/anuga_200mm.png`, `proof/fast_200mm.png`).
- All three replays are done (mass error 0.0000%). Michaung: 36.5% of street segments ≥15 cm, 27/47 hospitals cut off. Fengal (114 mm): 23.0% of segments and 13/47 hospitals, probably high. **New limit added** (About, proof caveats, assistant `model_limits`): drain capacity was tuned on the extreme 2015 event, so smaller storms are probably overstated.
- Demo streets (Michaung replay): Arumugam Road (154 cm, reaches 15 cm by 11 PM), Kuberan Nagar 8th Street, Kakkan Nagar Main Road (`docs/DEMO.md` after the post-run step).
- Local moto test of subscribe → forecast-check → SNS → filtered delivery: **passes** (`infra/tests/test_lambdas_moto.py`).

## Reviews

### Judge #1 (Fri ~15:45, end of P3, local build)
Scores: idea 8, AWS 5 (≈8 once deployed), design 6, execution 7, demo readiness 5.
Top suggestion: **deploy and film the real alert email + a grounded assistant answer**. This is blocked on the user (AWS profile). Best code-only change: **time-aware routing**.
Acted on:
- Time-aware routing. Edge depth at any hour is sampled in the browser from the hourly depth frames (no new data). The card now leads with a decision: "Move your car to Velachery MRTS Bridge by 10 PM" (the last hour a dry route exists, one hour before the street passes 15 cm).
- What if no longer shows an invented "0%" for runs that are not computed.
- Smooth water (depth sampled per pixel), labels above 3D buildings, readable attribution, larger street marker, compact card, Proof panel clears the attribution, primary replay button on dry nights.

### Model reviewer #1 (Fri ~15:50): FAIL → acted on
1. **Blocker: the validation metric rewarded patchy maps.** Random speckle at the same share scored 64% hit vs the model's 39%; reported-vs-unreported discrimination was ≈0.5 for every map. **Fix:** Proof now leads with a rank-based test that flooding more cannot game (P(reported street ranks deeper than unreported), even wards, bootstrap 95% CI). It also reports random/shifted null maps, NRSC overlap vs a random map of the same size, GCC official hotspots/stagnation points, and the ward-level correlation. On v2 runs the model scores 52% (CI 51–53%) against 50% chance, 47% elevation and 56% nearest channel. Honest verdict on screen: "slightly better than chance".
2. **Major: about a third of the 2015 release exited the west edge.** Fixed: the Adyar entry stretch of the west edge (±65 rows) is no longer an outlet.
3. **Major: sloshing (peaks inflated up to 1.6 m at cfl 0.7) and the Ennore short circuit at high tide.** Fixed: `cfl_alpha` 0.5. The builder's test (`review/model-review/theta_test.json`) matches a 4× smaller step to 0.1 cm; the θ=0.7 scheme was tried and left 110 cm outliers. Edge outlets now hold the tide level where their bed is below it. Outflow is split sea vs land edges in `info.json`.
4. Place check: same root cause; disclosed.
5. Mass balance: an identity check; the outflow split is now recorded.
6. Pre-storm wet land: depth at storm start is saved (`h_start.npy`); ≥5 cm is masked as standing water in streets, routing, textures and validation.
7. Frontend consistency: street peak = max of the same hourly series as the time text; routing/hospital edge depth = p90 of samples (same statistic as the card), server and client.
- **Calibration withdrawn:** with the rank-based score, drain capacity 0–30 mm/h all score 0.53–0.54 with overlapping CIs, so **10 mm/h is a stated assumption** (`calibration.json`, About, Proof).
- v3 runs (all 16 + ANUGA) restarted 16:05 IST with these fixes.

### Design critic #1 (Fri ~16:40) → acted on
Blockers fixed:
1. The card said 154 cm over a dry map (route planning jumped the map to the leave-by hour). The map now stays at the peak, and the leave-by hour is a marker on the timeline.
2. What if at 200 mm showed nothing (a zero-weight 150 mm run blocked the blend). Zero-weight runs are dropped in `designMix` and in the forecast blend.

Majors fixed:
- Opening starts low over the bay (zoom 10.6, pitch 55, bearing −60), fog hides the data edge, the flight is 5 s, water rises from 2.5 s, no centred loading text.
- Darker building ramp (opacity 0.85); shallow water more opaque (0.72 + 0.28·t), so the water is the bold element.
- 112 line in a sticky footer; compact replay row; duplicate route line removed.
- Nav is a solid bar (no label collisions).
- Proof: four numbers on one shared scale (no bigger number for the model than for a baseline that beats it); test tables and limits collapsed; city framed below the headline card.
- Hospitals: cut-off hospitals are labelled hollow white rings and reachable ones small dots; names title-cased; no wrap. The pipeline drops veterinary/animal places (applies on the next `05_features` run).

Minors: ripples fade when zoomed out and water under 15 cm is hidden below zoom 13; "peak Sun 3 PM"; "No rain forecast tonight"; route cleared when leaving Tonight; timeline and About clear the credits; panels opaque.
QA tester #1 was cut off by a usage limit (re-run).

### QA tester #1 (Fri ~17:50) → acted on
Blockers fixed and verified with the tester's repro scripts:
1. "Tonight" after a replay crashed the app (`mixDescription([])`). Now guarded; the answer block renders only for a scenario with runs.
2. **Terrain was never loading**: `new URL()` percent-encoded `{z}/{x}/{y}`, so the water floated over flat ground and hid at the hero pitch. Fixed; 33 terrain tiles now load with real elevations. Water now drapes properly (`review/qa/72_arumugam_pitch62.png`).

Majors fixed:
- The depth number vs hourly series could disagree: the street JSON predated the new 04, and the series was capped at 255 cm. The series is now uint16 (`series_bytes: 2` in the index; frontend and Lambda decode both widths).
- The hospitals layer was rejected by MapLibre (nested zoom interpolate). Fixed.
- The alert email paired the peak depth with the 15 cm time. Facts now carry `peak_at` and `reaches_15cm_at` separately, the prompt forbids mixing them, and the fallback text is corrected.
- Absurd dry routes (56 km for a 1 km trip) are now "no practical dry route" (> 3× or > +4 km of the normal route), in both browser and Lambda.
- Speed: measured at load average 7–12 while the model runs. Re-measure on an idle machine.

Minors fixed: no leave-by marker for dry streets (a quiet "your street stays dry, dry route …" line instead); What if hides the hospital stat when the run is missing; search says "no matching place"; "T Nagar" alias; unnamed flyovers called "Unnamed flyover"; default Velachery = the search box's Velachery; weekday shown after the first 12 hours; nav "About"; out-of-area wording.

### v3 check: Michaung spikes gone (Fri ~18:30)
Land cells whose recorded peak exceeds the hourly maximum by more than 20 cm: **v2 4,952 → v3 0** (largest excess 3.3 m → 0.06 m). Mass error 3e-13 %. Outflow 30.8 Mm³ to sea, 9.5 Mm³ through land edges. Wet share ≥15 cm: 24.0% → 21.9%.

### Frontend lag investigation (Fri ~19:00, user reported lag)
Intent was always smooth (60 fps on an integrated GPU). Measured, not guessed:
- **Main-thread profile** (`web/tests/profile_idle.mjs`): `getImageData` took 1.2 s of every 5 s while hourly depth frames preloaded. PNG decoding now runs in a Web Worker (`src/lib/decode.worker.ts`); the main thread went from 38% to 62% idle.
- **The real cost was rain.** Rain was drawn inside the map's custom layer, so every rain frame forced MapLibre to redraw terrain, 3D buildings and water. Rain is now its own transparent canvas (`src/water/RainOverlay.ts`, pixel ratio 1) using the last map camera matrix, and the map is render-on-demand. A still map redraws 1–2 times a second, against continuous redraws before (9.2/s measured while the GPU was starved, ~60/s on a free GPU). Rain still animates: 5.6% of pixels change between frames 150 ms apart (`tests/rain_diff.mjs` + `.py`). Ripples freeze when the camera is still, which matches the spec ("nothing else animates on its own"). Reduced motion turns rain off.
- Also: pixel ratio capped at 1.5, water mesh step 2 → 3 (about 135k vertices), single-run frames skip the blend arithmetic, leave-by planning binary-searches the hours and yields between searches, and hourly frames preload nearest-first in idle time.
- **The lag the user saw is mostly the machine.** Per-process GPU accounting (`/proc/*/fdinfo`) showed the user's Firefox tab on the app using 86–99.6% of the Vega 3 (clocked at 640 MHz), and the model run takes about 2.2 of 4 CPU threads. Even a flat basemap with all our layers off ran at about 10 fps in a second browser. Our page (new code) idles at 5.3% GPU in Chromium. **Re-measure fps after the model runs finish, with only one browser tab open.**

### Creative research (Fri ~19:00, user request) → `docs/ideas/creative_research.md`
A research agent read the spec, progress, screenshots and code, and surveyed flood, water and night-city visualisation. Verified findings and actions:
- **Bug (verified): the high-tide replays drew the sea as floodwater.** In the served (v2) Michaung and Fengal hourly frames, all 236,530 sea cells were ≥15 cm. `07_export_tiles.py` now masks the sea explicitly; the v3 runs were already clean through the `h_start` mask. The fix lands with tonight's re-export.
- **Done: water truth pass.**
  - 15 cm (thin) and 30 cm (bold) contour lines drawn on the water when zoomed in.
  - Deep water opaque, shallow water translucent (alpha 0.5 → 1.0 with depth, was 0.72 → 1.0).
  - B-spline (4-tap) shoreline smoothing when zoomed in, display only.
  - A map key (`ui/Legend.tsx`) on Tonight, What if and Hospitals.
  - Screens: `review/qa/72_arumugam_pitch62.png`, `72_arumugam_pitch0.png`. Hero test: all 9 steps OK, no errors.
- Performance items 1, 2 and 4 of the report were already done in the lag pass above.
- **Next from its shortlist, in order:**
  1. Model-timed rise: play the hourly frames up to the peak instead of a uniform multiplier, which is also more honest.
  2. A "Watch the whole storm" 2015 time-lapse, with captions from pipeline JSON only.
  3. "Stand in your street": human-scale figures, only if time allows.

  Skipped as infeasible or off-licence: photogrammetry and Google 3D tiles. Open Buildings 2.5D heights (CC BY 4.0) are optional, last.
- Design-critic and qa-tester run once after tonight's v3 rebuild, covering these frontend changes too.

### Model-timed rise + single opening flight (Fri ~19:15)
- **Glitch found and fixed.** The opening landed at zoom 14.2 and started the water rising. The default Velachery place then triggered a second flight to zoom 15.2, which snapped the water to zero and raised it again. The opening now lands on the street view itself (`STREET_VIEW`), and Tonight skips the flight when the camera already frames the place (`MapView.isFraming`).
- **The water now rises the way the model says.** There is no uniform 0→1 multiplier any more. The flight shows hour 1 (6 PM: channels only). After landing, the timeline plays the night to the street's peak through 8 of the model's own hourly frames, cross-faded, in about 3 s. Rain follows the hourly rainfall. It plays once per place and storm, scrubbing by hand stops it, and reduced motion jumps to the peak.
- **Answer card at about 12 s** after load (was 17.6 s in QA); the hero test's load step went 14.7 s → 10.6 s. Frames: `review/p5-dev/opening_rise/` (`contact.png`). Hero test: 9/9 OK, no errors. Leave-by test OK; its `route line` probe targets a removed element.

### "Watch the whole storm" time-lapse (Fri ~19:25)
- A button on replays plays every model hour in about 30 s over a wide view. It shows the storm's real date and time (the timeline switches to real dates too), a large "% of the modelled land under 15 cm" figure, and event captions: rain begins, heaviest hour, release passes 10,000 cusecs and peaks (labelled as modelled from the CAG timeline), most land under water, rain stops, and the end state. The end offers "Back to my street" and, for 2015, "See how we tested this" (Proof).
- **All numbers come from `runs.json`.** `07_export_tiles.py` now writes `wet_share_15cm_hourly` (land only, same masks as `wet_share_15cm`) and `reservoir` (from the config assumption). The served `runs.json` was patched for development with v3 values; the full re-export tonight replaces it.
- Test `web/tests/timelapse.mjs`: 2015 plays in 31 s, no errors, captions match `runs.json`. Frames are in `review/p5-dev/timelapse/`.
- **To re-check after the v3 export:** the framing. The served v2 frames under-show the release (v2 leaked it out of the west edge). In v3 the release floods land mainly along the upper Adyar (lon 80.10–80.19), so the camera now looks north-west from Pallikaranai.

### Human scale in the answer card (Fri ~19:45)
- `ui/DepthGlyph.tsx` draws the street's peak depth against an adult (1.65 m), a scooter with its rider and a small hatchback at typical sizes, in metres, with lines at 15 and 30 cm and the caption "Typical sizes, for scale". Outlines are drawn above the water so submerged figures stay readable.
- The readout and the glyph count up together (`ui/useCountUp.ts`, 2.8 s ease-out, starting when the camera arrives); reduced motion shows the final value. The readout's width and weight now ease over 0–150 cm (they saturated at 90 cm, so 93 and 154 cm looked the same).
- Screens: `review/p5-dev/cards_glyph.png`, `glyph_zoom.png`. Hero test 9/9 OK.

### Frame-perfect demo footage tool (Fri ~20:10)
- `web/tests/record_frames.mjs <shot>` (opening | search | timelapse | whatif | proof). Playwright's clock is pinned (6:30 PM) and paused, so app time advances exactly 1/FPS per frame. Before each frame it waits in real time until `map.areTilesLoaded()`. Frames are encoded with ffmpeg OpenH264 (Fedora's ffmpeg has no libx264); the PNGs are kept as a lossless master.
- Smoke test at 5 fps: starts over the Bay, flies in, the card counts up while the night plays to the peak, every frame fully drawn, no errors. Final 1080p/30 fps footage to be recorded after the v3 rebuild.
- Design critic: the first run was cut off by a usage limit (resets 22:10 IST) after capturing `review/design/r2/`; relaunched.

### v3 rebuild complete (Fri 21:50–22:40)
- All 16 v3 runs finished at 21:50; mass error is 0.000% on every run. `post_runs.sh` finished at 22:01. One failure: `write_current_local.py` had a DNS failure at that moment; the retry at 22:30 succeeded (tonight's forecast is 0 mm, so the default view is dry with the replay offer).
- Gate p2: mass balance PASS ×16, depth maps PASS ×16, Pallikaranai wet PASS (35%), T. Nagar mostly dry PASS (19%). **Still FAIL: Velachery wet at 200 mm is 15% (threshold 25%), and Velachery is not wetter than T. Nagar.** v2 was 23%; removing the sloshing peaks lowered it. Sent to the model reviewer.
- Gate p3: PASS. Ranking test 53.2% [51.8, 54.4] vs elevation 46.9%, channel 56.2%, random 49.3%.
- Web data checks: 16 runs; hourly land wet share in every run; release facts for 2015; 0 sea cells ≥15 cm in any h01 or max frame; ANUGA cross-check back on Proof (93.8% cell agreement, depth correlation 0.90). Design-storm land wet share ≥15 cm: 50 mm 0.2%, 100 mm 1.5%, 150 mm 8.4%, 200 mm 15.9%, 300 mm 23.7%, 400 mm 29.0% (mean tide).

### Design critic r2 → acted on (Fri 20:05–22:45)
- The critic run was interrupted twice: first by a usage limit, then by an interactive rebase on `main` that rewrote commit authors (done outside this session; contents verified identical to `backup-before-author-fix`; commits now authored `sept1st2c`). Its screenshots are in `review/design/r2/`.
- Fixed:
  1. **First 5 s.** A title line over the empty sky ("Chennai, 6 PM. Cyclone Michaung, 2023, replayed as if it were tonight.", set from the URL straight away); dark first paint (inline background in `index.html`); no water over the sea (shader sea mask as well as the export).
  2. **Water "drains then rises".** The rise starts 2 s before landing (`openingSequence` hands over early; `isFraming` knows the flight target).
  3. **Contour rings.** One 30 cm line in the shallow tone at 0.55; the 15 cm line is now only in the labelled glyph; the legend is updated.
  4. **Number vs hour.** While the night plays, the readout is the street's series at the hour shown (tweened), then it settles "at the peak". The "At {hour}" line shows only after scrubbing away from the peak.
  5. **Email above the fold at 1440×900.** "Watch the whole storm" moved into the timeline panel; one-line replay sentence; one parking place plus "1 more dry place nearby"; search spellcheck off.
  6. **Deep-water colour.** Fresnel 0.35 → 0.12; no ×1.12 brightening; alpha 0.45 → 1; glints only zoomed in.
  7. **Time-lapse.** Every caption carries its own time; one clock format (U+00A0, minutes when not on the hour); same-hour events merged (the release peak was hidden); "on its real dates" while playing; end buttons on one row.
  8. **What if.** The slider spans computed storms only.
  9. **Basemap.** Dimmer neighbourhood labels, no highway shields, darker runways; the street lands in the open map (padding left 380, bottom 120; responsive).
  10. **Mobile.** The nav has its own row; the Proof strip is a 2×2 grid.

  Minors: Copernicus notice on the Proof comparison map (licence); Proof labels on one baseline; a step-through scooter and a water-surface line in the glyph; 6 px radii; capitalised hospital names.
- Hero test updated: it expands "1 more dry place nearby" before "when to leave". 9/9 OK on v3 data.
- Model reviewer (v3) and QA tester (post-rebuild, with frame rates on an idle machine) are running.

### Model reviewer on v3 (Fri 23:15) → acted on
- **B1 (fixed, no rerun).** The standing-water mask hid the model's deepest riverside streets: 946 segments read "stays dry", MIOT's 2015 cut-off was hidden, and 2,234 deep edges counted as dry. 04, 05 and 07 now mask only permanent water (`common.permanent_water`). Streets already wet at storm start carry a `pre` flag; the card says "Low ground beside a channel: the model already holds water here before the storm starts", and the assistant gets `already_wet_before_storm`. Flyover ends use unmasked depth.
- **B2 (fixed).** "Leave by" was planned on display textures that miss 28% of deep roads. 05 now writes `graph/hourly_<run>{_ids}.bin`: same samples and p90 as the card, only for edges that ever reach 15 cm, uint8 cm, hour-major. `routing.leaveByPlan` uses `edgeDepthAtHour`; the texture-sampling code is removed.
- **M1 (disclosed, not tuned).** The place gate failure is a model defect (GCC: Velachery 49% vs T. Nagar 2% at moderate-plus hazard; NRSC 60% vs 33%). My earlier argument that the crowd reports show the two places equal is **withdrawn**: that source is dominated by reporting bias. About, the Proof caveats and the assistant limits now say the model does not reproduce it and that its flooding follows small hollows in the 30 m terrain. The gate stays visibly failing.
- **M4 (wording, fixed).** The proof caveat no longer says "drain capacity was tuned". Architecture diagram regenerated ("stated assumption; tested on held-out even wards"). ANUGA is reported as CSI 73% (cell agreement 94% is inflated by shared dry cells) on Proof, in the README, the demo guide and the blog. The elevation caveat now adds "but it does better on GCC's 2015 hotspots". The AUC interval is a ward block bootstrap. Gate p3 now tests the ranking (ward-bootstrap lower bound > 0.5 and above elevation); the spec hit rate is information only. README burn depths are listed by type.
- v3 outputs were regenerated with B1/B2 (04, 05, 07) as the fallback.

### v4 overnight rerun: pre-registered rule (written Sat 00:30, before any v4 run)
- Changes:
  - **M2:** a 3×3 grey opening replaces the 5th-percentile filter (it grew noise into 90 m square pits; 95% of "unsafe for cars" streets sat in closed pits).
  - **M3:** the west edge is closed further south (`erow+140`; 14% of the release still leaked).
  - **B1 root:** channels start no higher than their lowest bank, propagated about 240 m in. A 1-hour test cut land already wet at storm start from 11,657 to 1,614 cells (≥15 cm: 6,166 → 119).
  - **Minor:** land-edge outlets hold the tide only within 3 km of the sea.
- **Rule (odd wards = tuning half, 2015 replay with release, `pipeline/v4_decision.py`):** adopt v4 only if (1) ranking AUC ≥ v3 − 0.005 **and** (2) the share of model-flooded land inside GCC moderate-or-higher zones ≥ v3. Otherwise keep v3; `v4_chain.sh` restores it automatically.
- v3 baseline (`data/out/decision_v3.json`): AUC 0.5364 [0.521, 0.557], GCC moderate-plus share 0.244, flooded share of odd-ward land 0.320.
- Chain: `pipeline/v4_chain.sh`. Back up v3 → 01 → design_200_mean → ANUGA in parallel → remaining 15 runs → post_runs → decision. Log: `data/logs/v4_chain.log`. ETA about 07:30 IST.
- Not done (minor): losses split into drains and infiltration in `info.json`.
