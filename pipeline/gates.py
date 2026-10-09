"""Scripted phase gates. Usage: python gates.py p1|p2|p3|p4|p5  (exit 1 on failure)."""
from __future__ import annotations

import json
import sys

import numpy as np

from common import OUT, REVIEW, WORK


def check(name, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")
    return bool(ok)


def p1():
    s = json.loads((WORK / "p1_stats.json").read_text())
    r = [
        check("land elevations plausible (~0-60 m)", s["dtm_min"] > -2 and s["dtm_max"] < 70
              and s["dtm_p1"] >= 0 and s["dtm_p99"] <= 60,
              f"min {s['dtm_min']:.1f} p1 {s['dtm_p1']:.1f} p99 {s['dtm_p99']:.1f} max {s['dtm_max']:.1f}"),
        check("rivers carved below banks", s["river_minus_bank_m"] < -1.0, f"{s['river_minus_bank_m']:.2f} m"),
        check("buildings removed from DTM", s["dsm_minus_dtm_on_buildings"] > 1.0
              and s["dsm_minus_dtm_on_buildings"] > 2 * s["dsm_minus_dtm_on_open"],
              f"DSM-DTM on buildings {s['dsm_minus_dtm_on_buildings']:.2f} m vs open {s['dsm_minus_dtm_on_open']:.2f} m"),
        check("hillshade saved", (REVIEW / "p1" / "hillshade_dsm_vs_dtm.png").exists()),
        check("KML inspected", (WORK / "kml_inspection.json").exists()),
    ]
    return all(r)


def p2():
    runs = json.loads((OUT / "runs.json").read_text())
    ok = True
    for rid, info in runs.items():
        ok &= check(f"mass balance {rid}", abs(info["mass_error_pct"]) <= 2.0, f"{info['mass_error_pct']:.3f}%")
    t = json.loads((OUT / "p2_places.json").read_text())
    ok &= check("Velachery wet at 200 mm", t["velachery_wet_share"] >= 0.25, f"{t['velachery_wet_share']:.2f}")
    ok &= check("Pallikaranai wet at 200 mm", t["pallikaranai_wet_share"] >= 0.25, f"{t['pallikaranai_wet_share']:.2f}")
    ok &= check("T. Nagar mostly dry at 200 mm", t["tnagar_wet_share"] < 0.5, f"{t['tnagar_wet_share']:.2f}")
    ok &= check("Velachery wetter than T. Nagar", t["velachery_wet_share"] > t["tnagar_wet_share"])
    for rid in runs:
        ok &= check(f"depth map {rid}", (REVIEW / "p2" / f"maxdepth_{rid}.png").exists())
    return ok


def p3():
    p = json.loads((OUT / "proof.json").read_text())
    v = p["headline"]
    ok = check("model beats elevation baseline on hit rate (validation half)",
               v["model_hit_rate"] > v["baseline_hit_rate"],
               f"model {v['model_hit_rate']:.3f} vs lowest-20% baseline {v['baseline_hit_rate']:.3f}")
    ok &= check("model beats matched-share elevation baseline (validation half)",
                v["model_hit_rate"] > v["matched_baseline_hit_rate"],
                f"model {v['model_hit_rate']:.3f} vs matched {v['matched_baseline_hit_rate']:.3f}")
    ok &= check("rain vs river split reported", {"rain_driven", "river_driven"} <= set(p["by_group"]["rain_only"]))
    ok &= check("both runs reported", {"rain_only", "rain_plus_reservoir"} <= set(p["by_group"]))
    return ok


if __name__ == "__main__":
    phase = sys.argv[1]
    sys.exit(0 if globals()[phase]() else 1)
