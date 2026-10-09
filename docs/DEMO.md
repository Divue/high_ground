# Demo guide (generated from model outputs, do not edit numbers by hand)

Live app: (live URL after infra/deploy.sh)

## Velachery streets that flood in the Cyclone Michaung replay (pick one for the video)

| Street | Peak depth (cm) | Reaches 15 cm after (h from 6 PM) | Distance from Velachery station |
|---|---|---|---|
| 3rd Street | 168 | 10 | 2179 m |
| 10th Main Road | 168 | 10 | 2008 m |
| Kuberan Nagar 8th Street | 165 | 13 | 2366 m |
| 9th Street | 160 | 8 | 2483 m |
| Kakkan Nagar Main Road | 154 | 5 | 2422 m |
| Arumugam Road | 154 | 5 | 1541 m |
| 6th Street | 154 | 22 | 2318 m |
| 6th Main road | 147 | 27 | 1750 m |

Type the street name in the search box with **Replay Michaung 2023** selected (or open the app with `?replay=michaung2023`).

## Script beats with the numbers to say

- **0:15–1:15 Tonight:** the load flight from the Bay of Bengal, Michaung replay, street search, depth and time, dry parking, the amber route, then *Email me if this changes*. Show the real SNS email arriving (trigger it from `#admin` → *Run and send alerts* with 300 mm).
- **1:15–1:50 What if / Hospitals:** drag to 400 mm; open Hospitals at 300 mm.
- **1:50–2:30 Proof:** say it plainly: "We tested it on wards we never tuned on. Pick a street residents reported flooded in 2015 and one they didn't: the model ranks the reported one deeper **53%** of the time. Chance is 50%, elevation alone 47%, and the distance to the nearest canal 56%. So the model is slightly better than chance at street level, and we show you that."
  - The Chembarambakkam release matters on river-side streets: ranking 51% without it, 53% with it.
  - One sentence: "Storm-drain capacity (10 mm/h) is a stated assumption: on the tuning half of the wards, every value from 0 to 30 mm/h scored the same within its error bars."
- **2:30–3:00 Architecture + limits:** `docs/architecture.png`; read two limits from *About the model*; end on the What-if slider dragged back to 50 mm (water recedes).

## AWS services visible in the product (say each one)

Amazon S3 + CloudFront (model outputs and tiles) · AWS Amplify Hosting (the site) · Amazon API Gateway + AWS Lambda (subscribe, forecast check, assistant, geocode) · Amazon DynamoDB (subscribers) · Amazon SNS (alert email) · Amazon EventBridge Scheduler (every 3 hours) · Amazon Bedrock (alert text and assistant) · Strands Agents SDK (AWS open source, the assistant) · Amazon Location Service (address search) · AWS SAM (infrastructure) · AWS Open Data (Copernicus DEM, ESA WorldCover).

## Raw footage

`node web/tests/record_demo.mjs <url> review/p5/video` records a WebM walkthrough of every beat above.
