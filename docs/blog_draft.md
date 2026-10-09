# HighGround: telling Chennai residents where the water will go tonight

*Draft for AWS Builder Center (teammate 1 to edit). Every number here is from `data/out/proof.json` and the run logs.*

## The problem

Every monsoon, cars line the Velachery flyover the night before a storm. People park them there because nobody tells them where the water will go. Chennai has CFLOWS, a flood warning system built for officials. Residents have WhatsApp forwards.

HighGround answers four questions for one street: will it flood tonight and how deep, when does it pass 15 cm (the depth where two-wheelers stall), where is the nearest dry place to park, and which way can you drive there without crossing water. It also shows which hospitals get cut off, and it emails you if your street's risk changes.

## What we built

**A flood model we could test.** We started from open data on AWS: the Copernicus 30 m elevation model and ESA WorldCover land cover, both read straight from the AWS Open Data registry with no account needed. We added OpenStreetMap for buildings, roads, drains, hospitals and flyovers. The elevation data is a *surface* model, so it includes rooftops and tree canopy. We removed 372,000 mapped buildings, canopy, bridges and unmapped tall objects, filled the gaps from surrounding ground, carved rivers and drains, and put buildings back as obstacles that water flows around.

The solver is a 2D local-inertial shallow-water scheme (Bates et al. 2010), written in about 150 lines of numba. It runs on 1.2 million cells over the Greater Chennai Corporation area and conserves mass to better than 0.01% on every run. We ran 12 design storms (50–400 mm in 24 hours, at mean and high tide) and three real ones: 1–2 December 2015 with and without the Chembarambakkam reservoir release, Cyclone Michaung (2023) and Cyclone Fengal (2024).

**One tuned number, tested on wards it never saw.** Storm-drain capacity is the only calibrated parameter. We tuned it on the odd-numbered GCC wards against 7,924 streets that residents reported flooded in 2015, and we report results only on the even-numbered wards.

**AWS does the live work.**
- Amazon EventBridge Scheduler runs an AWS Lambda every 3 hours. It reads the Open-Meteo forecast for four Chennai points, picks the two nearest precomputed storms, and writes `current.json` to Amazon S3.
- When a subscribed street's risk band changes, Amazon Bedrock turns the model's numbers into two plain sentences and Amazon SNS emails them. A filter policy makes sure each email reaches only the people who follow that street. Subscribers live in Amazon DynamoDB.
- The *Ask HighGround* assistant is built with the **Strands Agents SDK** (AWS open source) on Bedrock. Its only knowledge is six tools that read model outputs. After it answers, we check every number in the reply against the tool outputs, and the UI marks each one "from the model".
- Address search uses Amazon Location Service, biased to Chennai.
- The site is on AWS Amplify Hosting; tiles and model outputs are on S3 behind Amazon CloudFront. The whole stack is one AWS SAM template.

**The browser only blends pictures.** MapLibre GL draws a dark 3D city. A three.js layer drapes one water mesh over the terrain and drives it with precomputed hourly depth textures. Scrubbing the night, dragging the what-if rainfall slider or replaying a cyclone just blends two textures, at around 60 fps on an integrated laptop GPU. Routing that avoids water is A* in the browser over a 206,000-edge road graph.

## Does it work?

On wards the model never saw, with the 2015 rain and the reservoir release, it floods **39%** of the streets residents reported. Flooding everything would score 100%, so we compare against a map that floods *the same amount of land* chosen by elevation alone: it catches **26%**. The naive "lowest 20% of the city floods" map catches **10%**.

Splitting reports by cause shows where the model is strong and where it is not:
- For rain-driven streets (more than 500 m from the Adyar and Cooum), the model gets 41% against 25% for the matched elevation map.
- For river-driven streets, the model gets 14% without the reservoir release and 19% with it, while an elevation map gets 33%. The release matters, and river flooding is where our model is weakest; other tanks' surplus water in 2015 is not included.

A second hydraulic model, ANUGA from Geoscience Australia, run on a triangular mesh over Velachery and Pallikaranai, agrees with ours on about nine in ten cells about whether water passes 15 cm. *(Final figure from `proof.json`.)*

## What fought back

1. **Satellite elevation is full of fake lakes.** Our first runs flooded scattered pits everywhere. Closed hollows in the 30 m data could hold 124 million m³ of water, about 70% of a whole 200 mm storm. We capped artificial hollows at 1 m, carved drains at realistic depths (a street drain is not the Adyar), and opened the edges of the model box so valleys could drain out.
2. **Our channels leaked before the rain started.** We had filled every river to its "spill level" at the start, and in some reaches that sat above the measured water surface. About 2% of the city was flooded at 6 PM in every scenario, before any rain. We caught it while picking demo streets, fixed it, and reran everything.
3. **Citizen reports only say where it flooded.** Unreported does not mean dry; reports cluster where more people were online. Hit rate minus false-alarm rate came out near zero for every map, including plain elevation. So we pre-registered a fairer score, the gain over an elevation map that floods the same area, before looking at the calibration results.
4. **A 2-core laptop.** The first solver needed 35 minutes per storm. Vectorised float32 kernels, a Halley-iteration cube root in place of `cbrt`, and removing the fake pits brought it to about 11 minutes.
5. **The honest answer is sometimes "your street stays dry".** At street level, flooding is patchy. The card now also says how many streets within 500 m pass 15 cm.

## Limits

30 m terrain; drains are one uniform capacity; the reservoir release is modelled from the CAG audit timeline; no storm surge; rain is uniform across the city. This is not an official warning: follow GCC and IMD advisories, and in danger call 112.
