"""Silent 2:48 edit of the demo video, cut to docs/VIDEO_SCRIPT.md, with the script as subtitles.

    python docs/make_demo_cut.py [landing_base_url]     # default http://127.0.0.1:4175/

Inputs: the frame-perfect shots in review/p5/footage/*.mp4 (web/tests/record_frames.mjs), the real-time
offline recording review/p5/footage/offline_rt/ (web/tests/record_offline.mjs, with beats.json), and two
landing-page stills captured here. Outputs in review/p5/footage/: HighGround_demo_cut.mp4 (clean),
HighGround_demo_cut_captioned.mp4 and HighGround_demo_cut.srt.
"""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOOT = ROOT / "review" / "p5" / "footage"
TMP = FOOT / "demo_parts"
FPS = 30
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4175/"

spec = importlib.util.spec_from_file_location("rough", ROOT / "docs" / "make_rough_cut.py")
rough = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rough)

SLATES = {
    "slot_email": "<div class='slot'><h1>Slot: the real alert email</h1><p>Live site → Email me if this changes (confirm the AWS email) → #admin → Run and send alerts (300 mm). Film the email arriving. 10 seconds.</p></div>",
    "slot_aws": "<div class='slot'><h1>Slot: AWS console</h1><p>One second each: EventBridge schedule, a Lambda, a DynamoDB item, the SNS topic, the Amplify app.</p></div>",
}

# the script, section by section: (seconds, voice-over)
SCRIPT = [
    (12, "Every monsoon, Chennai parks its cars on flyovers, because nobody tells residents where the water will go. A flood forecast says a storm is coming. HighGround tells you what to do on your street."),
    (18, "We simulate the flood itself: the physics of where rain flows, across all of Chennai, 1.2 million points, sixteen storms, including the real 2015 floods and Cyclone Michaung. You watch it rise, hour by hour, on a 3D city."),
    (23, "This is HighGround, live on AWS. I'm replaying Cyclone Michaung as if it were tonight, and searching my street. Arumugam Road: waist-deep, 106 centimetres, too deep for scooters from 2 AM. And a decision: move your car to the Velachery MRTS Bridge, 350 metres away, by 1 AM."),
    (20, "Take me there plans a route around the water, by car, two-wheeler or on foot, checking each street at the hour you'd reach it, with subways closed in rain. Directions follow my GPS."),
    (10, "Every three hours, AWS checks the rain forecast. If my street's risk changes, I get an email."),
    (30, "In 2023, 30% of Chennai's mobile towers went down. So I save my street before the storm. With no network, HighGround still opens, says how old its forecast is, and still plans a way out. Help is one tap away: 112, the Corporation, and the power line for fallen wires. And my flood plan is one image I can send to my family."),
    (20, "Dial up the storm. At 300 millimetres, a quarter of the city is too deep for scooters, and 15 of 46 major hospitals can't be reached by car."),
    (20, "Did it get 2015 right? On wards we never tuned on, it picks the flooded street 53% of the time; a coin toss gets 50%. Slightly better than chance, and we show it. A second, independent model agrees on 73% of the flooded area."),
    (15, "Built on AWS: open data from the AWS registry, Lambda and EventBridge for the forecast, DynamoDB and SNS for alerts, Amazon Location for search, and Amplify hosting. Not an official warning; in danger, call 112. HighGround: know your ground."),
]


def stills():
    """Two landing-page frames: the proof chart and the close."""
    js = ("const { chromium } = require('@playwright/test');(async () => { const b = await chromium.launch({ args: ['--use-angle=gl-egl'] });"
          "const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });"
          f"await p.goto('{BASE}'); await p.waitForTimeout(4000);"
          "await p.evaluate(() => document.getElementById('lp-proof').scrollIntoView()); await p.waitForTimeout(1200);"
          f"await p.screenshot({{ path: '{TMP}/landing_proof.png' }});"
          "await p.evaluate(() => document.querySelector('.lp-final').scrollIntoView({ block: 'center' })); await p.waitForTimeout(1200);"
          f"await p.screenshot({{ path: '{TMP}/landing_close.png' }}); await b.close(); }})()")
    subprocess.run(["node", "-e", js], cwd=ROOT / "web", check=True)


def enc(name, args):
    out = TMP / f"{name}.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args, "-r", str(FPS), "-c:v", "libopenh264", "-b:v", "10M",
                    "-pix_fmt", "yuv420p", "-an", str(out)], check=True)
    return out


FIT = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x050D12,setsar=1"


def clip(name, src, start, dur, speed=1.0, hold=0.0):
    vf = f"{FIT},setpts=PTS/{speed},fps={FPS}" + (f",tpad=stop_mode=clone:stop_duration={hold}" if hold else "")
    return enc(name, ["-ss", str(start), "-t", str(dur * speed), "-i", str(src), "-vf", vf])


def still(name, src, dur, zoom=True):
    z = f",zoompan=z='min(zoom+0.0005,1.04)':d={int(dur * FPS)}:s=1920x1080:fps={FPS}" if zoom else ""
    return enc(name, ["-loop", "1", "-i", str(src), "-t", str(dur), "-vf", f"{FIT}{z}"])


def main():
    TMP.mkdir(parents=True, exist_ok=True)
    rough.SLATES.clear(); rough.SLATES.update(SLATES)
    rough.TMP = TMP
    rough.slates()
    stills()
    off = json.loads((FOOT / "offline_rt" / "beats.json").read_text())
    ov = off["video"]
    # the recording starts a few seconds after the beat clock: line them up on the last beat
    vdur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", ov],
                                capture_output=True, text=True).stdout.strip())
    shift = off["beats"][-1]["s"] - vdur
    b = {x["name"]: x["s"] - shift for x in off["beats"]}
    parts = [
        clip("01_landing_hook", FOOT / "landing.mp4", 0, 11.5) ,
        clip("02_landing_water", FOOT / "landing.mp4", 11.5, 8.5),
        clip("03_timelapse", FOOT / "timelapse.mp4", 2, 9.5, speed=2.0),
        clip("04_search", FOOT / "search.mp4", 0, 15.5, hold=7.5),
        clip("05_navigate", FOOT / "navigate.mp4", 1.5, 20),
        still("06_slot_email", TMP / "slot_email.png", 10, zoom=False),
        # offline: save → saved → offline card → route → preview → help → plan (30 s)
        clip("07a_save", ov, b["save_click"] - 0.6, 3.6),
        clip("07b_saved", ov, b["saved"] - 0.4, 2.4),
        clip("07c_offline", ov, b["offline_card"] - 0.2, 4.6),
        clip("07d_route", ov, b["offline_route"] - 0.4, 4.6),
        clip("07e_preview", ov, b["preview"] + 0.3, 4.2),
        clip("07f_help", ov, b["help"] + 0.2, 4.0),
        clip("07g_plan", ov, b["plan"] + 0.2, 4.6, hold=2.0),
        clip("08_whatif", FOOT / "whatif.mp4", 0, 8),
        clip("09_hospitals", FOOT / "hospitals.mp4", 0, 8, hold=4),
        clip("10_proof", FOOT / "proof.mp4", 0, 10),
        still("11_landing_proof", TMP / "landing_proof.png", 10),
        still("12_architecture", ROOT / "docs" / "architecture.png", 6),
        still("13_slot_aws", TMP / "slot_aws.png", 4, zoom=False),
        still("14_landing_close", TMP / "landing_close.png", 5),
    ]
    (TMP / "list.txt").write_text("".join(f"file '{p}'\n" for p in parts))
    clean = FOOT / "HighGround_demo_cut.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(TMP / "list.txt"), "-c", "copy", str(clean)], check=True)
    # subtitles: each section's words spread over its time, two lines at most per caption
    srt, t, n = [], 0.0, 1
    fmt = lambda s: f"{int(s // 3600):02d}:{int(s % 3600 // 60):02d}:{int(s % 60):02d},{int(round(s % 1 * 1000)):03d}"
    for sec, text in SCRIPT:
        words = text.split()
        chunks, cur = [], []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 70 or w.endswith((".", "?", ":", ";")) and len(" ".join(cur)) > 30:
                chunks.append(" ".join(cur)); cur = []
        if cur:
            chunks.append(" ".join(cur))
        total = sum(len(c) for c in chunks)
        s0 = t
        for c in chunks:
            d = sec * len(c) / total
            srt.append(f"{n}\n{fmt(s0)} --> {fmt(s0 + d - 0.05)}\n{c}\n")
            n += 1; s0 += d
        t += sec
    srt_path = FOOT / "HighGround_demo_cut.srt"
    srt_path.write_text("\n".join(srt))
    style = "FontName=Liberation Sans,FontSize=13,PrimaryColour=&H00F2EEE9,OutlineColour=&H80050D12,BorderStyle=3,Outline=6,Shadow=0,MarginV=24"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(clean), "-vf", f"subtitles={srt_path}:force_style='{style}'",
                    "-c:v", "libopenh264", "-b:v", "10M", "-pix_fmt", "yuv420p", "-an", str(FOOT / "HighGround_demo_cut_captioned.mp4")], check=True)
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(clean)],
                         capture_output=True, text=True).stdout.strip()
    print(f"wrote {clean} ({float(dur):.1f} s, script {t:.0f} s)")


if __name__ == "__main__":
    main()
