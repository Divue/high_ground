"""Evaluate sub-box experiments: place wet shares, agreement with NRSC/GCC inside the box, street AUC (odd and even wards)."""
import json, sys
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import CRS, OUT, WORK, grid_spec
import scoring
from pyproj import Transformer
from scipy import stats
SP = Path("/tmp/claude-1000/-home-tekiru-Desktop-highground/55f88bdc-6229-41e3-9e51-dd1ae875e719/scratchpad")
T, W, H = grid_spec()
lc = np.load(WORK/"landcover.npy"); burn = np.load(WORK/"waterway.npy"); sea = np.load(WORK/"sea.npy")
perm = (lc == 4) | burn
zg = np.load(SP/"gcc_zone.npy"); ng = np.load(SP/"nrsc.npy")
data = scoring.prepare()
tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
yy, xx = np.mgrid[0:H, 0:W]; X = T.c + (xx + 0.5) * T.a; Y = T.f + (yy + 0.5) * T.e
P = {"velachery": (12.9791, 80.2209, 1200), "pallikaranai": (12.9395, 80.2125, 1500), "tnagar": (13.0418, 80.2341, 1000)}
circ = {}
for k, (lat, lon, r) in P.items():
    x, y = tr.transform(lon, lat); circ[k] = ((X - x) ** 2 + (Y - y) ** 2 <= r * r) & ~sea & ~perm

def seg_mean(grid, p, inbox):
    f = grid.ravel().astype(float); cell = data[f"{p}_cell"]; seg = data[f"{p}_seg"]
    k = inbox.ravel()[cell]
    s = np.bincount(seg[k], weights=f[cell[k]], minlength=int(data[f"{p}_n"]))
    c = np.bincount(seg[k], minlength=int(data[f"{p}_n"]))
    return np.where(c > 0, s / np.maximum(c, 1), np.nan)

def evaluate(full_hmax, hstart_full, inbox, label):
    m = ~(hstart_full >= 0.05)
    peak = np.where(perm | ~m, 0.0, full_hmax)
    out = {"label": label}
    for k, c in circ.items():
        cc = c & m
        out[f"{k}_wet15"] = round(float((peak[cc] >= .15).mean()), 3)
    land = inbox & ~sea & ~perm & m
    wet = peak >= .15
    out["box_wet15"] = round(float(wet[land].mean()), 3)
    out["nrsc_hit"] = round(float((wet & ng)[land].sum() / max(ng[land].sum(), 1)), 3)
    out["nrsc_csi"] = round(float((wet & ng)[land].sum() / max((wet | ng)[land].sum(), 1)), 3)
    out["nrsc_random_hit_same_share"] = out["box_wet15"]
    out["gcc_modplus_share_of_wet"] = round(float(((zg >= 3) & wet)[land & (zg > 0)].sum() / max(wet[land & (zg > 0)].sum(), 1)), 3)
    out["gcc_modplus_share_of_land"] = round(float((zg >= 3)[land & (zg > 0)].mean()), 3)
    cs, us = seg_mean(peak, "c", inbox), seg_mean(peak, "u", inbox)
    for name, f in (("odd", scoring.odd), ("even", scoring.even)):
        a_ = cs[f(data["c_ward"]) & np.isfinite(cs)]; b_ = us[f(data["u_ward"]) & np.isfinite(us)]
        out[f"auc_{name}"] = round(float(stats.mannwhitneyu(a_, b_).statistic / (len(a_) * len(b_))), 3)
        out[f"n_rep_{name}"] = int(len(a_))
    return out

if __name__ == "__main__":
    res = []
    tags = sys.argv[1:]
    for tag in tags:
        if tag.startswith("FULL"):     # full v3 run restricted to the same box and first 14 h
            _, run, b = tag.split(":"); r0, r1, c0, c1 = map(int, b.split(","))
            sn = np.load(OUT/"runs"/run/"snapshots_cm.npy", mmap_mode="r")
            hm = np.zeros((H, W), np.float32); hm[r0:r1, c0:c1] = np.asarray(sn[:14, r0:r1, c0:c1]).max(0) / 100
            hs = np.zeros((H, W), np.float32); hs[r0:r1, c0:c1] = np.load(OUT/"runs"/run/"h_start.npy")[r0:r1, c0:c1]
        else:
            d = np.load(SP/"subbox"/f"{tag}.npz"); r0, r1, c0, c1 = d["box"]
            hm = np.zeros((H, W), np.float32); hm[r0:r1, c0:c1] = d["snaps"].astype(np.float32).max(0)
            hs = np.zeros((H, W), np.float32); hs[r0:r1, c0:c1] = d["hstart"]
        inbox = np.zeros((H, W), bool); inbox[r0:r1, c0:c1] = True
        inbox[r0:r0+15, :] = inbox[r1-15:r1, :] = False; inbox[:, c0:c0+15] = inbox[:, c1-15:c1] = False   # ignore 450 m edge strips
        r = evaluate(hm, hs, inbox, tag)
        print(json.dumps(r), flush=True); res.append(r)
    f = Path(__file__).with_name("subbox_results.json")
    old = json.loads(f.read_text()) if f.exists() else {}
    old.update({r["label"]: r for r in res}); f.write_text(json.dumps(old, indent=1))
