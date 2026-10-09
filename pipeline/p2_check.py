"""P2 sanity check: share of land >= 15 cm around named places in the 200 mm run.
Velachery and Pallikaranai should be wet; T. Nagar mostly dry. -> data/out/p2_places.json"""
from __future__ import annotations

import json
import sys

import numpy as np
from pyproj import Transformer

from common import CFG, CRS, OUT, WORK, grid_spec, write_json

PLACES = {"velachery": (12.9791, 80.2209, 1200), "pallikaranai": (12.9395, 80.2125, 1500),
          "tnagar": (13.0418, 80.2341, 1000)}


def shares(run="design_200_mean"):
    transform, W, H = grid_spec()
    hmax = np.load(OUT / "runs" / run / "hmax.npy")
    sea = np.load(WORK / "sea.npy")
    burn = np.load(WORK / "waterway.npy")
    tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    yy, xx = np.mgrid[0:H, 0:W]
    X = transform.c + (xx + 0.5) * transform.a
    Y = transform.f + (yy + 0.5) * transform.e
    out = {}
    for k, (lat, lon, r) in PLACES.items():
        x, y = tr.transform(lon, lat)
        m = ((X - x) ** 2 + (Y - y) ** 2 <= r * r) & ~sea & ~burn
        out[f"{k}_wet_share"] = float((hmax[m] >= CFG["validation"]["hit_depth_m"]).mean())
        out[f"{k}_median_depth_cm"] = float(np.median(hmax[m]) * 100)
    return out


if __name__ == "__main__":
    run = sys.argv[1] if len(sys.argv) > 1 else "design_200_mean"
    res = shares(run)
    res["run"] = run
    write_json(OUT / "p2_places.json", res, indent=1)
    print(json.dumps(res, indent=1))
