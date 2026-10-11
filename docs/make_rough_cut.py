"""Rough cut of the 3-minute demo video from the recorded footage, title cards and stills.

    python docs/make_rough_cut.py      # after web/tests/record_frames.mjs has written review/p5/footage/*.mp4

Writes review/p5/footage/rough_cut.mp4 (1920x1080, 30 fps, no audio) and docs/VIDEO_CUT.md (the cut list
with timings, voice-over lines and the two slots only the deployed AWS stack can fill). Every number on a
title card is sourced in docs/OFFLINE_AND_NAVIGATION_PLAN.md or comes from proof.json via the app.
"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOOT = ROOT / "review" / "p5" / "footage"
TMP = FOOT / "cut_parts"
FONTS = ROOT / "web" / "node_modules"
FPS = 30

CSS = f"""
@font-face {{ font-family: 'Anek'; src: url('file://{FONTS}/@fontsource-variable/anek-latin/files/anek-latin-latin-wdth-normal.woff2') format('woff2'); font-weight: 100 800; font-stretch: 75% 125%; }}
@font-face {{ font-family: 'Hind'; src: url('file://{FONTS}/@fontsource/hind/files/hind-latin-400-normal.woff2') format('woff2'); font-weight: 400; }}
html, body {{ margin: 0; width: 1920px; height: 1080px; background: #050D12; color: #D6E0E4; font-family: 'Hind', sans-serif; }}
.wrap {{ position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 180px; }}
h1 {{ font-family: 'Anek'; font-weight: 640; font-size: 84px; line-height: 1.05; margin: 0 0 28px; font-variation-settings: 'wdth' 108; }}
p {{ font-size: 40px; line-height: 1.35; margin: 0 0 18px; color: #C9D4D8; }}
.dim {{ color: #8FA2AA; font-size: 30px; }}
.amber {{ color: #F2A541; }}
.red {{ color: #E5484D; font-weight: 600; }}
.slot {{ border: 3px dashed #3E5560; border-radius: 18px; padding: 60px; }}
.fact {{ font-family: 'Anek'; font-size: 54px; font-weight: 600; margin: 0 0 24px; }}
.src {{ position: absolute; bottom: 48px; left: 180px; font-size: 22px; color: #6E8088; }}
"""

SLATES = {
    "hook1": "<h1>Every monsoon, Chennai parks its cars on flyovers.</h1><p class='dim'>In Cyclone Fengal (2024) the Velachery, Pallikaranai and Medavakkam flyovers filled with parked cars.</p>"
             "<div class='src'>Deccan Herald, Cyclone Fengal, 30 Nov 2024</div>",
    "hook2": "<h1>Because nobody tells residents where the water will go.</h1><p>HighGround does: street by street, tonight, and what to do about it.</p>",
    "slot_email": "<div class='slot'><h1>Slot: the real alert email</h1><p>Admin → Run and send alerts (300 mm). The email arrives: Amazon EventBridge → Lambda → Bedrock writes two sentences → Amazon SNS.</p><p class='dim'>Needs the deployed AWS stack (infra/deploy.sh). 10 seconds.</p></div>",
    "offline": "<h1>When the power goes, the towers go.</h1>"
               "<p class='fact'>4 Dec 2023: 712 of Chennai’s 1,814 power feeders switched off.</p>"
               "<p class='fact'>5 Dec 2023: 30% of the city’s 42,747 mobile towers down.</p>"
               "<p>Saved before the storm, HighGround keeps working without internet.</p>"
               "<div class='src'>The News Minute, 4 Dec 2023 · The Week / PTI, 5 Dec 2023</div>",
    "slot_assistant": "<div class='slot'><h1>Slot: Ask HighGround</h1><p>“Will my street flood tonight?” A grounded answer from the Strands agent on Amazon Bedrock, every number marked “from the model”.</p><p class='dim'>Needs the deployed AWS stack. 10 seconds.</p></div>",
    "close": "<h1>Not an official warning.</h1><p>Follow GCC and IMD advisories. In danger, call <span class='red'>112</span>.</p>"
             "<p class='dim'>30 m satellite terrain · drains are one assumed capacity · tested on 2015: slightly better than chance at street level, and we show it.</p>"
             "<p class='dim'>HighGround · github.com/Divue/high_ground</p>",
}

# (kind, source, seconds, voice-over / note)
CUT = [
    ("slate", "hook1", 6, "Every monsoon, Chennai parks its cars on flyovers… (replace with a photo of cars on the Velachery flyover)"),
    ("slate", "hook2", 5, "…because nobody tells residents where the water will go. HighGround does."),
    ("clip", "opening.mp4", 18, "Cyclone Michaung, replayed as if it were tonight: the water rises street by street, from precomputed model runs on AWS (S3 + CloudFront)."),
    ("clip", "search.mp4", 14, "Type your street (Amazon Location Service). The card: how deep, when it gets too deep for scooters, and when to move your car."),
    ("clip", "navigate.mp4", 18, "Take me there: a route that avoids streets the model expects to flood, with directions. It works offline."),
    ("slate", "slot_email", 10, "SLOT: the real alert email (EventBridge → Lambda → Bedrock → SNS)."),
    ("slate", "offline", 7, "When the power goes, the towers go. Saved before the storm, HighGround keeps working."),
    ("still", "review/p5-dev/offline/02_offline_card.png", 3, "Offline: the battery-saver map, streets coloured by depth."),
    ("still", "review/p5-dev/offline/06_go_offline.png", 3, "Offline: still plans a way out of the water."),
    ("still", "review/p5-dev/offline/03_plan.png", 3, "My flood plan: an image to send to family, no app needed."),
    ("clip", "whatif.mp4", 8, "What if 400 mm fell tonight?"),
    ("still", "docs/landing-assets/04_hospitals.png", 4, "At 300 mm, 15 of 46 major hospitals can't be reached by car."),
    ("clip", "timelapse.mp4", 14, "The Dec 2015 floods, hour by hour, with the Chembarambakkam release."),
    ("clip", "proof.mp4", 8, "Did it get 2015 right? On wards we never tuned on: 53% against a coin toss's 50%. Slightly better than chance, and we show it."),
    ("slate", "slot_assistant", 10, "SLOT: Ask HighGround (Strands Agents on Bedrock) answering with grounded numbers."),
    ("still", "docs/architecture.png", 10, "Built on AWS: S3, CloudFront, Amplify, Lambda, API Gateway, DynamoDB, SNS, EventBridge Scheduler, Bedrock, Strands Agents, Amazon Location, SAM, AWS Open Data."),
    ("slate", "close", 7, "Not an official warning. Follow GCC and IMD advisories. In danger, call 112."),
]


def slates():
    TMP.mkdir(parents=True, exist_ok=True)
    pages = {k: f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body><div class='wrap'>{v}</div></body></html>"
             for k, v in SLATES.items()}
    for k, html in pages.items():
        (TMP / f"{k}.html").write_text(html)
    js = ("const { chromium } = require('@playwright/test');(async () => { const b = await chromium.launch();"
          "const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });"
          f"for (const k of {json.dumps(list(pages))}) {{ await p.goto('file://{TMP}/' + k + '.html'); await p.waitForTimeout(300);"
          f"await p.screenshot({{ path: '{TMP}/' + k + '.png' }}); }} await b.close(); }})()")
    subprocess.run(["node", "-e", js], cwd=ROOT / "web", check=True)


def encode(i, kind, src, sec):
    out = TMP / f"{i:02d}.mp4"
    common = ["-r", str(FPS), "-c:v", "libopenh264", "-b:v", "8M", "-pix_fmt", "yuv420p", "-an", str(out)]
    fit = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x050D12,setsar=1"
    if kind == "clip":
        path = FOOT / src
        if not path.exists():
            return None
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-t", str(sec), "-vf", f"{fit},fps={FPS}"] + common
    else:
        path = TMP / f"{src}.png" if kind == "slate" else ROOT / src
        # a slow push-in on stills so they read as footage, not a slideshow
        zoom = "" if kind == "slate" else f",zoompan=z='min(zoom+0.0006,1.05)':d={sec * FPS}:s=1920x1080:fps={FPS}"
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", str(path), "-t", str(sec), "-vf", f"{fit}{zoom}"] + common
    subprocess.run(cmd, check=True)
    return out


def main():
    slates()
    parts, rows, t = [], [], 0.0
    for i, (kind, src, sec, vo) in enumerate(CUT):
        p = encode(i, kind, src, sec)
        if not p:
            rows.append(f"| – | {src} | missing | {vo} |")
            continue
        parts.append(p)
        rows.append(f"| {int(t // 60)}:{int(t % 60):02d} | {src} | {sec} s | {vo} |")
        t += sec
    (TMP / "list.txt").write_text("".join(f"file '{p}'\n" for p in parts))
    out = FOOT / "rough_cut.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(TMP / "list.txt"), "-c", "copy", str(out)], check=True)
    (ROOT / "docs" / "VIDEO_CUT.md").write_text("\n".join([
        "# Demo video: rough cut and cut list",
        "",
        f"`review/p5/footage/rough_cut.mp4`: {int(t // 60)}:{int(t % 60):02d}, 1920×1080, 30 fps, no audio. Built by `docs/make_rough_cut.py` from the frame-perfect recordings in `review/p5/footage/` (each also kept as a full-length `.mp4` and PNG frames).",
        "",
        "Two slots need the deployed AWS stack: the real alert email and the assistant. Record them on the live site and drop them in; everything else is final footage. Replace the first title card with a photo of cars on the Velachery flyover if you have one (with credit).",
        "",
        "| Starts | Shot | Length | Voice-over / note |",
        "|---|---|---|---|",
        *rows,
        "",
        "Rules for the voice-over (from docs/HIGHGROUND_AUDIT.md section 7): say \"slightly better than chance\" with the 53%; never \"safe route\", \"accurate\" or \"official\"; name each AWS service as it appears.",
    ]) + "\n")
    print(f"wrote {out} ({t:.0f} s, {len(parts)} parts)")


if __name__ == "__main__":
    main()
