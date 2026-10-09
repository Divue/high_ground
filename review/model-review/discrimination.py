"""Reviewer check: texture-insensitive discrimination. (1) NRSC 2015 areal coverage at matched share
(model vs elevation vs random). (2) Segment-level AUC, reported vs unreported, even wards, using a
continuous per-segment score. (3) Ward-level rank correlation of model flooded-street share vs reported share."""
import sys, json
import numpy as np
from scipy import stats
from rasterio.features import rasterize
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
import scoring
from common import WORK, OUT, RAW, CRS, grid_spec

transform, W, H = grid_spec()
data = scoring.prepare()
land, dtm = scoring._land_and_dtm()
water = scoring._BASE["water"]
hm = np.load(OUT / "runs" / "dec2015_reservoir" / "hmax.npy")
wet = (hm >= 0.15) & ~water
share = float(wet[land].mean())
res = {}
# (1) NRSC
nrsc = scoring._read_kml(RAW / "validation" / "inundation_2015.kml").to_crs(CRS)
ng = rasterize([(g, 1) for g in nrsc.geometry if g is not None], out_shape=(H, W), transform=transform, fill=0, dtype="uint8").astype(bool)
def areal(g):
    a, b = g & land, ng & land
    return dict(share_of_nrsc_covered=round(float((a & b).sum() / b.sum()), 3), csi=round(float((a & b).sum() / (a | b).sum()), 3),
                flooded_share=round(float(a.sum() / land.sum()), 3))
rng = np.random.default_rng(2)
res["nrsc_matched_share"] = dict(model=areal(wet), elevation_same_share=areal(scoring.baseline_grid(share)),
                                 random_same_share=areal((rng.random(wet.shape) < share) & land),
                                 lowest20_as_in_proof=areal(scoring.baseline_grid(0.20)))
print(json.dumps(res["nrsc_matched_share"], indent=1), flush=True)

# (2) segment AUC
def seg_score(grid_flat, seg, cell, n, how="mean"):
    s = np.bincount(seg, weights=grid_flat[cell], minlength=n)
    c = np.bincount(seg, minlength=n)
    return np.where(c > 0, s / np.maximum(c, 1), np.nan)
def auc(score_fn):
    cs = score_fn("c"); us = score_fn("u")
    cm = scoring.even(data["c_ward"]) & np.isfinite(cs); um = scoring.even(data["u_ward"]) & np.isfinite(us)
    a, b = cs[cm], us[um]
    u = stats.mannwhitneyu(a, b, alternative="two-sided").statistic
    return round(float(u / (len(a) * len(b))), 3)
def mk(grid):
    f = grid.ravel().astype(float)
    return lambda p: seg_score(f, data[f"{p}_seg"], data[f"{p}_cell"], int(data[f"{p}_n"]))
res["segment_auc_even_wards"] = dict(
    model_share_of_length_ge15cm=auc(mk(wet)),
    model_mean_peak_depth=auc(mk(np.where(water, 0, hm))),
    minus_elevation=auc(mk(-dtm)),
    random_speckle=auc(mk((rng.random(wet.shape) < share) & land)))
print(res["segment_auc_even_wards"], flush=True)

# (3) ward-level: reported share of road length vs model share of road samples wet
cw = data["c_ward"]; uw = data["u_ward"]
cl = np.bincount(data["c_seg"], minlength=int(data["c_n"])).astype(float)
ul = np.bincount(data["u_seg"], minlength=int(data["u_n"])).astype(float)
wets = {"model": wet, "elevation_same_share": scoring.baseline_grid(share)}
rows = {}
for k, g in wets.items():
    f = g.ravel()
    cwet = np.bincount(data["c_seg"], weights=f[data["c_cell"]], minlength=int(data["c_n"]))
    uwet = np.bincount(data["u_seg"], weights=f[data["u_cell"]], minlength=int(data["u_n"]))
    wards = sorted(set(cw[cw > 0]) | set(uw[uw > 0]))
    rep, mod = [], []
    for w in wards:
        if w % 2: continue
        L = cl[cw == w].sum() + ul[uw == w].sum()
        if L < 200: continue
        rep.append(cl[cw == w].sum() / L)
        mod.append((cwet[cw == w].sum() + uwet[uw == w].sum()) / L)
    r = stats.spearmanr(rep, mod)
    rows[k] = dict(spearman=round(float(r.statistic), 3), p=round(float(r.pvalue), 4), wards=len(rep))
res["ward_level_even"] = rows
print(rows)
json.dump(res, open("/home/tekiru/Desktop/highground/review/model-review/discrimination.json", "w"), indent=1)
