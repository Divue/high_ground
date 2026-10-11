# Demo video: rough cut and cut list

`review/p5/footage/rough_cut.mp4`: 2:30, 1920×1080, 30 fps, no audio. Built by `docs/make_rough_cut.py` from the frame-perfect recordings in `review/p5/footage/` (each also kept as a full-length `.mp4` and PNG frames).

Two slots need the deployed AWS stack: the real alert email and the assistant. Record them on the live site and drop them in; everything else is final footage. Replace the first title card with a photo of cars on the Velachery flyover if you have one (with credit).

| Starts | Shot | Length | Voice-over / note |
|---|---|---|---|
| 0:00 | hook1 | 6 s | Every monsoon, Chennai parks its cars on flyovers… (replace with a photo of cars on the Velachery flyover) |
| 0:06 | hook2 | 5 s | …because nobody tells residents where the water will go. HighGround does. |
| 0:11 | opening.mp4 | 18 s | Cyclone Michaung, replayed as if it were tonight: the water rises street by street, from precomputed model runs on AWS (S3 + CloudFront). |
| 0:29 | search.mp4 | 14 s | Type your street (Amazon Location Service). The card: how deep, when it gets too deep for scooters, and when to move your car. |
| 0:43 | navigate.mp4 | 18 s | Take me there: a route that avoids streets the model expects to flood, with directions. It works offline. |
| 1:01 | slot_email | 10 s | SLOT: the real alert email (EventBridge → Lambda → Bedrock → SNS). |
| 1:11 | offline | 7 s | When the power goes, the towers go. Saved before the storm, HighGround keeps working. |
| 1:18 | review/p5-dev/offline/02_offline_card.png | 3 s | Offline: the battery-saver map, streets coloured by depth. |
| 1:21 | review/p5-dev/offline/06_go_offline.png | 3 s | Offline: still plans a way out of the water. |
| 1:24 | review/p5-dev/offline/03_plan.png | 3 s | My flood plan: an image to send to family, no app needed. |
| 1:27 | whatif.mp4 | 8 s | What if 400 mm fell tonight? |
| 1:35 | docs/landing-assets/04_hospitals.png | 4 s | At 300 mm, 15 of 46 major hospitals can't be reached by car. |
| 1:39 | timelapse.mp4 | 14 s | The Dec 2015 floods, hour by hour, with the Chembarambakkam release. |
| 1:53 | proof.mp4 | 10 s | Did it get 2015 right? On wards we never tuned on: 53% against a coin toss's 50%. Slightly better than chance, and we show it. |
| 2:03 | slot_assistant | 10 s | SLOT: Ask HighGround (Strands Agents on Bedrock) answering with grounded numbers. |
| 2:13 | docs/architecture.png | 10 s | Built on AWS: S3, CloudFront, Amplify, Lambda, API Gateway, DynamoDB, SNS, EventBridge Scheduler, Bedrock, Strands Agents, Amazon Location, SAM, AWS Open Data. |
| 2:23 | close | 7 s | Not an official warning. Follow GCC and IMD advisories. In danger, call 112. |

Rules for the voice-over (from docs/HIGHGROUND_AUDIT.md section 7): say "slightly better than chance" with the 53%; never "safe route", "accurate" or "official"; name each AWS service as it appears.
