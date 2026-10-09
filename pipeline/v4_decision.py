"""Pre-registered v4 adoption test, on the TUNING half (odd GCC wards) only, 2015 replay with release.

Rule (written down before the v4 runs, PROGRESS.md, Sat 00:20):
  adopt the v4 terrain/model if, on odd wards,
    1. the ranking AUC (reported vs unreported streets) is no worse than v3 minus 0.005, and
    2. the share of model-flooded land inside GCC moderate-or-higher hazard zones is no lower than v3;
  otherwise keep v3 (with the B1/B2 post-processing fixes).

    python v4_decision.py <tag>      # evaluates data/out/runs/dec2015_reservoir with the current data/work
"""
import importlib.util
import json
import sys

import numpy as np
from rasterio.features import rasterize

import scoring
from common import CRS, OUT, RAW, WORK, grid_spec, water_mask, write_json

spec = importlib.util.spec_from_file_location("v", "06_validate.py")
val = importlib.util.module_from_spec(spec)
spec.loader.exec_module(val)


def main(tag):
    transform, W, H = grid_spec()
    data = scoring.prepare()
    sea = np.load(WORK / "sea.npy")
    burn = np.load(WORK / "waterway.npy")
    perm = (np.load(WORK / "landcover.npy") == 4) | burn
    wd = scoring.wards()
    ward_grid = rasterize([(g, w) for g, w in zip(wd.geometry, wd["ward"])], out_shape=(H, W),
                          transform=transform, fill=0, dtype="int32")
    odd_land = (ward_grid > 0) & (ward_grid % 2 == 1) & ~sea & ~perm

    d = OUT / "runs" / "dec2015_reservoir"
    peak = np.where(water_mask(d), 0.0, np.load(d / "hmax.npy"))
    auc = val.auc_reported_vs_unreported(peak, data, scoring.odd, boots=100)

    zones = scoring._read_kml(RAW / "validation" / "gcc_hazard_zones.kml").to_crs(CRS)
    zones["rank"] = zones["CATEGORY"].map(val.ZONE_RANK).fillna(0).astype(int)
    zones = zones.sort_values("rank")
    zgrid = rasterize([(g, r) for g, r in zip(zones.geometry, zones["rank"]) if g is not None],
                      out_shape=(H, W), transform=transform, fill=0, dtype="uint8")
    wet = (peak >= 0.15) & odd_land & (zgrid > 0)
    share_modplus = float((wet & (zgrid >= 3)).sum() / max(wet.sum(), 1))
    out = dict(tag=tag, run="dec2015_reservoir", wards="odd (tuning half)", auc=auc["auc"], auc_ci95=auc["ci95"],
               gcc_moderate_plus_share_of_flooded=share_modplus,
               flooded_share_of_odd_land=float(((peak >= 0.15) & odd_land).sum() / odd_land.sum()))
    write_json(OUT / f"decision_{tag}.json", out, indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "current")
