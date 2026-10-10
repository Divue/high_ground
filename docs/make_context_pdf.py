"""Build docs/HighGround_landing_context.pdf: LANDING_PAGE_CONTEXT.md plus the screenshots, one shareable file.

    python docs/make_context_pdf.py            # writes docs/_context.html, then prints it to PDF with Playwright
    python docs/make_context_pdf.py docs/OFFLINE_AND_NAVIGATION_PLAN.md docs/HighGround_offline_navigation_plan.pdf
                                               # any other Markdown doc, text only
"""
import sys
import base64
import re
import io
import subprocess
from pathlib import Path

import markdown
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
ASSETS = [
    ("01_hero_street.png", "The hero: a Velachery street during Cyclone Michaung"),
    ("07_opening_title.png", "The opening title over the city"),
    ("06_search_flight.png", "Mid-flight to a searched street"),
    ("08_street_3d_rain.png", "Street-level 3D view with rain"),
    ("02_whatif_city.png", "What if at 200 mm: the city as a flood map"),
    ("05_timelapse_2015_peak.png", "Watch the whole storm: Dec 2015"),
    ("03_proof.png", "Proof: did the model get 2015 right?"),
    ("04_hospitals.png", "Hospitals cut off at 300 mm"),
    ("10_architecture.png", "Architecture: every AWS service"),
]
CSS = """
@page { size: A4; margin: 16mm 14mm; }
body { font-family: 'DejaVu Sans', Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #111; }
h1 { font-size: 20pt; margin: 0 0 6pt; } h2 { font-size: 13.5pt; margin: 16pt 0 6pt; border-bottom: 1px solid #ccc; padding-bottom: 3pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 9pt; }
th, td { border: 1px solid #ccc; padding: 3pt 5pt; vertical-align: top; text-align: left; } th { background: #f0f3f4; }
code { background: #f2f2f2; padding: 0 2pt; font-size: 9pt; }
pre { background: #f6f7f8; padding: 6pt; font-size: 6.1pt; line-height: 1.3; white-space: pre; overflow: hidden; border: 1px solid #ddd; }
pre code { background: none; padding: 0; font-size: inherit; }
figure { margin: 0 0 10pt; page-break-inside: avoid; } figure img { width: 100%; border: 1px solid #ccc; }
figcaption { font-size: 9pt; color: #444; margin-top: 2pt; } .shots h2 { page-break-before: always; }
"""


def loosen_lists(text):
    """Python-Markdown needs a blank line before a list that follows a paragraph (GitHub does not)."""
    out, fenced = [], False
    item = re.compile(r"^\s*([-*]|\d+\.)\s")
    for line in text.splitlines():
        if line.startswith("```"):
            fenced = not fenced
        if not fenced and item.match(line) and out and out[-1].strip() and not item.match(out[-1]) \
                and not out[-1].startswith(("|", "  ")):
            out.append("")
        out.append(line)
    return "\n".join(out)


def main():
    md = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DOCS / "LANDING_PAGE_CONTEXT.md"
    out = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else DOCS / "HighGround_landing_context.pdf"
    body = markdown.markdown(loosen_lists(md.read_text()), extensions=["tables", "fenced_code"])
    figs = []
    for f, cap in (ASSETS if len(sys.argv) == 1 else []):
        im = Image.open(DOCS / "landing-assets" / f).convert("RGB")
        im.thumbnail((1400, 1400))
        b = io.BytesIO()
        im.save(b, "JPEG", quality=78)
        figs.append(f'<figure><img src="data:image/jpeg;base64,{base64.b64encode(b.getvalue()).decode()}">'
                    f"<figcaption>{cap}</figcaption></figure>")
    html = (f'<!doctype html><html><head><meta charset="utf-8"><title>HighGround context</title><style>{CSS}</style>'
            f'</head><body>{body}' + (f'<div class="shots"><h2>Screenshots (full-size files are in docs/landing-assets/)</h2>'
            f'{"".join(figs)}</div>' if figs else '') + '</body></html>')
    src = DOCS / "_context.html"
    src.write_text(html)
    js = (f"const {{ chromium }} = require('@playwright/test');(async () => {{ const b = await chromium.launch({{ channel: 'chromium' }});"
          f"const p = await b.newPage(); await p.goto('file://{src}'); await p.waitForTimeout(500);"
          f"await p.pdf({{ path: '{out}', format: 'A4', printBackground: true, margin: {{ top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' }} }});"
          f"await b.close(); }})()")
    subprocess.run(["node", "-e", js], cwd=ROOT / "web", check=True)
    src.unlink()
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
