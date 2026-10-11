# HighGround demo video: final script (2:48)

Rules (event page): **under 3:00**, uploaded to YouTube as public or unlisted (check the link in a signed-out browser), and **judges score only what the video shows**. Every line below is backed by a shot of the working product; claim nothing that is not on screen.

Silent edit with this script as subtitles: `review/p5/footage/HighGround_demo_cut.mp4` (clean) and `HighGround_demo_cut_captioned.mp4`, plus `HighGround_demo_cut.srt`. Built by `docs/make_demo_cut.py`. Add the voice-over and motion graphics on top; the two **SLOT** cards are the only shots you still have to film.

| Time | On screen | Voice-over |
|---|---|---|
| 0:00–0:12 | **Landing page** hero, then "Flood warnings tell you a storm is coming. Not what to do on your street." (add a photo of cars on the Velachery flyover if you have one, credited) | "Every monsoon, Chennai parks its cars on flyovers, because nobody tells residents where the water will go. A flood forecast says a storm is coming. HighGround tells you what to do on your street." |
| 0:12–0:30 | Landing page 3D Velachery floods as you scroll; then the **Dec 2015 time-lapse** (2× speed), the whole city filling hour by hour | "We simulate the flood itself: the physics of where rain flows, across all of Chennai, 1.2 million points, sixteen storms, including the real 2015 floods and Cyclone Michaung. You watch it rise, hour by hour, on a 3D city." |
| 0:30–0:53 | **Search**: type Arumugam Road, the camera flies there, the water rises to 106 cm; the card with the decision | "This is HighGround, live on AWS. I'm replaying Cyclone Michaung as if it were tonight, and searching my street. Arumugam Road: waist-deep, 106 centimetres, too deep for scooters from 2 AM. And a decision: move your car to the Velachery MRTS Bridge, 350 metres away, by 1 AM." |
| 0:53–1:13 | **Take me to dry ground**: route around the water, directions, Preview the drive with the live instruction banner | "Take me there plans a route around the water, by car, two-wheeler or on foot, checking each street at the hour you'd reach it, with subways closed in rain. Directions follow my GPS." |
| 1:13–1:23 | **SLOT: the real alert email** arriving (live site → Email me if this changes, confirm; `#admin` → Run and send alerts, 300 mm; film the inbox) | "Every three hours, AWS checks the rain forecast. If my street's risk changes, I get an email." |
| 1:23–1:53 | **Offline**: Save for offline → network off → the app still opens ("Offline · forecast from …"), battery-saver map, a route out of the water, Help numbers, My flood plan image | "In 2023, 30% of Chennai's mobile towers went down. So I save my street before the storm. With no network, HighGround still opens, says how old its forecast is, and still plans a way out. Help is one tap away: 112, the Corporation, and the power line for fallen wires. And my flood plan is one image I can send to my family." |
| 1:53–2:13 | **What if** slider to 400 mm; **Hospitals** at 300 mm | "Dial up the storm. At 300 millimetres, a quarter of the city is too deep for scooters, and 15 of 46 major hospitals can't be reached by car." |
| 2:13–2:33 | **Proof** swipe (model vs streets residents reported); landing page proof chart | "Did it get 2015 right? On wards we never tuned on, it picks the flooded street 53% of the time; a coin toss gets 50%. Slightly better than chance, and we show it. A second, independent model agrees on 73% of the flooded area." |
| 2:33–2:48 | Architecture diagram; **SLOT: 1-second AWS console cuts** (EventBridge schedule, a Lambda, a DynamoDB item, the SNS topic, Amplify app); landing page close "Know your ground." | "Built on AWS: open data from the AWS registry, Lambda and EventBridge for the forecast, DynamoDB and SNS for alerts, Amazon Location for search, and Amplify hosting. Not an official warning; in danger, call 112. HighGround: know your ground." |

## Do and don't

- **Do** keep the live Amplify address visible once (browser bar) when you film the email and the console.
- **Do** say "we simulate the flood and show it in 3D" (the physics is a 2D shallow-water model shown on a 3D city).
- **Don't** mention an offline assistant, relief-centre contacts, CloudFront, or Bedrock answers: none of them can be shown working today (the assistant returns an error on the current deployment).
- **Don't** say "safe route", "dry route", "accurate", "official", or "the only street-level forecast". Say "a route that avoids flooded streets".
- **Architecture slide:** `docs/architecture.png` still shows CloudFront and the Bedrock assistant; the current deployment has neither working. Redraw it in the motion graphics with what runs: Amplify Hosting, API Gateway + Lambda, EventBridge Scheduler, DynamoDB, SNS, S3, Amazon Location, AWS Open Data.
- **Facts on screen** (sources for the motion graphics): 712 of 1,814 power feeders off on 4 Dec 2023 (The News Minute); 30% of 42,747 towers down on 5 Dec 2023 (The Week / PTI).

## Why it is different (if a line is needed)

A flood forecast tells you a storm is coming. HighGround simulates where the water goes on every street, turns it into a decision (where to move your car, by when, which way avoids the water, which hospitals you can still reach), keeps working when the network does not, and shows honestly how well it did on 2015.
