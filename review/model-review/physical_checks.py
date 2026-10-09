"""Reviewer check: places timing, high ground, building cells, checkerboard, NaN/negatives."""
import sys, json
import numpy as np
from scipy import ndimage as ndi
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import WORK, OUT, CFG, CRS, grid_spec
from pyproj import Transformer

transform, W, H = grid_spec()
z = np.load(WORK / "z_model.npy"); dtm = np.load(WORK / "dtm_bare.npy")
lc = np.load(WORK / "landcover.npy"); sea = np.load(WORK / "sea.npy"); edge = np.load(WORK / "outlet_edge.npy")
burn = np.load(WORK / "waterway.npy")
perm = (lc == 4) | burn
L = ~sea & ~edge & ~perm
tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
yy, xx = np.mgrid[0:H, 0:W]
X = transform.c + (xx + 0.5) * transform.a
Y = transform.f + (yy + 0.5) * transform.e
PLACES = {"Velachery": (12.9791, 80.2209, 1200), "Pallikaranai": (12.9395, 80.2125, 1500),
          "T. Nagar": (13.0418, 80.2341, 1000), "Anna Nagar": (13.0850, 80.2101, 1200),
          "Mylapore": (13.0339, 80.2676, 1000)}
masks = {}
for k, (lat, lon, r) in PLACES.items():
    x, y = tr.transform(lon, lat)
    masks[k] = ((X - x) ** 2 + (Y - y) ** 2 <= r * r) & L
out = {"places": {}}
for run in sys.argv[1:]:
    s = np.load(OUT / "runs" / run / "snapshots_cm.npy", mmap_mode="r")
    t15 = np.load(OUT / "runs" / run / "t15.npy"); hm = np.load(OUT / "runs" / run / "hmax.npy")
    hrs = [2, 4, 6, 8, 12, s.shape[0]]
    row = {}
    for k, m in masks.items():
        ws = [round(float((np.asarray(s[h - 1])[m] >= 15).mean()), 3) for h in hrs]
        tv = t15[m]; tv = tv[tv >= 0]
        row[k] = dict(wet_share_at_hours=dict(zip(hrs, ws)), final_hmax_wet_share=round(float((hm[m] >= .15).mean()), 3),
                      median_t15_h_of_wet=round(float(np.median(tv)), 2) if len(tv) else None,
                      mean_elev_m=round(float(dtm[m].mean()), 2))
        print(run, k, row[k], flush=True)
    out["places"][run] = row

# high ground: relative elevation above the 600 m neighbourhood minimum, and local maxima
run = "design_200_mean"
hm = np.load(OUT / "runs" / run / "hmax.npy")
nbmin = ndi.minimum_filter(np.where(sea, 0, dtm), size=21)
rel = dtm - nbmin
hi = L & (rel > 3.0)
lmax = L & (z >= ndi.maximum_filter(z, size=3)) & (lc != 5)
bld = (lc == 5) & ~sea
top = L & (dtm > np.percentile(dtm[L], 95))
out["high_ground"] = dict(
    run=run,
    cells_more_than_3m_above_600m_neighbourhood_min=int(hi.sum()),
    share_of_those_ge15cm=round(float((hm[hi] >= .15).mean()), 4),
    top5pct_elevation_cells=int(top.sum()), share_top5pct_ge15cm=round(float((hm[top] >= .15).mean()), 4),
    local_maxima_cells=int(lmax.sum()), share_local_maxima_ge15cm=round(float((hm[lmax] >= .15).mean()), 4),
    building_obstacle_cells=int(bld.sum()), building_cells_ge15cm=int((hm[bld] >= .15).sum()),
    building_cells_ge5cm=int((hm[bld] >= .05).sum()), building_max_cm=round(float(hm[bld].max() * 100), 1))
print(out["high_ground"])

# checkerboard: amplitude of the (pi,pi) mode of the water surface in fully wet 2x2 blocks
def cb_stats(h):
    eta = z + h
    wet = (h > 0.10) & ~sea
    a, b, c, d = eta[:-1, :-1], eta[:-1, 1:], eta[1:, :-1], eta[1:, 1:]
    allw = wet[:-1, :-1] & wet[:-1, 1:] & wet[1:, :-1] & wet[1:, 1:]
    cb = np.abs(a - b - c + d) / 4
    # strict alternation pattern share (a,d both above or both below b,c)
    alt = ((np.minimum(a, d) > np.maximum(b, c)) | (np.maximum(a, d) < np.minimum(b, c))) & (cb > 0.01)
    za, zb, zc, zd = z[:-1, :-1], z[:-1, 1:], z[1:, :-1], z[1:, 1:]
    zalt = ((np.minimum(za, zd) > np.maximum(zb, zc)) | (np.maximum(za, zd) < np.minimum(zb, zc)))
    return dict(blocks=int(allw.sum()), cb_p50_cm=round(float(np.median(cb[allw]) * 100), 3),
                cb_p99_cm=round(float(np.percentile(cb[allw], 99) * 100), 2),
                strict_alternation_share_eta=round(float(alt[allw].mean()), 4),
                strict_alternation_share_terrain=round(float(zalt[allw].mean()), 4))
cbo = {}
for run in ["design_200_mean", "michaung2023"]:
    s = np.load(OUT / "runs" / run / "snapshots_cm.npy", mmap_mode="r")
    for k in (5, s.shape[0] - 1):
        cbo[f"{run}_h{k+1}"] = cb_stats(np.asarray(s[k], np.float64) / 100)
        print(run, k + 1, cbo[f"{run}_h{k+1}"], flush=True)
out["checkerboard"] = cbo
# NaN / negatives in every run
nn = {}
import glob, os
for d in sorted(glob.glob(str(OUT / "runs" / "*"))):
    r = os.path.basename(d)
    hm = np.load(d + "/hmax.npy"); t = np.load(d + "/t15.npy")
    nn[r] = dict(nan=int(np.isnan(hm).sum() + np.isnan(t).sum()), neg_depth=int((hm < 0).sum()), max_m=round(float(hm[L].max()), 2),
                 p999_m=round(float(np.percentile(hm[L], 99.9)), 2))
out["nan_neg"] = nn
print(nn)
json.dump(out, open("/home/tekiru/Desktop/highground/review/model-review/physical_checks.json", "w"), indent=1)
