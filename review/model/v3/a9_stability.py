"""Temporal oscillation and checkerboard checks on full v3 runs (land, non-water, not standing at start)."""
import json, sys
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import OUT, WORK
from scipy import ndimage as ndi
lc = np.load(WORK/"landcover.npy"); burn = np.load(WORK/"waterway.npy"); sea = np.load(WORK/"sea.npy"); edge = np.load(WORK/"outlet_edge.npy")
land = ~sea & ~edge & ~burn & (lc != 4)
H, W = land.shape
par = (np.add.outer(np.arange(H), np.arange(W)) % 2) * 2 - 1
res = {}
for run in ["design_200_mean", "design_400_mean", "michaung2023", "dec2015_reservoir"]:
    sn = np.load(OUT/"runs"/run/"snapshots_cm.npy").astype(np.float32)
    hs = np.load(OUT/"runs"/run/"h_start.npy")
    m = land & (hs < .05)
    d = np.diff(sn[:, m], axis=0)                     # hourly change per cell
    big = np.abs(d) > 5
    rev = (np.sign(d[1:]) * np.sign(d[:-1]) < 0) & big[1:] & big[:-1]
    nrev = rev.sum(0)
    # spatial checkerboard at the wettest hour
    k = int(np.argmax((sn[:, m] >= 15).mean(1)))
    h = sn[k]
    lap = h - 0.25 * (np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1))
    chk = ndi.uniform_filter(lap * par, size=4)
    wetm = m & (h >= 5)
    res[run] = dict(cells=int(m.sum()), cells_with_2plus_reversals_gt5cm=int((nrev >= 2).sum()),
                    cells_with_4plus_reversals_gt5cm=int((nrev >= 4).sum()),
                    max_hourly_rise_cm=float(d.max()), wettest_hour=k + 1,
                    checkerboard_index_p99_cm=round(float(np.percentile(np.abs(chk[wetm]), 99)), 2),
                    checkerboard_cells_gt5cm=int((np.abs(chk[wetm]) > 5).sum()), wet_cells=int(wetm.sum()),
                    negative=int((sn < 0).sum()), nan=int(np.isnan(sn).sum()))
    print(run, json.dumps(res[run]), flush=True)
json.dump(res, open(Path(__file__).with_name("a9_stability.json"), "w"), indent=1)
