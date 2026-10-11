"""Reviewer check 3b: routing graph depths, parking dry flags and hospital cut-offs vs the run outputs and vs
what the browser computes from 8-bit Mercator frames (time-aware routing)."""
import json, sys
import numpy as np
from pathlib import Path
from PIL import Image
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import CRS, OUT, WORK, grid_spec, water_mask
from pyproj import Transformer
T, W, H = grid_spec()
G = OUT/"web"/"graph"
nodes = np.fromfile(G/"nodes.bin", np.float32).reshape(-1, 2); edges = np.fromfile(G/"edges.bin", np.uint32).reshape(-1, 2)
ln = np.fromfile(G/"len.bin", np.float32); cls = np.fromfile(G/"cls.bin", np.uint8); brg = np.fromfile(G/"bridge.bin", np.uint8).astype(bool)
off = np.fromfile(G/"geom_off.bin", np.uint32); geom = np.fromfile(G/"geom.bin", np.float32).reshape(-1, 2)
to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
X, Y = to_utm.transform(geom[:, 0].astype(float), geom[:, 1].astype(float))
water = (np.load(WORK/"landcover.npy") == 4) | np.load(WORK/"waterway.npy")
# server sampling (05_features): every 15 m along the UTM polyline
sr, sc, se = [], [], []
for e in range(len(edges)):
    a, b = off[e], off[e + 1]
    x, y = X[a:b], Y[a:b]
    sl = np.hypot(np.diff(x), np.diff(y)); cum = np.concatenate([[0], np.cumsum(sl)])
    d = np.arange(0, cum[-1] + 1e-6, 15.0) if cum[-1] > 15 else np.array([cum[-1] / 2])
    xs = np.interp(d, cum, x); ys = np.interp(d, cum, y)
    sc.append(((xs - T.c) / T.a).astype(int).clip(0, W - 1)); sr.append(((ys - T.f) / T.e).astype(int).clip(0, H - 1)); se.append(np.full(len(d), e))
sr = np.concatenate(sr); sc = np.concatenate(sc); se = np.concatenate(se)
k = ~water[sr, sc]; sr, sc, se = sr[k], sc[k], se[k]
order = np.argsort(se, kind="stable"); sr, sc, se = sr[order], sc[order], se[order]
starts = np.searchsorted(se, np.arange(len(edges) + 1))
def p90_per_edge(vals):
    out = np.zeros(len(edges), np.float32)
    for e in range(len(edges)):
        v = vals[starts[e]:starts[e + 1]]
        if len(v): out[e] = np.quantile(v, 0.9)
    return out
meta = json.loads((OUT/"web"/"water"/"meta.json").read_text())
l, b, r, t = meta["bbox_mercator"]; Wm, Hm = meta["width"], meta["height"]
R = 20037508.342789244
def browser_edge_depth(frame):
    """routing.ts edgeDepthFromFrame: vertices + ~15 m midpoints, Mercator pixel lookup, p90 (floor index)."""
    lon, lat = geom[:, 0].astype(float), geom[:, 1].astype(float)
    out = np.zeros(len(edges), np.float32)
    for e in range(len(edges)):
        if brg[e]: continue
        a, z_ = off[e], off[e + 1]; pl = []
        for i in range(a, z_):
            pl.append((lon[i], lat[i]))
            if i + 1 < z_:
                dd = np.hypot((lon[i+1]-lon[i]) * 111320 * np.cos(np.radians(lat[i])), (lat[i+1]-lat[i]) * 110540)
                n = int(dd // 15)
                for kk in range(1, n): pl.append((lon[i] + (lon[i+1]-lon[i]) * kk / n, lat[i] + (lat[i+1]-lat[i]) * kk / n))
        p = np.array(pl); mx = p[:, 0] * R / 180; my = np.log(np.tan((90 + p[:, 1]) * np.pi / 360)) * R / np.pi
        cc = np.floor((mx - l) * Wm / (r - l)).astype(int); rr = np.floor((t - my) * Hm / (t - b)).astype(int)
        ok = (cc >= 0) & (cc < Wm) & (rr >= 0) & (rr < Hm)
        v = np.sort(frame[rr[ok], cc[ok]][:4096])
        if len(v): out[e] = v[int(np.floor(0.9 * (len(v) - 1)))]
    return out
res = {}
for run in ["design_200_mean", "michaung2023", "dec2015_reservoir"]:
    d = OUT/"runs"/run
    hmax = np.load(d/"hmax.npy"); hs = np.load(d/"h_start.npy"); sn = np.load(d/"snapshots_cm.npy", mmap_mode="r")
    wm = water_mask(d)
    served = np.fromfile(G/f"depth_{run}.bin", np.uint16).astype(np.float32)
    mine = np.round(p90_per_edge(np.where(wm, 0.0, hmax)[sr, sc]) * 100); mine[brg] = 0
    # what the edge would be without zeroing standing water
    nomask = np.round(p90_per_edge(np.where(water, 0.0, hmax)[sr, sc]) * 100); nomask[brg] = 0
    # card-style: max over hours of p90 (standing water excluded)
    snp = np.asarray(sn[:, :, :])
    card = np.zeros(len(edges), np.float32)
    stand = (hs >= 0.05) & ~water
    for e in range(len(edges)):
        rr, cc = sr[starts[e]:starts[e+1]], sc[starts[e]:starts[e+1]]
        kk = ~stand[rr, cc]
        if kk.any() and not brg[e]:
            card[e] = np.percentile(snp[:, rr[kk], cc[kk]], 90, axis=1).max()
    peak_h = int(np.argmax(json.loads((OUT/"web"/"runs.json").read_text())[run]["wet_share_15cm_hourly"])) + 1
    fr = np.asarray(Image.open(OUT/"web"/"water"/run/f"h{peak_h:02d}.png"))
    sn_cm = np.asarray(sn[peak_h - 1]).astype(np.float32)
    srv_h = np.zeros(len(edges), np.float32)   # server-style statistic at that same hour (model grid, no resampling)
    vals_h = np.where(wm, 0.0, sn_cm)[sr, sc]
    srv_h = p90_per_edge(vals_h); srv_h[brg] = 0
    brow = browser_edge_depth(fr)
    car = 30
    r_ = dict(edges=int(len(edges)), served_vs_recomputed_mismatch=int((np.abs(served - mine) > 1).sum()),
              impassable_served=int((served >= car).sum()),
              impassable_if_standing_not_zeroed=int((nomask >= car).sum()),
              edges_hidden_by_standing_mask=int(((nomask >= car) & (served < car)).sum()),
              card_vs_routing_disagree=int(((card >= car) != (served >= car)).sum()),
              card_says_unsafe_routing_says_ok=int(((card >= car) & (served < car)).sum()),
              routing_says_unsafe_card_says_ok=int(((card < car) & (served >= car)).sum()),
              peak_hour=peak_h,
              browser_vs_model_grid_same_hour_disagree=int(((brow >= car) != (srv_h >= car)).sum()),
              browser_misses_impassable=int(((brow < car) & (srv_h >= car)).sum()),
              browser_extra_impassable=int(((brow >= car) & (srv_h < car)).sum()),
              model_grid_impassable_at_hour=int((srv_h >= car).sum()))
    res[run] = r_
    print(run, json.dumps(r_), flush=True)
    np.save(Path("/tmp/claude-1000/-home-tekiru-Desktop-highground/55f88bdc-6229-41e3-9e51-dd1ae875e719/scratchpad") / f"edge_nomask_{run}.npy", nomask)
json.dump(res, open(Path(__file__).with_name("a5_graph.json"), "w"), indent=1)
