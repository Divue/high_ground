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

## FOR THE USER (things Claude cannot do)

1. **AWS profile `highground` does not exist** in `~/.aws/config` (only `default`). Per the safety rules Claude will not use `default`. Run `aws configure --profile highground` (region `us-east-1`), or copy the default block under `[profile highground]`. Every AWS step is blocked until this exists; offline phases continue.
2. **`ALERT_TEST_EMAIL` in `.env` is the placeholder `you@example.com`.** Put a real inbox there so the SNS alert demo can arrive. After the first subscribe, click the SNS confirmation link in that inbox.
3. Verify student status on AWS Builder Center (needed for eligibility).
4. Bedrock model access: confirm Claude Sonnet is enabled in us-east-1 (Claude will check via CLI once the profile exists).

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
