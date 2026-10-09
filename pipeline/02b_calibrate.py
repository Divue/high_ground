"""02b_calibrate: choose the storm-drain capacity (mm/h) on the CALIBRATION half only.

Runs the 1–2 Dec 2015 replay (rain + Chembarambakkam release) for each candidate
drainage capacity, scores it on odd-numbered GCC wards with skill = hit_rate -
false_rate (scoring.py), and writes data/out/calibration.json. Even-numbered wards are
never looked at here; 06_validate.py reports on them.
"""
from __future__ import annotations

import importlib
import json
import sys

import numpy as np

import scoring
from common import CFG, OUT, write_json

fm = importlib.import_module("02_fast_model")


def main(cands=None):
    cands = cands or CFG["landcover"]["drainage_mm_h_candidates"]
    data = scoring.prepare()
    rows = []
    for d in cands:
        tag = f"cal_{d:g}"
        f = OUT / "runs" / tag / "hmax.npy"
        if not f.exists():
            fm.run("dec2015_reservoir", drainage_mm_h=float(d), tag=tag, snapshots=False)
        info = json.loads((OUT / "runs" / tag / "info.json").read_text())
        wet = np.load(f) >= CFG["validation"]["hit_depth_m"]
        m = scoring.evaluate(wet, data, scoring.odd)
        rows.append(dict(drainage_mm_h=float(d), mass_error_pct=info["mass_error_pct"], **m))
        print(f"drainage {d:>5} mm/h  hit {m['hit_rate']:.3f}  false {m['false_rate']:.3f}  skill {m['skill']:.3f}")
    best = max(rows, key=lambda r: (round(r["skill"], 4), -r["drainage_mm_h"]))
    write_json(OUT / "calibration.json", dict(
        parameter="storm-drain capacity on urban cells (mm/h)",
        drainage_mm_h=best["drainage_mm_h"],
        objective="maximise hit_rate - false_rate on odd-numbered GCC wards, 1–2 Dec 2015 replay with reservoir release",
        calibration_wards="odd ward numbers (100 wards)",
        candidates=rows), indent=1)
    print("chosen drainage", best["drainage_mm_h"], "mm/h")


if __name__ == "__main__":
    main([float(x) for x in sys.argv[1:]] or None)
