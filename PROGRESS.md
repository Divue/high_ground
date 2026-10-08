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
