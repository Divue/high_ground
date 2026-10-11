"""Headline AUC with a ward-block bootstrap (streets in a ward are not independent)."""
import json, sys
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import OUT, WORK, water_mask
import scoring
from scipy import ndimage as ndi
from scipy.stats import rankdata
data = scoring.prepare()
def seg_mean(grid, p):
    f = grid.ravel().astype(float)
    s = np.bincount(data[f"{p}_seg"], weights=f[data[f"{p}_cell"]], minlength=int(data[f"{p}_n"]))
    c = np.bincount(data[f"{p}_seg"], minlength=int(data[f"{p}_n"]))
    return np.where(c > 0, s / np.maximum(c, 1), np.nan)
def auc(a, b):
    r = rankdata(np.concatenate([a, b])); return (r[:len(a)].sum() - len(a) * (len(a) + 1) / 2) / (len(a) * len(b))
d = OUT/"runs"/"dec2015_reservoir"
burn = np.load(WORK/"waterway.npy")
grids = {"model": np.where(water_mask(d), 0.0, np.load(d/"hmax.npy")), "near_a_channel": -ndi.distance_transform_edt(~burn),
         "low_elevation": -np.load(WORK/"dtm_bare.npy")}
rng = np.random.default_rng(0)
out = {}
for k, gr in grids.items():
    cs, us = seg_mean(gr, "c"), seg_mean(gr, "u")
    cm = scoring.even(data["c_ward"]) & np.isfinite(cs); um = scoring.even(data["u_ward"]) & np.isfinite(us)
    cw, uw = data["c_ward"][cm], data["u_ward"][um]; a, b = cs[cm], us[um]
    wards = np.unique(np.concatenate([cw, uw]))
    ci_ = {w: np.nonzero(cw == w)[0] for w in wards}; ui_ = {w: np.nonzero(uw == w)[0] for w in wards}
    bs = []
    for _ in range(300):
        ws = rng.choice(wards, len(wards))
        ia = np.concatenate([ci_[w] for w in ws]); ib = np.concatenate([ui_[w] for w in ws])
        bs.append(auc(a[ia], b[ib]))
    out[k] = dict(auc=round(float(auc(a, b)), 3), ward_block_ci95=[round(float(np.percentile(bs, 2.5)), 3), round(float(np.percentile(bs, 97.5)), 3)])
    print(k, out[k], flush=True)
json.dump(out, open(Path(__file__).with_name("a11_block_bootstrap.json"), "w"), indent=1)
