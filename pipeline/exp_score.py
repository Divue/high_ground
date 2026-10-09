"""Score experiment runs on the CALIBRATION half only (odd wards) + place shares + test addresses."""
import importlib
import sys

import numpy as np
from pyproj import Transformer

import scoring
from common import CRS, OUT, WORK, grid_spec

p2 = importlib.import_module("p2_check")
ADDR = {"Velachery stn": (80.21951, 12.96762), "T. Nagar": (80.23006, 13.03448), "Saidapet": (80.2230, 13.0220),
        "Pallikaranai": (80.2125, 12.9395), "Mylapore": (80.2676, 13.0339)}


def main(runs):
    d = scoring.prepare()
    T, W, H = grid_spec()
    tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    water = (np.load(WORK / "landcover.npy") == 4) | np.load(WORK / "waterway.npy")
    for r in runs:
        h = np.load(OUT / "runs" / r / "hmax.npy")
        h = np.where(water, 0, h)
        g = scoring.gain_over_matched_baseline(h >= 0.15, d, scoring.odd)
        sh = p2.shares(r)
        near = []
        for name, (lon, lat) in ADDR.items():
            x, y = tr.transform(lon, lat)
            c, rr = ~T * (x, y)
            win = h[int(rr) - 5:int(rr) + 6, int(c) - 5:int(c) + 6]   # 330 m window
            near.append(f"{name} {np.mean(win >= 0.15) * 100:.0f}%")
        print(f"{r:24s} gain {g['gain']:.3f} hit {g['hit_rate']:.3f} matched {g['matched_baseline_hit_rate']:.3f} "
              f"flooded {g['flooded_share']:.3f} | vel {sh['velachery_wet_share']:.2f} pall {sh['pallikaranai_wet_share']:.2f} "
              f"tn {sh['tnagar_wet_share']:.2f} | " + ", ".join(near))


if __name__ == "__main__":
    main(sys.argv[1:])
