"""Physical-sense checks: timing by place, outflow to the sea by mouth, water on building cells and high ground."""
import json, sys
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import CFG, CRS, OUT, WORK, grid_spec
from pyproj import Transformer
T, W, H = grid_spec(); tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True); to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
z = np.load(WORK/"z_model.npy"); dtm = np.load(WORK/"dtm_bare.npy"); lc = np.load(WORK/"landcover.npy"); burn = np.load(WORK/"waterway.npy"); sea = np.load(WORK/"sea.npy")
perm = (lc == 4) | burn
yy, xx = np.mgrid[0:H, 0:W]; X = T.c + (xx + .5) * T.a; Y = T.f + (yy + .5) * T.e
P = {"velachery": (12.9791, 80.2209, 1200), "pallikaranai": (12.9395, 80.2125, 1500), "tnagar": (13.0418, 80.2341, 1000)}
out = {}
for run in ["design_200_mean", "dec2015_reservoir", "michaung2023"]:
    sn = np.load(OUT/"runs"/run/"snapshots_cm.npy", mmap_mode="r"); hs = np.load(OUT/"runs"/run/"h_start.npy")
    hm = np.load(OUT/"runs"/run/"hmax.npy")
    o = {}
    for k, (lat, lon, r) in P.items():
        x, y = tr.transform(lon, lat); m = ((X - x) ** 2 + (Y - y) ** 2 <= r * r) & ~sea & ~perm & (hs < .05)
        ws = (np.asarray(sn[:, m]) >= 15).mean(1)
        o[f"{k}_hour_wet_share_reaches_5pct"] = int(np.argmax(ws >= .05) + 1) if (ws >= .05).any() else None
        o[f"{k}_hourly_wet_share_first8"] = [round(float(v), 3) for v in ws[:8]]
    land = ~sea & ~perm & (hs < .05)
    bld = (lc == 5) & (hs < .05)
    o["building_cells_wet15_share"] = round(float((hm[bld] >= .15).mean()), 4)
    o["building_cells_wet15_n"] = int((hm[bld] >= .15).sum())
    o["building_cells_max_depth_m"] = round(float(hm[bld].max()), 2)
    o["land_wet15_share"] = round(float((hm[land] >= .15).mean()), 4)
    hi = land & (dtm >= np.percentile(dtm[land], 90))
    o["top10pct_elev_threshold_m"] = round(float(np.percentile(dtm[land], 90)), 1)
    o["top10pct_elev_wet15_share"] = round(float((hm[hi] >= .15).mean()), 4)
    hi2 = land & (dtm >= 25)
    o["above25m_wet15_share"] = round(float((hm[hi2] >= .15).mean()), 4)
    # sea-adjacent land/channel cells: proxy outflow by mouth (sum over hours of depth^(5/3) where water surface above tide)
    tide = CFG["tide"]["high_m" if CFG["replays"].get(run, {}).get("tide") == "high" else "mean_m"] if run in CFG["replays"] else 0.0
    adj = (~sea) & (np.roll(sea, 1, 1) | np.roll(sea, -1, 1) | np.roll(sea, 1, 0) | np.roll(sea, -1, 0))
    rr, cc = np.nonzero(adj)
    hh = np.asarray(sn[:, rr, cc]).astype(np.float32) / 100
    head = np.maximum(z[rr, cc][None, :] + hh - tide, 0)
    idx = (np.minimum(hh, head) ** (5 / 3) * np.sqrt(head / 30)).sum(0)
    tot = idx.sum()
    mouths = {"Adyar": (80.2775, 13.0135), "Cooum": (80.2865, 13.068), "Ennore/Kosasthalaiyar": (80.32, 13.235), "Otteri/Buckingham N": (80.30, 13.12)}
    for name, (lon, lat) in mouths.items():
        x, y = tr.transform(lon, lat); d = np.hypot(X[rr, cc] - x, Y[rr, cc] - y)
        o[f"sea_outflow_share_within_1.5km_of_{name}"] = round(float(idx[d <= 1500].sum() / tot), 3)
    top = np.argsort(-idx)[:6]
    o["top_sea_outflow_cells"] = [[round(v, 4) for v in to_ll.transform(X[rr[k], cc[k]], Y[rr[k], cc[k]])] + [round(float(idx[k] / tot), 3)] for k in top]
    out[run] = o
    print(run, json.dumps(o), flush=True)
json.dump(out, open(Path(__file__).with_name("a10_physical.json"), "w"), indent=1)
