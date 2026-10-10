# HighGround offline mode and flood-safe navigation: plan

Written Sun 11 Oct 2026, 00:05 IST, about 20 hours before submissions close (Sun 11 Oct, 20:00 IST). Built from three research passes (offline web tech, flood-aware navigation, what actually happens in Chennai during floods), from measurements on our own data and router, and from counts on our OpenStreetMap extract. Sources are listed at the end.

## In one minute

- **Why:** in Chennai floods the power is cut for days, mobile towers go down, and phones run flat. The moment people need HighGround most is the moment it stops loading.
- **What we add:** a help card that works with zero data (tap-to-call numbers, "send my location"), and (1) **Save for offline**: one tap before the storm stores the app, your area's flood answers for every scenario, the basemap and the road graph (about 18 MB download). (2) **My flood plan**: a card with depth, time, where to park, how to get there and the emergency numbers, saved as an image or text so it works with no app and no network, and can be passed phone to phone. (3) **Take me to dry ground**: on foot, two-wheeler or car, a route that avoids streets our model expects to flood, with step-by-step directions that work offline (GPS needs no mobile data).
- **What makes it ours:** the flood model is precomputed, so offline costs almost nothing extra: a 3 km home area for all 16 scenarios is 2.0 MB gzipped, and a forecast update is a 4 KB file. Routing already runs in the browser (median 11 ms per city-wide trip on the real graph).
- **Cut line for the deadline:** Slices 1 and 2 below (plan card, save for offline, offline status, safer router, "take me to dry ground" with a turn list). Live GPS turn-by-turn is Slice 3 and only if time is left. The AWS deploy and the demo video still come first.

---

## 1. Why this matters in Chennai

**Power is cut on purpose, early, and for days.** The power utility (TANGEDCO, now TNPDCL) does not switch power back on while transformers and pillar boxes are under water.
- On 4 Dec 2023 (Cyclone Michaung), 712 of Chennai's 1,814 11 kV feeders were off, most "tripped for safety".
- Velachery had no power from Sunday to Wednesday night. Mogappair was without it for 3 to 4 days.
- Days later, 77 distribution stations were still down, including in Pallikaranai, Madipakkam and Vyasarpadi.
- In 2015, by one account power was suspended to about 60% of the city on 1 Dec (primary source not found). A hospital went 57 to 69 hours without power.

**Then the phones go.** Tower batteries last hours; generators flood or run out of diesel.
- 2015: networks were mostly down for about 3 days. Voice calls failed while WhatsApp still worked, and police ran a rescue WhatsApp group "since WhatsApp alone was working".
- 2023: on 5 Dec, 30% of the city's 42,747 towers were down for lack of power. In Velachery, Jio failed entirely and Airtel allowed calls but no internet. Phones were charged in cars to about 10%. North Chennai had no signal about 4 days in; volunteers used walkie-talkies. Residents could not reach helplines.
- Which channel survives (calls, SMS, data) is unpredictable, so we offer every channel and depend on none.

**What people needed:**
- **Where to put the car.** Velachery, Pallikaranai, Medavakkam and Mint flyovers filled with cars in Fengal 2024. Reports of fines for flyover parking were denied by traffic police; there is no standing official permission. Motor insurance drove most of the Rs 4,800 crore of 2015 claims.
- **Hospitals.** In 2015, 18 ICU patients at MIOT died when water reached the generator room. In 2023 Global Hospital, Perumbakkam shut, and dialysis patients travelled 26 km to MGM.
- **Not walking into live wires or open drains.** Electrocutions in waterlogged streets in 2023 (GN Chetty Road, Lake View Road) and in Fengal 2024 (Muthialpet, Velachery); deaths in unfinished storm-water drain trenches as recently as Aug 2026.
- **Relief camps.** There were 162 GCC centres in 2023, but on 4 Dec only 43 were operating. One centre (Ambattur) was itself flooding. The list exists only as a PDF of addresses.
- **Trustworthy information.** Fake NASA forecasts, fake crocodile photos and recycled videos spread every time. People trusted named sources (official handles, the Tamil Nadu Weatherman).

**Who already serves residents (point to them, don't compete):**
- **TN-Alert** (state, 5 lakh+ installs): official rainfall, forecasts, reservoir levels and location alerts in Tamil. It has no street depths, parking, routing or hospitals.
- **Chennai Flood Monitor** (RTFF & SDSS, World Bank funded, reported operational since Oct 2025): 72-hour warnings, and it claims street-level inundation forecasts for vulnerable areas (Velachery, Saidapet, Mudichur), in English and Tamil.
- **CFLOWS** (NCCR) for officials.
- Helplines: 112, GCC 1913, the power utility's Minnagam line 94987 94987.

**Positioning consequence:** our pitch must not imply HighGround is the only street-level forecast. Our difference is what you *do*: where to park, how to get there without crossing water, which hospitals you can still reach, and that it keeps working when the network does not.

**Two-wheelers dominate:** Chennai had 54 lakh two-wheelers and 11.75 lakh four-wheelers (2019), so "Two-wheeler" is the default navigation mode.

**Language:** about 18.5% of Tamil Nadu residents speak English (2011); every official tool is Tamil-first or bilingual. English-only stays a stated limit in About.

---

## 2. What a resident experiences

**Before the storm (online)**
1. Searches their street; the answer card appears as today.
2. Taps **Save for offline**: "About 18 MB. Use Wi-Fi if you can." A progress bar; when done: "Saved. Works without internet. Forecast from 6:00 PM." When the forecast crosses into a heavy-rain scenario, the app (and later the alert email) prompts "Heavy rain is coming. Save your area now, before the power goes." Outages start with precautionary power cuts, and tower batteries last only hours.
3. Optionally saves up to 3 places (home, work, parents).
4. Taps **My flood plan**: gets an image and a text version to keep in the gallery or send to the family WhatsApp group.

**During the storm (no data, low battery)**
1. Opens HighGround from the home screen. It loads from the phone. A quiet chip says "Offline · forecast from 6:00 PM (5 h ago)".
2. The answer card still works for their saved places, for any scenario. If they hear a rainfall number (radio, TN-Alert, a neighbour), they can enter it and see what that rainfall does to their street. Every number still comes from the model files.
3. **Take me to dry ground**: picks "On foot / Two-wheeler / Car" and a destination (dry parking, a hospital, high ground, home). Gets a route that avoids water and a list of turns; with GPS on, the next turn is shown in large type and the route recalculates if they go off it.
4. **Low-power map**: a flat 2D map with streets coloured by depth, no 3D, no rain, no water animation.
5. **Help card** (works with zero data): tap-to-call 112, 1913, 1070, 1077, 108, 101 and Minnagam 94987 94987; "Send my location" builds an SMS/WhatsApp text with their GPS coordinates and street (police asked flood-prone residents to keep coordinates handy).
6. If no route avoids deep water: "No route avoids deep water. If you are safe, stay where you are. Call 112 if water enters your home."

---

## 3. Guardrails (apply to everything below)

- **Never route into water.** Block an edge at the limit; never offer a "least-bad wet route".
- **Lean cautious, because the model is weak at street level.** On 2015, ranking wards by flooding, the model is only slightly better than chance (AUC 0.53, 95% CI 0.51 to 0.55). So routing limits sit below the display bands, route on the worse of the two blended scenarios, prefer main roads, and look one model hour ahead.
- **Never invent numbers.** Offline answers come from the saved model files; the "enter a rainfall" input only picks a precomputed scenario.
- **Be honest about staleness.** Always show when the forecast was made; after 6 h add "may be out of date"; after 24 h switch to the rainfall ladder.
- **Words we never use:** "safe route", "dry route", "real-time flooded roads", "official", "flyover parking is allowed", "this relief camp is open", "works on every phone offline". We say: "a route that avoids streets our model expects to flood".
- **Always visible while navigating:** "Model estimate, not a sighting. If you see water above your ankle, turn back." Plus live-wire and open-drain warnings.
- **Point to official channels, don't compete with them:** 112 for emergencies (the only red element), GCC 1913, 1070/1077, Minnagam 94987 94987 for fallen wires, TN-Alert and Chennai Flood Monitor for official warnings. No in-app "SOS" that pretends to reach responders.
- **Nothing is live offline:** water, road closures, power, relief-centre opening and hospital status are never shown as current. Every number carries its scenario and "as of" time.
- Design rules unchanged: amber only for safe ground, parking and the suggested route; English only; sentence case; plain words.

---

## 4. Offline design

### 4.1 Three tiers, in order of what must never fail

| Tier | Works when | Size | Notes |
|---|---|---|---|
| **My flood plan** (image + text) | Always, even without the app (it lives in the gallery or a chat) | ~200 KB image | Drawn on a canvas from model output; shared via the phone's share sheet (Quick Share/AirDrop work without internet), `sms:` link (person-to-person SMS, no DLT needed), copy, download |
| **2D low-power app** | After Save for offline | ~18 MB download | Basemap to zoom 14, street depth lines, answer card, routing, turn list |
| **3D add-on** | Optional, Wi-Fi only | +~31 MB | Zoom 15 basemap, terrain, water PNGs for the current scenario pair |

### 4.2 The offline pack ("Save for offline")

Sizes computed from `data/out/web` (gzipped download):

| Item | Download | Notes |
|---|---|---|
| App shell (JS, CSS, MapLibre worker `.mjs`) | 0.7 MB | Precached by the service worker |
| UI fonts (Anek Latin, Hind), map glyphs and sprite | ~0.4 MB | Self-hosted; today glyphs/sprites come from protomaps.github.io and fonts from Google Fonts, which fail offline |
| Basemap, citywide, zoom 0 to 14 | 7.1 MB | `pmtiles extract --maxzoom=14`; MapLibre overzooms it |
| Street answers, 3 km around each saved place, all 16 scenarios + geometry | 2.0 MB | Existing 2 km street tiles (16 tiles for 3 km) |
| Small JSON (places, parking, hospitals, runs, current) | 0.13 MB | |
| Road graph core + names, citywide | 5.8 MB | Pre-gzip `.bin` at upload: CloudFront does not compress `application/octet-stream` |
| Peak edge depths, all 16 scenarios | 1.7 MB | Lets offline routing work for any scenario |
| Hourly edge depths, current scenario pair | ~2 MB | Time-aware routing; other scenarios fall back to peak depths (more cautious) |
| **Total** | **~18 MB** | ~16 s at 10 Mbps; ~25 min on 2G, so it must be resumable and done before the storm |

Stored size is larger (street JSON is 27.5 MB raw for 3 km). Store it gzipped with `CompressionStream` and decompress in the service worker (Chrome 80+, Safari 16.4+, Firefox 113+), or accept ~40 MB stored.

### 4.3 How it works in code

- **Service worker** via `vite-plugin-pwa` 1.3.0 (`injectManifest`; first release supporting Vite 8) and Workbox 7.4.1. All data loads already go through `getJSON`/`getBin` in `web/src/lib/data.ts` and MapLibre, so intercepting `${DATA_BASE}/*` makes the existing app work offline almost unchanged.
  - Pack files: cache-first, stored under the same URLs the app already requests.
  - `current.json`: network-first with a 4 s timeout, then the cached copy.
  - Must-set options: `globPatterns` must include `mjs` (the default misses MapLibre's worker, so the map would not start offline); `maximumFileSizeToCacheInBytes` 4 MiB (our `index.js` is 1.95 MB, just under the 2 MiB default); `globIgnores: ['data/**']` (dist/data is 446 MB); `registerType: 'prompt'` (never auto-reload mid-emergency).
- **Basemap offline:** a ~20-line PMTiles `Source` that reads byte ranges from the cached file (`blob.slice`), falling back to `FetchSource`. Keeps the `pmtiles://` URL unchanged. (Browsers do not cache range requests reliably; Firefox does not at all.)
- **Pack downloader:** on the user's tap: `navigator.storage.persist()` then `estimate()` (show free space), download file by file with saved progress, write a pack record (centre, radius, model version, time). New versions build into a new cache and switch atomically; never delete the old pack before the new one is complete.
- **Versioned data on S3/CloudFront:** `data/v{MODEL}/…` with `Cache-Control: immutable` and a `pack-manifest.json` (path, bytes, sha256) so a model re-run downloads only changed files. `current.json` stays mutable and uncached.
- **Amplify Hosting:** `customHttp.yml` with `no-cache` for `sw.js`, `index.html` and the manifest.
- **Connectivity:** `navigator.onLine === false` is trustworthy; `true` is not. Probe `current.json` with `no-store` and a 4 to 6 s timeout; treat an HTML reply as offline (captive portals). Never block the UI on the network.
- **Offline search:** `places.json` already has 8,427 names (7,684 streets). Add uFuzzy 1.0.19 (3.9 KB gzipped) for typo tolerance, with normalisation (rd/road, st/street, Velacheri/Velachery, Tiruvanmiyur/Thiruvanmiyur) and parking and hospital names. House-number search needs Amazon Location and is online only.
- **Subscriptions made offline** ("Email me if this changes") are queued with Workbox Background Sync and sent when the network returns.

### 4.4 Updates and staleness

| Channel | Carries | Works on | When |
|---|---|---|---|
| App open, poll every 15 min | `current.json` (4 KB) | All | Slice 1 |
| Web Push from `forecast_check` Lambda | A <200 B pointer; the service worker updates the cached `current.json` and notifies only if the user's band changes | Android; iPhone only from the home screen | Later |
| Periodic Background Sync | `current.json` | Chromium, installed, engagement-gated | Later |

None of these work once data is down; they only keep the pack fresh while the network is up. Staleness rules are in section 3.

**Rainfall ladder** (when the forecast is old or never synced): what this street does at 50, 100, 150, 200, 300 and 400 mm, plus "Heard a rainfall number? Enter it." Uses only precomputed scenarios.

### 4.5 Low-power mode

Turned on by a toggle, or suggested when offline, when the battery is under 20% and not charging (Chromium only), or on 2G (Chromium only).
- Does not load three.js, the water layer or rain (gated dynamic import); no terrain, relief, 3D buildings, sky or fog; pitch 0; `pixelRatio` 1; no antialias; `jumpTo` instead of camera flights.
- Water drawn as street lines coloured by depth band from the street tiles, redrawn only when the hour changes, so the map repaints only on input.
- True black background. Do not quote a battery saving: dark mode on OLED saves 39 to 47% at full brightness but only 3 to 9% at 30 to 50% (Purdue); add a "dim your screen" tip instead.

### 4.6 Browser support (what we can honestly promise)

India's mobile web is ~92% Android, ~88% Chrome (StatCounter, July 2026), so we design for Android Chrome first.

| Capability | Chrome Android | Samsung Internet | Safari iOS | Firefox Android |
|---|---|---|---|---|
| Service worker + Cache API | Yes | Yes | Yes | Yes (not private mode) |
| `storage.persist()` | Yes, silent heuristics | Yes | 15.2+, heuristics (home screen helps) | Asks the user |
| Saved data wiped after 7 days unused | No | No | **Yes unless added to home screen** | No |
| Share files (plan image) | Yes | Yes | Yes | **No** (text only) |
| Background Sync | Yes | Yes | No | No |
| Battery / network type hints | Yes | Yes | No | No |
| `CompressionStream` | 80+ | 13+ | 16.4+ | 113+ |

iPhone message: "Add HighGround to your home screen to keep it saved." Opera Mini: no offline support.

---

## 5. Navigation design

### 5.1 What we have and what is missing (measured)

- Plain A* on typed arrays, 162k nodes / 206k edges. Measured on this laptop (Node): graph load + adjacency 44 ms; city-wide trips median 11 ms, p90 36 ms dry; 300 mm scenario median 9 ms, p90 65 ms, worst 162 ms (no-route cases search ~114k nodes). Memory ~10.5 MB + ~2 MB per search. A low-end Android phone may be 5 to 10 times slower (estimate, not measured): fine in a Web Worker.
- **Missing in the graph:** one-way (7,554 one-way roads in the Chennai area, so car routes can go the wrong way today), roundabouts (49), tunnels/underpasses (120), `ref`, and footpaths/steps (~2,350). Names: 81 to 90% on main roads, but only 21% on residential and 4% on service roads, so directions must work without names ("take the 2nd left").
- **Water rises faster than our hourly steps:** in the Michaung replay, 29% of edges go from 15 cm to 30 cm within one model hour. Routes must look ahead.
- **"Leave by" gaps:** it checks depth at departure, not along the drive; its binary search assumes roads stay closed once closed (true while rising, not after the peak).
- **Underpasses are invisible to a 30 m model**, yet they flood first (6 to 7 of 22 subways closed in Fengal 2024; 13 of 16 in 2021).

### 5.2 Modes and limits

Routing limits sit below the display bands on purpose (hourly snapshots, p90 depth along each edge, no water velocity, AUC 0.53). Two-wheeler is the default mode (Chennai has about 4.6 two-wheelers per car).

| Mode | Route blocks at | Penalised from | Basis |
|---|---|---|---|
| On foot | 10 cm | 5 cm | 15 cm of moving water can knock an adult over (US NWS; India's flood advice); Australian hazard curves call water "generally safe" only to 0.3 m deep and depth×velocity 0.3, unsafe for children and elderly above 0.5 m. In Chennai, walking deaths come mostly from live wires and open drains, at any depth |
| Two-wheeler | 10 cm | 5 cm | No published limit; mechanics' advice: stop at calf depth. Our display band stays 15 cm |
| Car | 20 cm | 10 cm | Small cars float at 0.3 m still water, 0.15 m at 3 m/s (WRL 2017); traffic speed falls to near zero at 300 mm (Pregnolato 2017) |

All modes: underpasses and tunnels blocked whenever the scenario has rain; cars and two-wheelers follow one-way rules; bridges and flyover decks stay passable (already in the data).

### 5.3 Route cost

For mode *m* with block depth *B*, an edge *e* reached at estimated time *t*:

```
D_e  = max( d_e(hour t), d_e(hour t + 1) )                 look one model hour ahead
block if D_e >= B, or e is an underpass in rain, or against one-way (vehicles)
cost = length_e × k_class × (1 + 3 × (D_e / B)^2)
k_class = 1.0 trunk/primary · 1.05 secondary · 1.15 tertiary · 1.3 residential · 1.5 service
```

Cost is never below length, so the straight-line A* heuristic stays exact. The class weights and the factor 3 are our assumptions (prefer main roads: wider, watched, reachable by rescuers). Depths come from the **worse** of the two blended scenarios. Time advances along the route (earliest-arrival A*; exact while water is rising). After the peak, show "wait until about 4 AM" by trying later departures.

**Instant "no route":** per scenario and hour, label connected components of passable edges; if start and destination differ, answer at once instead of searching the whole city.

**Nearest dry place** is one Dijkstra outward from the person, stopping at the first destination of the chosen kind (as `toArterial` already does).

### 5.4 Destinations

| Destination | Source | Status |
|---|---|---|
| Dry parking | `parking.json` (flyovers, multi-storey, open ground) | Ready. Keep "Check local traffic advisories before parking on a flyover"; never say "allowed" (fine reports and police denials conflict). Exclude metro station lots CMRL warned against in 2024 (Koyambedu, St. Thomas Mount, Arumbakkam). Traffic police control rooms 044-23452330 / 044-23452362 were offered to help find parking (single source; verify before showing) |
| Hospitals | `hospitals.json` | Ready. Show several, with "call ahead" (Global Hospital, Perumbakkam shut in 2023) |
| High ground | Derived: nodes whose roads stay under 5 cm at peak and connect to main roads | Compute in `05_features.py` |
| Home / saved places | On the phone | Ready |
| Pharmacies, fuel, police, fire stations | OSM in our area: 292 / 240 / 112 / 14 | Extract in `05_features.py` |
| Relief centres | GCC list on OpenCity (PDF, Oct 2024): 243 rows, 75 "not found", ~168 text addresses, **no coordinates**, includes officials' personal numbers (do not show) | After the deadline: geocode, spot-check, label "Oct 2024 list; call 1913 to check it is open", and "may be flooded in this scenario" where the model says so (a centre flooded in 2023). The count changes every season (162 in 2023, 215 in 2025) |
| OSM shelters | 90 `amenity=shelter` (mostly bus stops), 7 `social_facility=shelter`, 0 assembly points | Not usable |
| Phone charging points | None in data | Needs curation; later |

### 5.5 Directions without a routing server

About 200 lines of our own English generator:
1. Merge consecutive edges with the same name; merge unnamed edges of the same class that bend less than 30°.
2. At each junction compare the heading over the last 15 m in vs the first 15 m out: under 11° continue; under 40° slight; under 103° turn; above that sharp; 160° to 200° U-turn (GraphHopper's thresholds). Say nothing where there is no real choice.
3. Phrasing: "Turn left onto 100 Feet Road"; unnamed: "Take the 2nd left" (count junctions of 3+ roads); use `ref` if no name; "At the roundabout, take the 2nd exit"; "Go up the flyover".
4. Distances rounded to 50 m under 1 km; announce at ~300 m and ~50 m for vehicles, ~50 m and at the junction on foot.

### 5.6 Live navigation (Slice 3)

- `watchPosition({ enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 })`; ignore fixes worse than 50 m.
- Snap only to the route ahead, within max(15 m, accuracy). Off route: more than 50 m + accuracy for 3 fixes (vehicles), 30 m on foot. Reroute in the worker from the current position.
- Recheck the remaining route at each model-hour change and when `current.json` changes; reroute if an edge ahead reaches the block depth within ETA + 1 hour: "Water expected ahead on X. New route."
- Screen: one instruction in large Anek Latin type, the distance, at most one water line, the honesty line. 2D low-power map. Screen wake lock only while navigating (re-acquire on visibility). Voice via `speechSynthesis`, started from a tap (iOS rule), if the phone has a voice installed. Vibration where supported (not iOS, not Firefox).
- GPS works without mobile data, but a cold first fix without assistance data can take minutes. Tell users: "Open HighGround once before the storm."
- **Web limit:** location and voice stop when the screen is off or the tab is hidden, on every browser. True background navigation needs a native wrapper (later).

| API | Chrome Android | Samsung | Safari iOS | Firefox Android |
|---|---|---|---|---|
| Location (HTTPS only) | Yes | Yes | Yes | Yes |
| Screen wake lock | Yes | 14+ | 16.4+ (home-screen apps fixed in 18.4) | 126+ |
| Voice | Yes (needs voice pack) | Yes | Yes (first call from a tap) | Yes |
| Vibration | Yes | Yes | No | No |
| Compass | Yes | Yes | Needs permission tap | Yes |

### 5.7 Amazon Location Routes: not for routing

Routes v2 supports car, pedestrian and scooter with avoid-area polygons, but avoidance is best effort ("may still include restricted areas if no feasible alternative exists"), and at 400 mm we have ~68k flooded edges to turn into polygons. So: keep routing in the browser (works offline, never routes through water we know about), keep Amazon Location for address search. Note: the geocode Lambda uses `IntendedUse=SingleUse`; storing results needs `Storage` (higher tier), so the offline pack saves our own snapped segment, not the geocoder's answer.

---

## 6. Where AWS carries it

- **S3 + CloudFront:** versioned, immutable offline packs and manifest; pre-gzipped graph binaries.
- **Amplify Hosting:** the PWA with correct cache headers for `sw.js`.
- **Lambda `forecast_check`** (already every 3 h via EventBridge): writes `current.json` (the 4 KB update every offline pack needs). Later: precompute per-hour connectivity labels and a citywide "move your car by" map to S3; send Web Push (VAPID key in SSM, subscriptions in the existing DynamoDB table); add the official IMD warning from NDMA's SACHET CAP feed (live; 99 items fetched on 10 Oct incl. Chennai; English only) as "Official warning" in `current.json`. The feed sends no CORS headers, so a browser cannot read it directly: the Lambda is the only way to bring it into the app, and it then lands in every offline pack.
- **Amazon Location:** address search online; results never stored.
- **Later, honest "coming soon":** SMS alerts via AWS End User Messaging (needs TRAI DLT registration: company PAN/GSTIN, sender header, templates; not doable by students in a weekend), IVR via Amazon Connect (Indian numbers need documents, weeks).
- **Not ours to claim:** Cell Broadcast (government agencies only, via NDMA/C-DOT).

---

## 7. Build plan

Effort is for Claude building with tests and reviewers. Order is strict: each slice ships on its own.

### Slice 1: works offline (~6 h) — before the deadline

| # | Task | Files |
|---|---|---|
| 1.1 | **My flood plan** card: canvas image (street, worst depth and time, scenario and forecast time, parking + distance, route as street list + schematic line, nearest hospital, 112 and 1913), share files / text / `sms:` / copy / download; GSM-7-only text | `web/src/ui/PlanCard.tsx`, `web/src/lib/plan.ts` |
| 1.1b | **Help card**: tap-to-call numbers (112 in red, 1913, 1070, 1077, 108, 101, Minnagam 94987 94987) and "Send my location" (GPS coordinates + street as a pre-filled SMS/WhatsApp text) | `web/src/ui/HelpCard.tsx` |
| 1.2 | PWA: `vite-plugin-pwa` 1.3.0 injectManifest, manifest + icons, self-hosted fonts (`@fontsource-variable/anek-latin`, `@fontsource/hind`), glyphs and sprite | `web/vite.config.ts`, `web/src/sw.ts`, `web/index.html`, `web/src/map/style.ts` |
| 1.3 | Pack: zoom-14 basemap extract, pre-gzipped graph, `pack-manifest.json` | `pipeline/07_export_tiles.py` |
| 1.4 | Save for offline: downloader, `persist()`/`estimate()`, progress, pack record, PMTiles cache `Source` | `web/src/offline/pack.ts`, `web/src/offline/source.ts`, `web/src/screens/Tonight.tsx` |
| 1.5 | Offline chip + forecast age + probe | `web/src/offline/status.ts`, `web/src/App.tsx` |
| 1.6 | Gate: Playwright `context.setOffline(true)` runs the hero flow from cache on the production build | `web/tests/offline.mjs` |

### Slice 2: take me to dry ground (~7 h) — before the deadline if Slice 1 is green

| # | Task | Files |
|---|---|---|
| 2.1 | Pipeline: `flags.bin` (one-way fwd/rev, roundabout, tunnel/underpass, slip road), `refs.json`, hourly edge depths from 10 cm, POIs (pharmacy, fuel, police, fire), high-ground nodes | `pipeline/05_features.py` |
| 2.2 | Router in a Web Worker: mode limits, cost function, one-hour look-ahead, worse-scenario depths, one-way, underpass rule, instant no-route, nearest-of-kind | `web/src/lib/routing.ts`, `web/src/lib/route.worker.ts` |
| 2.3 | Directions generator | `web/src/lib/directions.ts` |
| 2.4 | "Take me to dry ground" panel: mode, destination kind, route on map (amber), turn list, honesty line, no-route message | `web/src/screens/Tonight.tsx`, `web/src/ui/GoPanel.tsx` |
| 2.5 | Rainfall ladder + "enter a rainfall" offline | `web/src/ui/RainLadder.tsx` |
| 2.6 | Gates: unit checks (never crosses an edge ≥ limit; one-way respected; no-route answered under 50 ms), qa-tester + design-critic, recorded flow | `web/tests/route_rules.mjs` |

### Slice 3: live turn-by-turn (~5 h) — only if time is left

GPS follow, snapping, off-route reroute, hour-change recheck, wake lock, voice, 2D low-power navigation view; Playwright test with a simulated GPS track along a Michaung route.

### After the hackathon

Relief centres geocoded and verified (1 day) · Web Push and periodic sync (1.5 days) · SACHET official warnings in the app (0.5 day) · citywide "move your car by" layer from Lambda (1 to 2 days) · walking network with footpaths and steps (1 day) · depth×velocity hazard per edge from the solver (1 to 2 days) · turn restrictions (2 days) · landmark directions for unnamed streets (2 to 3 days) · crowd reports that can only make routes more cautious, photo required, 3 h expiry, moderated (1 to 2 weeks) · native wrapper for screen-off navigation (1 to 2 weeks) · Tamil (needs a spec change; English-only today) · SMS via a DLT-registered partner and IVR (weeks).

### Schedule to the deadline

| IST | What |
|---|---|
| Now to 06:00 | Slice 1 |
| 06:00 to 13:00 | Slice 2 |
| 13:00 to 14:00 | Feature freeze; reviewers; rebuild; PROGRESS.md |
| Any time the AWS profile exists | `infra/deploy.sh`, live URL, real alert email (user steps in PROGRESS.md) |
| 14:00 to 17:00 | Record the demo; the offline beat on a real Android phone in airplane mode |
| 17:00 to 20:00 | Edit, blog, submit |

Slice 3 only fits if Slices 1 and 2 finish early; otherwise it goes in the video as "next".

---

## 8. Demo video beat (15 seconds)

Motivating facts to put on screen (sources in section 10): "4 Dec 2023: 712 of Chennai's 1,814 power feeders switched off." "5 Dec 2023: 30% of the city's 42,747 mobile towers down." "2015: networks down for about 3 days."

"When the power goes, the towers go." Phone, airplane mode on. HighGround still opens: "Offline · forecast from 6:00 PM". The answer card for a Velachery street. "Take me to dry ground · Two-wheeler": the amber route bends around the deep streets, the turn list appears. "My flood plan" goes to the family group as an image. Caption: "Saved before the storm. Works without internet."

---

## 9. Risks and what we must not claim

- **Positioning:** Chennai Flood Monitor (state, since Oct 2025) claims street-level inundation forecasts for vulnerable areas, and TN-Alert has 5 lakh+ installs. Never say we are the only street-level forecast; say what we add (parking, routes around water, hospitals, offline).
- iPhone users who have not added the app to the home screen lose saved data after 7 days without a visit.
- Best-effort storage can be evicted on a full phone; call `persist()`.
- A service worker update must never reload the page or wipe the pack mid-emergency.
- Missing glyph ranges mean missing labels offline; test with the network off.
- The first GPS fix without data can be slow.
- Never claim: safe or dry routes, live updates during an outage, SMS alerts or Cell Broadcast, phone-to-phone mesh (we hand off to the share sheet), a battery-saving percentage, background updates on iPhone, routing outside the saved area without the graph.
- Liability wording on every route: "Suggested route that avoids streets our model expects to flood. Not an official route or warning. Roads may be closed or blocked by water, trees or fallen wires the model cannot see. Never walk, ride or drive into floodwater. Follow GCC and IMD advisories."
- Not verified: low-end Android routing speed; Amazon Location route pricing and avoid-area limits; any official Chennai position on flyover parking; an authority source for the 15 cm two-wheeler band; Samsung/Firefox `persist()` behaviour; whether Chrome still sends `Save-Data`.

---

## 10. Sources

**Offline**
- Chennai mobile networks down three days in Dec 2015: https://www.thenewsminute.com/article/why-chennai-facing-poor-mobile-phone-signal-issues-36550
- India mobile OS and browser share (StatCounter): https://gs.statcounter.com/os-market-share/mobile/india · https://gs.statcounter.com/browser-market-share/mobile/india
- PMTiles offline and range-request caching: https://github.com/protomaps/PMTiles/issues/272 · https://github.com/protomaps/PMTiles/issues/395
- MapLibre offline discussions: https://github.com/maplibre/maplibre-gl-js/issues/207 · https://github.com/maplibre/maplibre-gl-js/issues/662
- Workbox range requests: https://developer.chrome.com/docs/workbox/modules/workbox-range-requests · storage quota and opaque responses: https://developer.chrome.com/docs/workbox/understanding-storage-quota · background sync: https://developer.chrome.com/docs/workbox/modules/workbox-background-sync
- Storage quotas and eviction: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria · https://webkit.org/blog/14403/updates-to-storage-policy/ · https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ · https://web.dev/articles/persistent-storage
- Periodic background sync: https://developer.chrome.com/docs/capabilities/periodic-background-sync
- CloudFront compression types: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html
- Amplify custom headers and cache: https://docs.aws.amazon.com/amplify/latest/userguide/setting-custom-headers.html · https://docs.aws.amazon.com/amplify/latest/userguide/managing-cache-configuration.html
- Amazon Location intended use (SingleUse vs Storage): https://docs.aws.amazon.com/location/latest/developerguide/places-intended-use.html
- Offline detection pitfalls: https://textslashplain.com/2023/05/15/detecting-when-the-user-is-offline/
- Dark mode battery (Purdue): https://www.purdue.edu/newsroom/releases/2021/Q3/dark-mode-may-not-save-your-phones-battery-life-as-much-as-you-think,-but-there-are-a-few-silver-linings.html
- `sms:` URI behaviour: https://weblog.west-wind.com/posts/2013/Oct/09/Prefilling-an-SMS-on-Mobile-Devices-with-the-sms-Uri-Scheme
- India SMS sender ID / DLT on AWS End User Messaging: https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-sms-senderid-india.html
- Cell Broadcast national test, May 2026: https://www.etvbharat.com/en/bharat/ndma-tests-cell-broadcast-message-to-alert-citizens-on-severe-disaster-enn26050201915
- Quick Share works without mobile data: https://www.android.com/intl/en_in/quick-share/with-android/
- Web Bluetooth cannot advertise: https://lists.w3.org/Archives/Public/public-web-bluetooth-log/2020Mar/thread.html
- Ham radio in 2015: https://www.arrl.org/news/radio-amateurs-respond-to-grim-flood-situation-in-southern-india
- Google Maps offline areas: https://support.google.com/maps/answer/6291838 · Kiwix PWA storage: https://web.dev/case-studies/kiwix

**Navigation**
- Moving water knocks adults over at ~15 cm; cars float at ~30 cm: https://weather.gov/shv/awarenessweek_flood_tadd · https://weather.gov/tsa/hydro_tadd · https://en.vikaspedia.in/viewcontent/social-welfare/disaster-management-1/natural-disasters/floods
- Australian flood hazard curves (WRL TR 2014/07): https://knowledge.aidr.org.au/media/2334/wrl-flood-hazard-techinical-report-september-2014.pdf
- Vehicle stability in floodwater (WRL 2017): https://www.unsw.edu.au/content/dam/pdfs/engineering/civil-environmental/water-research-laboratory/publications/WRL-TR2017-07-Vehicle-Stability-Testing-for-Flood-Flows.pdf
- Traffic speed vs water depth (Pregnolato 2017): https://doi.org/10.1016/j.trd.2017.06.020
- Two-wheeler advice: https://deccanherald.com/india/karnataka/bengaluru/driving-or-stuck-on-a-flooded-road-here-s-what-you-can-do-1134730.html
- Chennai subways closed: https://www.thehitavada.com/Encyc/2024/12/1/Cyclone-Fengal-makes-landfall-no-major-damage.html · https://www.thenewsminute.com/article/subways-closed-chennai-due-water-logging-traffic-moving-slowly-159328
- Electrocutions in Chennai floods: https://www.dtnext.in/news/chennai/death-toll-rises-to-12-boats-and-tractors-used-in-rescue-efforts-in-rain-hit-chennai-752506 · https://scroll.in/latest/856632/madras-hc-orders-rs-10-lakh-compensation-to-family-of-two-girls-electrocuted-in-chennai-rains · https://www.theweek.in/wire-updates/national/2025/08/23/mds15-tn-rain-ld-electrocution.html
- Open storm drain death: https://www.thenewsminute.com/article/chennai-journalist-dies-after-falling-unfinished-stormwater-drain-169160
- Minnagam (TANGEDCO complaints): https://www.dtnext.in/news/chennai/tangedcos-minnagam-service-hit-due-to-telecom-issues-742164
- GCC relief centres list (OpenCity): https://data.opencity.in/dataset/gcc-relief-centres · 215 camps in Oct 2025: https://thesouthfirst.com/tamilnadu/chennai-prepares-to-face-monsoon-fury-215-camps-106-kitchens-set-up/
- TNSDMA disaster telephone book: https://www.Tnsdma.Tn.Gov.In/app/webroot/img/2022/DisasterTelephoneBook_2023.pdf
- Flyover parking reports: https://indiaherald.com/Breaking/Read/994754314/There-is-no-penalty-for-parking-cars-on-the-flyover · CMRL advisory: https://www.thenewsminute.com/chennai/cyclone-fengal-chennai-metro-issues-safety-advisory-amid-heavy-rain
- GraphHopper instruction thresholds: https://github.com/graphhopper/graphhopper/blob/master/core/src/main/java/com/graphhopper/routing/InstructionsHelper.java · osrm-text-instructions: https://github.com/Project-OSRM/osrm-text-instructions
- Mapbox navigation constants (snapping, rerouting): https://github.com/mapbox/mapbox-navigation-ios/blob/v2.7.0/Sources/MapboxCoreNavigation/CoreConstants.swift
- Time-dependent shortest paths (FIFO): https://arxiv.org/pdf/1302.4987
- ngraph.path: https://github.com/anvaka/ngraph.path · RoutingKit CCH: https://docs.rs/crate/routingkit-cch/0.1.4
- GNSS without data: https://redmine.replicant.us/projects/replicant/wiki/GNSSResearch · https://www.gpsworld.com/?p=41184
- Wake lock in iOS home-screen apps: https://bugs.webkit.org/show_bug.cgi?id=254545 · Web Speech caveats: https://readium.org/speech/docs/WebSpeech.html
- Amazon Location CalculateRoutes and avoidance: https://docs.aws.amazon.com/location/latest/APIReference/API_CalculateRoutes.html · https://docs.aws.amazon.com/location/latest/APIReference/API_RouteAvoidanceOptions.html · pricing: https://docs.aws.amazon.com/location/latest/developerguide/routes-pricing.html
- Waze flood reports: https://support.google.com/waze/answer/13809605 · Google flood forecasting: https://blog.google/innovation-and-ai/technology/research/flood-prediction-ai/
- PetaBencana / RiskMap Chennai: https://info.petabencana.id/?p=1044 · https://solve.mit.edu/solutions/5247
- Trust in crowd flood reports: https://par.nsf.gov/servlets/purl/10291591 · Kerala 2018: https://freecodecamp.org/news/how-i-used-crowdsourcing-to-help-kerala-floods-rescue-operations-12dc97c9a24b
- Flood road closures and emergency access: https://dspace.lboro.ac.uk/2134/23621 · https://nhess.copernicus.org/articles/17/1/2017/
- Drivers ignoring closures: https://researchers.mq.edu.au/en/publications/driving-into-floodwater-a-systematic-review-of-risks-behaviour-an/

**Chennai ground truth**
- Michaung power feeders: https://www.thenewsminute.com/tamil-nadu/chennais-power-supply-will-be-restored-gradually-says-min-trb-rajaa · restoration and towers 70% working: https://www.theweek.in/wire-updates/national/2023/12/05/mds20-tn-cyclone-chief-secretary.html · protests, third day without power: https://www.dtnext.in/news/chennai/no-power-for-3rd-consecutive-day-residents-in-several-areas-protest-752797 · 77 stations down: https://www.dtnext.in/news/chennai/clearing-waterlogging-in-black-out-areas-on-priority-chief-secretary-752952
- Residents' accounts (Velachery, Mogappair; phones charged in cars): https://swarajyamag.com/amp/story/tamil-nadu/first-thing-was-no-power-how-these-chennai-residents-survived-72-hours-of-downpour
- 2015 floods overview: https://en.wikipedia.org/wiki/2015_South_India_floods · hospital without power 57 to 69 h: https://www.gulf-times.com/story/465415/Rain-again-anger-grows-at-lack-of-relief · first-hand account: https://amitavghosh.com/chennai-floods-2015/
- Fengal outages: https://www.dtnext.in/news/chennai/cyclone-fengal-long-power-outage-leaves-chennai-city-in-the-dark-813234
- 2015 telecom: https://www.businessinsider.in/telecom-companies-suffer-rs-300-crore-loss-due-to-chennai-floods/articleshow/50055000.cms · WhatsApp as lifeline: https://www.thenewsminute.com/news/how-whatsapp-became-lifeline-chennai-deprived-phone-calls-36679 · ham radio: https://www.iaru-r3.org/2015/hams-help-out-india-flood-disaster/
- 2023 telecom: https://www.business-standard.com/india-news/cyclone-michaung-chennai-residents-battle-power-mobile-disruption-123120500994_1.html · North Chennai: https://citizenmatters.in/north-chennai-floods-cyclone-michaung-rainwater-logging-inundation-vyasarpadi-ennore-gcc/ · helplines unreachable: https://thesouthfirst.com/tamilnadu/as-parts-of-chennai-remain-inundated-residents-still-struggle-with-power-outages-toll-rises-to-18/
- Fengal intra-circle roaming (Chennai not included): https://www.fonearena.com/blog/441543/cyclone-fengal-intra-circle-roaming-tamil-nadu.html
- TN-Alert: https://play.google.com/store/apps/details?id=int_.rimes.tnsmart · https://apps.apple.com/app/id1559849577 · https://www.dtnext.in/news/chennai/tn-alert-app-developed-to-disseminate-real-time-weather-data-in-tamil-cm-stalin-805704
- Chennai Flood Monitor: https://chennaifloodmonitor.tn.gov.in/Master/AboutUs · https://chennaifloodmonitor.tn.gov.in/Master/FAQ · CFLOWS: https://thewire.in/environment/nccr-develops-warning-system-for-flooding-in-chennai-with-ward-level-detail
- SACHET CAP feed: https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml · no CORS: https://thejeshgn.com/2025/05/28/common-alerting-protocol-cap-in-the-indian-context/
- Flyover parking: https://www.deccanherald.com/amp/story/india%2Ftamil-nadu%2Fcyclone-fengal-induced-rains-cause-heavy-inundation-people-park-vehicles-on-flyovers-3298468 · fines denied: https://thecommunemag.com/chennai-traffic-police-refute-media-claims-fines-on-cars-parked-on-flyovers-amid-heavy-rain/ · 2015 insurance claims: https://www.business-standard.com/amp/article/current-affairs/chennai-floods-insurance-claims-touch-rs-4-800-crore-116012201026_1.html
- MIOT 2015: https://csmonitor.com/World/2015/1205/Indian-monsoon-cuts-off-power-to-hospital-18-die · hospitals in 2023: https://www.thenewsminute.com/amp/story/tamil-nadu/chennai-floods-patients-caretakers-suffered-as-hospitals-became-inaccessible
- Electrocutions 2023: https://www.thenewsminute.com/tamil-nadu/chennai-rains-two-die-from-electrocution-in-waterlogged-streets · Fengal: https://www.etvbharat.com/en/!state/cyclone-fengal-tamil-nadu-puducherry-weather-rain-updates-imd-december-1-enn24120100833 · drain trench Aug 2026: https://newstodaynet.com/2026/08/24/rainwater-drain-trench-claims-womans-life-in-anna-nagar/
- Relief centres 2023 (162 set up, 43 operating): https://thenewsminute.com/tamil-nadu/cyclone-michaung-162-relief-camps-set-up-ndrf-deployed-in-chennai · flooding centre: https://www.thenewsminute.com/tamil-nadu/as-chennai-rains-intensify-residents-asked-to-move-to-relief-centres
- Subways and green corridors, Dec 2023: https://www.thenewsminute.com/tamil-nadu/chennai-floods-traffic-subways-and-train-updates-for-dec-6
- Misinformation: https://www.ibtimes.co.in/chennai-whatsapp-photo-crocodile-near-residential-area-fake-658401 · https://www.newschecker.in/fact-check/amidst-chennai-rains-old-video-of-flooding-at-sathyabama-college-shared-as-recent
- Emergency numbers: 112 https://onmanorama.com/news/india/2019/02/20/emergency-helpline-number-112-comes-into-effect.html · 1070/1077 https://tnsdma.tn.gov.in/ · 1913 https://newstodaynet.com/2023/11/14/chennai-rains-corporation-launches-24-7-helpline-for-citizens/ · Minnagam https://www.dtnext.in/news/city/tangedco-ready-to-face-monsoon-751744 · keep GPS coordinates handy: https://thenewsminute.com/tamil-nadu/chennai-rains-govt-on-high-alert-launches-helpline-and-initiates-precautionary-measures
- NDMA flood dos and don'ts: https://www.sphereindia.org.in/sites/default/files/2022-07/Flood%20Do%27s%20and%20Don%27ts%20%28210%20%C3%97%20297%20mm%29.pdf
- Vehicles in Chennai (2019): https://deccanchronicle.com/nation/current-affairs/211119/end-in-sight-for-parking-woes-in-burgeoning-city.html
- Language: https://www.tnpscthervupettagam.com/currentaffairs-detail/tn-language-atlas/47 · https://www.preventionweb.net/quick/50587

