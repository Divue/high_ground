"""Write docs/DEMO.md for the video team. Every number is read from model outputs."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "data" / "out" / "web"
OUT = ROOT / "data" / "out"


def pct(x):
    return f"{round(x * 100)}%"


def flooded_streets(run, lon0, lat0, radius=2500, min_cm=30, n=8):
    idx = json.loads((WEB / "streets" / "index.json").read_text())
    rows = []
    for t, (w, s, e, nn) in idx["tile_bounds_lonlat"].items():
        if not (w - 0.03 < lon0 < e + 0.03 and s - 0.03 < lat0 < nn + 0.03):
            continue
        g = json.loads((WEB / "streets" / "geom" / f"{t}.json").read_text())["segs"]
        v = json.loads((WEB / "streets" / run / f"{t}.json").read_text())
        for i, (sid, name, hw, br, flat) in enumerate(g):
            if not name or hw == "service" or br:
                continue
            k = len(flat) // 4 * 2
            d = math.hypot((flat[k] - lon0) * 108_500, (flat[k + 1] - lat0) * 110_500)
            if d < radius and v["max"][i] >= min_cm and v["t15"][i] > 0.5:
                rows.append((v["max"][i], name, v["t15"][i], round(d)))
    rows.sort(reverse=True)
    seen, out = set(), []
    for r in rows:
        if r[1] not in seen:
            seen.add(r[1])
            out.append(r)
    return out[:n]


def main():
    proof = json.loads((WEB / "proof.json").read_text())
    h = proof["headline"]
    g = proof["by_group"]
    an = proof.get("anuga") or {}
    vel = flooded_streets("michaung2023", 80.2195, 12.9760)
    deploy = OUT.parent / "deploy_outputs.json"
    site = json.loads(deploy.read_text())["site"] if deploy.exists() else "(live URL after infra/deploy.sh)"
    lines = [
        "# Demo guide (generated from model outputs, do not edit numbers by hand)",
        "",
        f"Live app: {site}",
        "",
        "## Velachery streets that flood in the Cyclone Michaung replay (pick one for the video)",
        "",
        "| Street | Peak depth (cm) | Reaches 15 cm after (h from 6 PM) | Distance from Velachery station |",
        "|---|---|---|---|",
    ]
    lines += [f"| {n} | {cm} | {t:.0f} | {d} m |" for cm, n, t, d in vel]
    lines += [
        "",
        "Type the street name in the search box with **Replay Michaung 2023** selected (or open the app with `?replay=michaung2023`).",
        "",
        "## Script beats with the numbers to say",
        "",
        "- **0:15–1:15 Tonight:** the load flight from the Bay of Bengal, Michaung replay, street search, depth and time, dry parking, the amber route, then *Email me if this changes*. Show the real SNS email arriving (trigger it from `#admin` → *Run and send alerts* with 300 mm).",
        "- **1:15–1:50 What if / Hospitals:** drag to 400 mm; open Hospitals at 300 mm.",
        "- **Offline + navigation (15–20 s, inside 1:15–1:50):** network off, the app still opens (*Offline*, battery-saver map), *Take me to dry ground* · Two-wheeler draws the amber route around the water with directions, *Preview the drive*, then *My flood plan* shared as an image. \"Saved before the storm. Works without internet.\"",
        "- **1:50–2:30 Proof:** say it plainly: \"We tested it on wards we never tuned on. Pick a street residents reported "
        f"flooded in 2015 and one they didn't: the model ranks the reported one deeper **{pct(proof['honest_test']['model']['auc'])}** of the time. "
        f"Chance is 50%, elevation alone {pct(proof['honest_test']['low_elevation']['auc'])}, and the distance to the nearest canal "
        f"{pct(proof['honest_test']['near_a_channel']['auc'])}. So the model is {proof['honest_test']['verdict']} at street level, and we show you that.\"",
        f"  - The Chembarambakkam release matters on river-side streets: ranking {pct(proof['auc_even_wards']['model_rain_only']['river_driven']['auc'])} without it, {pct(proof['auc_even_wards']['model']['river_driven']['auc'])} with it.",
        f"  - One sentence: \"{proof['sentence']}\"",
    ]
    if an:
        lines.append(f"  - ANUGA (Geoscience Australia) cross-check in Velachery: where either model has ≥15 cm, they agree on {pct(an['csi'])} of those cells (critical success index), depth correlation {an['depth_corr']:.2f}. Same terrain, so it checks the arithmetic, not the terrain.")
    lines += [
        "- **2:30–3:00 Architecture + limits:** `docs/architecture.png`; read two limits from *About the model*; end on the What-if slider dragged back to 50 mm (water recedes).",
        "",
        "## AWS services visible in the product (say each one)",
        "",
        "Amazon S3 + CloudFront (model outputs and tiles) · AWS Amplify Hosting (the site) · Amazon API Gateway + AWS Lambda (subscribe, forecast check, assistant, geocode) · "
        "Amazon DynamoDB (subscribers) · Amazon SNS (alert email) · Amazon EventBridge Scheduler (every 3 hours) · Amazon Bedrock (alert text and assistant) · "
        "Strands Agents SDK (AWS open source, the assistant) · Amazon Location Service (address search) · AWS SAM (infrastructure) · AWS Open Data (Copernicus DEM, ESA WorldCover).",
        "",
        "## Raw footage",
        "",
        "**Smooth footage (use this for the video):** `cd web && WARM=1 node tests/record_frames.mjs <shot> <url>` with shot = opening | search | timelapse | whatif | proof. "
        "It drives the app with a virtual clock and waits for every tile before each frame, so the footage is a steady 30 fps at 1920×1080 even on a slow laptop "
        "(about 30 s of wall time per second of footage). Output: `review/p5/footage/<shot>.mp4` (H.264) plus the PNG frames as a lossless master.",
        "",
        "`node web/tests/record_demo.mjs <url> review/p5/video` records a real-time WebM walkthrough (it stutters on slow machines).",
    ]
    (ROOT / "docs" / "DEMO.md").write_text("\n".join(lines) + "\n")
    print("wrote docs/DEMO.md")


if __name__ == "__main__":
    main()
