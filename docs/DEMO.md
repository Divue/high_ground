# Demo guide (generated from model outputs, do not edit numbers by hand)

Live app: (live URL after infra/deploy.sh)

## Velachery streets that flood in the Cyclone Michaung replay (pick one for the video)

Each street below was typed into the search box with the Michaung replay on, and the answer card showed this depth (`web/tests/demo_streets.mjs`).

| Street (type exactly this) | Card shows | Too deep for scooters from | The card's decision |
|---|---|---|---|
| Dhandeeswaram Nagar 8th Cross Road | 118 cm | Tue 2 AM | Move your car to Velachery Upper Flyover (flyover, 600 m) by Tue 1 AM. |
| Dhandeeswaram Nagar 4th Avenue [west] 2 cross street | 118 cm | Tue 2 AM | Move your car to Velachery Upper Flyover (flyover, 600 m) by Tue 1 AM. |
| Dhandeeswaram Nagar 4th Avenue [west] | 118 cm | Tue 2 AM | Move your car to Velachery Upper Flyover (flyover, 600 m) by Tue 1 AM. |
| Dhandeeshwaram Nagar 3rd Main Road | 118 cm | Tue 2 AM | Move your car to Velachery Upper Flyover (flyover, 600 m) by Tue 1 AM. |
| Dhandeeshwaram 3rd Main Road | 118 cm | Tue 2 AM | Move your car to Velachery Upper Flyover (flyover, 750 m) by Tue 1 AM. |
| Kuberan Nagar 8th Street | 117 cm | Tue 4 AM | Move your car to Major Mukund Varadharajan Road Flyover (flyover, 1.1 km) by Tue 3 AM. |
| Velachery Main Road | 116 cm | Tue 2 AM | Move your car to Phoenix Marketcity Chennai Parking (multi-storey, 450 m) by Tue 1 AM. |
| Veerabandiya Kattabomman Street | 116 cm | Tue 2 AM | Move your car to Phoenix Marketcity Chennai Parking (multi-storey, 300 m) by Tue 12 AM. |
| Murugappa Street | 111 cm | Tue 2 AM | Move your car to Inner Ring Road (Southern Sector) (flyover, 1.3 km) by Tue 12 AM. |
| Officers Colony 5th Street | 109 cm | Tue 2 AM | Move your car to Maduvankarai Bridge (flyover, 1.1 km) by Tue 12 AM. |
| Kakkan Nagar Main Road | 109 cm | Tue 2 AM | Move your car to Inner Ring Road (Southern Sector) (flyover, 1.1 km) by Tue 1 AM. |
| Bharani Street | 107 cm | Tue 2 AM | Move your car to Velachery Upper Flyover (flyover, 1.2 km) by Tue 1 AM. |

Type the street name in the search box with **Replay Michaung 2023** selected (or open the app with `?replay=michaung2023`).

## Script beats with the numbers to say

- **0:15–1:15 Tonight:** the load flight from the Bay of Bengal, Michaung replay, street search, depth and time, dry parking, the amber route, then *Email me if this changes*. Show the real SNS email arriving (trigger it from `#admin` → *Run and send alerts* with 300 mm).
- **1:15–1:50 What if / Hospitals:** drag to 400 mm; open Hospitals at 300 mm.
- **Offline + navigation (15–20 s, inside 1:15–1:50):** network off, the app still opens (*Offline*, battery-saver map), *Take me to dry ground* · Two-wheeler draws the amber route around the water with directions, *Preview the drive*, then *My flood plan* shared as an image. "Saved before the storm. Works without internet."
- **1:50–2:30 Proof:** say it plainly: "We tested it on wards we never tuned on. Pick a street residents reported flooded in 2015 and one they didn't: the model ranks the reported one deeper **53%** of the time. Chance is 50%, elevation alone 47%, and the distance to the nearest canal 56%. So the model is slightly better than chance at street level, and we show you that."
  - The Chembarambakkam release matters on river-side streets: ranking 51% without it, 53% with it.
  - One sentence: "Storm-drain capacity (10 mm/h) is a stated assumption: on the tuning half of the wards, every value from 0 to 30 mm/h scored the same within its error bars."
  - ANUGA (Geoscience Australia) cross-check in Velachery: where either model has ≥15 cm, they agree on 73% of those cells (critical success index), depth correlation 0.90. Same terrain, so it checks the arithmetic, not the terrain.
- **2:30–3:00 Architecture + limits:** `docs/architecture.png`; read two limits from *About the model*; end on the What-if slider dragged back to 50 mm (water recedes).

## AWS services visible in the product (say each one)

Amazon S3 + CloudFront (model outputs and tiles) · AWS Amplify Hosting (the site) · Amazon API Gateway + AWS Lambda (subscribe, forecast check, assistant, geocode) · Amazon DynamoDB (subscribers) · Amazon SNS (alert email) · Amazon EventBridge Scheduler (every 3 hours) · Amazon Bedrock (alert text and assistant) · Strands Agents SDK (AWS open source, the assistant) · Amazon Location Service (address search) · AWS SAM (infrastructure) · AWS Open Data (Copernicus DEM, ESA WorldCover).

## Raw footage

**Smooth footage (use this for the video):** `cd web && WARM=1 node tests/record_frames.mjs <shot> <url>` with shot = opening | search | timelapse | whatif | proof. It drives the app with a virtual clock and waits for every tile before each frame, so the footage is a steady 30 fps at 1920×1080 even on a slow laptop (about 30 s of wall time per second of footage). Output: `review/p5/footage/<shot>.mp4` (H.264) plus the PNG frames as a lossless master.

`node web/tests/record_demo.mjs <url> review/p5/video` records a real-time WebM walkthrough (it stutters on slow machines).
