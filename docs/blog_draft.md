# HighGround: telling Chennai residents where the water will go tonight

*Draft for AWS Builder Center (teammate 1 to edit). Every number here is from `data/out/proof.json` and the run logs.*

## The problem

Every monsoon, cars line the Velachery flyover the night before a storm. People park them there because nobody tells them where the water will go. Chennai has CFLOWS, a flood warning system built for officials. Residents have WhatsApp forwards.

HighGround answers four questions for one street: will it flood tonight and how deep, when does it pass 15 cm (the depth where two-wheelers stall), where is the nearest dry place to park, and which way can you drive there without crossing water. It also shows which hospitals get cut off, and it emails you if your street's risk changes.

## What we built

**A flood model we could test.** We started from open data on AWS: the Copernicus 30 m elevation model and ESA WorldCover land cover, both read straight from the AWS Open Data registry with no account needed. We added OpenStreetMap for buildings, roads, drains, hospitals and flyovers. The elevation data is a *surface* model, so it includes rooftops and tree canopy. We removed 372,000 mapped buildings, canopy, bridges and unmapped tall objects, filled the gaps from surrounding ground, carved rivers and drains, and put buildings back as obstacles that water flows around.

The solver is a 2D local-inertial shallow-water scheme (Bates et al. 2010), written in about 150 lines of numba. It runs on 1.2 million cells over the Greater Chennai Corporation area and conserves mass to better than 0.01% on every run. We ran 12 design storms (50–400 mm in 24 hours, at mean and high tide) and three real ones: 1–2 December 2015 with and without the Chembarambakkam reservoir release, Cyclone Michaung (2023) and Cyclone Fengal (2024).

**Held-out testing.** We split the GCC wards in half, used one half for any tuning and report only on the other half.

**AWS does the live work.**
- Amazon EventBridge Scheduler runs an AWS Lambda every 3 hours. It reads the Open-Meteo forecast for four Chennai points, picks the two nearest precomputed storms, and writes `current.json` to Amazon S3.
- When a subscribed street's risk band changes, Amazon Bedrock turns the model's numbers into two plain sentences and Amazon SNS emails them. A filter policy makes sure each email reaches only the people who follow that street. Subscribers live in Amazon DynamoDB.
- The *Ask HighGround* assistant is built with the **Strands Agents SDK** (AWS open source) on Bedrock. Its only knowledge is six tools that read model outputs. After it answers, we check every number in the reply against the tool outputs, and the UI marks each one "from the model".
- Address search uses Amazon Location Service, biased to Chennai.
- The site is on AWS Amplify Hosting; tiles and model outputs are on S3 behind Amazon CloudFront. The whole stack is one AWS SAM template.

**The browser only blends pictures.** MapLibre GL draws a dark 3D city. A three.js layer drapes one water mesh over the terrain and drives it with precomputed hourly depth textures. Scrubbing the night, dragging the what-if rainfall slider or replaying a cyclone just blends two textures, at around 60 fps on an integrated laptop GPU. Routing that avoids water is A* in the browser over a 206,000-edge road graph.

## Does it work? An honest answer

We tested the model against the 3,200 street segments that residents reported flooded in December 2015 on wards we never tuned on (7,894 reported segments citywide). The fair question is a ranking one: pick a street residents reported flooded and one they did not, and see whether the model says the reported one gets deeper water.

- **The model: 53%** of the time (95% range 51%–55%, resampling whole wards). Chance is 50%.
- Elevation alone: 47%. Plain distance to the nearest canal or river: **56%**, better than our model.
- On streets near the Adyar and Cooum, the 2015 Chembarambakkam release lifts the model from 51% to 53%.
- Against the satellite (NRSC) flood extent, the model covers 33%. A random map of the same size covers 31%; the lowest ground covers 21%.
- On GCC's own 2015 flood hotspots, the model scores 52% against random road points.

So at street level the 2015 reports put the model only slightly above chance. The reports mark where people reported, not every street that flooded. And 30 m satellite terrain cannot see the kerbs, culverts and drains that decide which street floods. We say this on the Proof screen in the same type size as the result.

A second hydraulic model, ANUGA from Geoscience Australia, run on a triangular mesh over Velachery and Pallikaranai, agrees with ours on 73% of the cells where either model puts 15 cm or more (the critical success index; counting cells both leave dry would inflate it to 94%). That checks the arithmetic, not the terrain.

## What fought back

1. **Satellite elevation is full of fake lakes.** Our first runs flooded scattered pits everywhere. Closed hollows in the 30 m data could hold 124 million m³ of water, about 70% of a whole 200 mm storm. We capped artificial hollows at 1 m, carved drains at realistic depths (a street drain is not the Adyar), and opened the edges of the model box so valleys could drain out.
2. **Our channels leaked before the rain started.** We had filled every river to its "spill level" at the start, and in some reaches that sat above the measured water surface. About 2% of the city was flooded at 6 PM in every scenario, before any rain. We caught it while picking demo streets, fixed it, and reran everything.
3. **Our first validation metric was wrong, and a reviewer caught it.** We first scored the model by the share of reported streets it floods, compared with an elevation map flooding the same area. The model "won" 39% to 26%. An independent review then showed that a random speckle of the same size scores 64% on that metric. It rewards patchy maps, not correct ones. Worse, calibrating drain capacity on it pushed the drains to zero and overstated every storm. We withdrew it, switched to the ranking test above, and now call drain capacity (10 mm/h) an assumption, because the reports cannot tell 0 from 30 mm/h apart.
4. **A 2-core laptop, and a timestep that was slightly too bold.** The first solver needed 35 minutes per storm. Vectorised float32 kernels and a Halley-iteration cube root brought it to about 11. The same review then found water sloshing in flat ponds: at our timestep, peak depths were inflated by up to 1.6 m. A halving test showed a CFL number of 0.5 matches a four-times-smaller step to 0.1 cm, so that is what ships, at about 15 minutes per storm.
5. **The model's edges leaked.** About a third of the 2015 reservoir release drained straight out of the model's west edge. At high tide, sea water also ran through Ennore and out of the north edge. Both are fixed, and the release now visibly helps on river-side streets.
6. **The honest answer is sometimes "your street stays dry".** At street level, flooding is patchy. The card now also says how many streets within 500 m pass 15 cm.

## Limits

30 m terrain; drains are one uniform capacity; the reservoir release is modelled from the CAG audit timeline; no storm surge; rain is uniform across the city. This is not an official warning: follow GCC and IMD advisories, and in danger call 112.
