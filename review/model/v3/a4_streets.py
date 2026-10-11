"""Reviewer check 3a: street JSON vs run outputs. For every segment (all tiles):
- recompute the served statistic (max over hours of p90 of 10 m samples, standing water dropped) and compare;
- p90 of hmax (true peak between hours) vs the served hourly peak;
- segments whose samples are ALL standing water at storm start (served as 0 cm, 'Stays dry') and their real peak."""
import json, sys, base64
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import CRS, OUT, WORK, grid_spec, water_mask
from pyproj import Transformer
from shapely.geometry import LineString
T, W, H = grid_spec(); x0, y1 = T.c, T.f
WEB = OUT / "web" / "streets"
idx = json.loads((WEB / "index.json").read_text())
to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
water = (np.load(WORK/"landcover.npy") == 4) | np.load(WORK/"waterway.npy")
segs = []   # (tile, i, hw, br, r, c)
for t in idx["tiles"]:
    g = json.loads((WEB/"geom"/f"{t}.json").read_text())
    for i, (sid, name, hw, br, flat) in enumerate(g["segs"]):
        a = np.array(flat).reshape(-1, 2); x, y = to_utm.transform(a[:, 0], a[:, 1])
        ls = LineString(np.column_stack([x, y])); L = ls.length
        d = np.arange(0, L + 1e-6, 10.0) if L > 10 else np.array([L / 2])
        pts = [ls.interpolate(v) for v in d]
        xs = np.array([p.x for p in pts]); ys = np.array([p.y for p in pts])
        c = ((xs - x0) / T.a).astype(int); r = ((ys - y1) / T.e).astype(int)
        ok = (r >= 0) & (r < H) & (c >= 0) & (c < W); r, c = r[ok], c[ok]
        land = ~water[r, c]
        segs.append((t, i, hw, br, name, r[land], c[land]))
print("segments", len(segs), flush=True)
res = {}
for run in ["design_200_mean", "design_300_mean", "michaung2023", "dec2015_reservoir", "fengal2024"]:
    d = OUT/"runs"/run
    hmax = np.load(d/"hmax.npy"); hs = np.load(d/"h_start.npy"); sn = np.load(d/"snapshots_cm.npy")
    standing = (hs >= 0.05) & ~water
    vals = {t: json.loads((WEB/run/f"{t}.json").read_text()) for t in idx["tiles"]}
    mism = 0; mism_t15 = 0; n = 0; under = []; masked_all = []; masked_part = 0; worst = []
    for (t, i, hw, br, name, r, c) in segs:
        if br or len(r) == 0:
            continue
        n += 1
        keep = ~standing[r, c]
        served = vals[t]["max"][i]
        if not keep.any():
            pk_all = float(np.percentile(hmax[r, c], 90) * 100)
            masked_all.append((pk_all, served, name, hw, t, i, float(np.median(hs[r, c]) * 100)))
            continue
        if not keep.all():
            masked_part += 1
        r2, c2 = r[keep], c[keep]
        ser = np.percentile(sn[:, r2, c2], 90, axis=1)
        mine = int(round(float(ser.max())))
        if abs(mine - served) > 1: mism += 1
        hit = np.nonzero(ser >= 15)[0]; tt = float(hit[0] + 1) if len(hit) else -1.0
        if tt != vals[t]["t15"][i]: mism_t15 += 1
        true_pk = float(np.percentile(hmax[r2, c2], 90) * 100)
        under.append((true_pk, served))
    u = np.array(under); m = np.array([x[0] for x in masked_all]) if masked_all else np.zeros(0)
    band = lambda v: np.digitize(v, [5, 15, 30])
    r_ = dict(segments=n, served_max_mismatch_gt1cm=mism, served_t15_mismatch=mism_t15,
              hourly_peak_vs_true_peak_median_gap_cm=round(float(np.median(u[:, 0] - u[:, 1])), 1),
              hourly_peak_lower_by_gt10cm=int(((u[:, 0] - u[:, 1]) > 10).sum()),
              band_changes_if_true_peak=int((band(u[:, 0]) != band(u[:, 1])).sum()),
              band_up_if_true_peak=int((band(u[:, 0]) > band(u[:, 1])).sum()),
              all_samples_standing_water=len(masked_all), some_samples_standing_water=masked_part,
              all_masked_true_p90_ge15=int((m >= 15).sum()), all_masked_true_p90_ge30=int((m >= 30).sum()),
              all_masked_named_ge30=sorted([(round(x[0]), x[2], x[3]) for x in masked_all if x[0] >= 30 and x[2]], reverse=True)[:12])
    res[run] = r_
    print(run, json.dumps(r_), flush=True)
json.dump(res, open(Path(__file__).with_name("a4_streets.json"), "w"), indent=1)
