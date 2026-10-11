"""Reviewer check 1: v3 fixes and mass balance, all runs. Writes a1_fixes.json."""
import json, sys
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import OUT, WORK
R = OUT / "runs"
sea = np.load(WORK / "sea.npy"); burn = np.load(WORK / "waterway.npy"); lc = np.load(WORK / "landcover.npy")
edge = np.load(WORK / "outlet_edge.npy")
perm = (lc == 4) | burn
land = ~sea & ~edge
landx = land & ~perm          # land that can 'flood' (not lakes / channels)
res = {}
for d in sorted(R.iterdir()):
    info = json.loads((d / "info.json").read_text())
    v = info["volume_m3"]
    hmax = np.load(d / "hmax.npy"); hs = np.load(d / "h_start.npy")
    snaps = np.load(d / "snapshots_cm.npy", mmap_mode="r")
    smax = np.asarray(snaps).max(axis=0).astype(np.float32) / 100
    ex = hmax - smax
    rain_in = v["rain"] + v["reservoir"]
    stored = v["final"] - v["initial"]
    r = dict(
        rain_Mm3=round(v["rain"]/1e6, 2), reservoir_Mm3=round(v["reservoir"]/1e6, 2),
        storage_change_pct=round(100*stored/rain_in, 1), out_sea_pct=round(100*v["outflow_sea"]/rain_in, 1),
        out_land_edges_pct=round(100*v["outflow_land_edges"]/rain_in, 1), losses_pct=round(100*v["losses"]/rain_in, 1),
        closure_pct=round(100*(rain_in - stored - v["outflow_total"] - v["losses"])/rain_in, 6),
        nan_hmax=int(np.isnan(hmax).sum()), neg_hmax=int((hmax < 0).sum()), nan_snap=0,
        hmax_max_m=round(float(hmax[landx].max()), 2),
        # sloshing residual: recorded peak above the largest hourly snapshot (land, non-water)
        excess_gt_10cm=int((ex[landx] > 0.10).sum()), excess_gt_20cm=int((ex[landx] > 0.20).sum()),
        excess_max_m=round(float(ex[landx].max()), 3),
        # pre-storm wet land
        hstart_land_ge5cm=int((hs[landx] >= 0.05).sum()), hstart_land_ge15cm=int((hs[landx] >= 0.15).sum()),
        hstart_land_ge5cm_share=round(float((hs[landx] >= 0.05).mean())*100, 2),
        wet15_share_landx=round(float((hmax[landx] >= 0.15).mean())*100, 2),
        wet15_share_landx_excl_hstart=round(float((hmax[landx & (hs < 0.05)] >= 0.15).mean())*100, 2),
        final_hour_wet15=round(float((np.asarray(snaps[-1])[landx & (hs < 0.05)] >= 15).mean())*100, 2),
    )
    res[d.name] = r
    print(d.name, r, flush=True)
json.dump(res, open(Path(__file__).with_name("a1_fixes.json"), "w"), indent=1)
