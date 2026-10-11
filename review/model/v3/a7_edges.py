"""Reviewer check 1b: where does reservoir water leave through land edges; what does high tide do at edge outlets?"""
import json, sys
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import CFG, CRS, OUT, WORK, grid_spec
from pyproj import Transformer
T, W, H = grid_spec()
z = np.load(WORK/"z_model.npy"); edge = np.load(WORK/"outlet_edge.npy"); sea = np.load(WORK/"sea.npy")
burn = np.load(WORK/"waterway.npy"); lc = np.load(WORK/"landcover.npy")
to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
def ll(r, c):
    x = T.c + (c + .5) * T.a; y = T.f + (r + .5) * T.e; return [round(v, 4) for v in to_ll.transform(x, y)]
out = {}
# cells one step inside each edge outlet; Manning-free estimate of outflow ~ sum over time of depth^(5/3) (relative only)
def inner(side):
    if side == "W": return [(r, 1, r, 0) for r in range(1, H - 1) if edge[r, 0]]
    if side == "E": return [(r, W - 2, r, W - 1) for r in range(1, H - 1) if edge[r, W - 1]]
    if side == "N": return [(1, c, 0, c) for c in range(1, W - 1) if edge[0, c]]
    if side == "S": return [(H - 2, c, H - 1, c) for c in range(1, W - 1) if edge[H - 1, c]]
for run in ["dec2015_rain", "dec2015_reservoir", "design_200_mean", "design_200_high", "design_50_mean", "design_50_high"]:
    sn = np.load(OUT/"runs"/run/"snapshots_cm.npy", mmap_mode="r")
    a = {}
    for side in "WENS":
        cells = inner(side)
        rr = np.array([c[0] for c in cells]); cc = np.array([c[1] for c in cells])
        er = np.array([c[2] for c in cells]); ec = np.array([c[3] for c in cells])
        # water surface gradient toward the edge cell (edge held at max(tide - z, 0) + z)
        tide = CFG["tide"]["high_m" if run.endswith("high") else "mean_m"]
        eta_edge = np.maximum(z[er, ec], tide)
        hh = np.asarray(sn[:, rr, cc]).astype(np.float32) / 100
        eta_in = z[rr, cc] + hh
        hf = np.maximum(eta_in, eta_edge)[None, :] - np.maximum(z[rr, cc], z[er, ec])[None, :] if False else np.maximum(eta_in - np.maximum(z[rr, cc], z[er, ec]), 0)
        sgn = np.sign(eta_in - eta_edge)
        idx = hf ** (5 / 3) * np.sqrt(np.abs(eta_in - eta_edge) / 30.0) * sgn     # Manning-like unit discharge / (1/n)
        tot = idx.sum(0)
        top = np.argsort(-np.abs(tot))[:5]
        a[side] = dict(net_index=round(float(tot.sum()), 2), inflow_index=round(float(tot[tot < 0].sum()), 2),
                       top=[dict(lonlat=ll(int(rr[k]), int(cc[k])), index=round(float(tot[k]), 2), edge_bed=round(float(z[er[k], ec[k]]), 2)) for k in top])
    out[run] = a
    print(run, json.dumps({s: (v["net_index"], v["inflow_index"]) for s, v in a.items()}), flush=True)
# reservoir extra water at peak near the west edge, outside the closed stretch
hr = np.load(OUT/"runs"/"dec2015_reservoir"/"hmax.npy"); h0 = np.load(OUT/"runs"/"dec2015_rain"/"hmax.npy")
dd = hr - h0
for side, sl in (("W", (slice(None), slice(0, 3))), ("S", (slice(H - 3, H), slice(None))), ("N", (slice(0, 3), slice(None)))):
    m = np.zeros_like(edge); m[sl] = True
    m &= ~sea
    rr, cc = np.nonzero(m & (dd > 0.05))
    out[f"reservoir_extra_depth_gt5cm_cells_near_{side}_edge"] = int(len(rr))
    if len(rr):
        k = np.argsort(-dd[rr, cc])[:5]
        out[f"reservoir_extra_top_{side}"] = [dict(lonlat=ll(int(rr[i]), int(cc[i])), extra_m=round(float(dd[rr[i], cc[i]]), 2), row=int(rr[i])) for i in k]
closed = np.nonzero(~edge[:, 0] & ~sea[:, 0])[0]
out["west_edge_closed_rows"] = [int(closed.min()), int(closed.max())] if len(closed) else None
out["west_edge_closed_lat"] = [ll(int(closed.min()), 0)[1], ll(int(closed.max()), 0)[1]] if len(closed) else None
# edge outlets whose bed is below high tide (held at tide, can inject water)
below = edge & (z < CFG["tide"]["high_m"])
rr, cc = np.nonzero(below)
out["edge_cells_bed_below_high_tide"] = int(below.sum())
out["edge_cells_bed_below_high_tide_examples"] = [ll(int(r), int(c)) for r, c in list(zip(rr, cc))[::max(1, len(rr) // 8)]]
# land wet at storm start in high-tide runs but not mean (tidal flooding at storm start)
hsh = np.load(OUT/"runs"/"design_200_high"/"h_start.npy"); hsm = np.load(OUT/"runs"/"design_200_mean"/"h_start.npy")
land = ~sea & ~edge & ~burn & (lc != 4)
dm = land & (hsh >= .05) & (hsm < .05)
rr, cc = np.nonzero(dm)
out["high_tide_extra_wet_land_at_start"] = int(dm.sum())
out["high_tide_extra_wet_examples"] = [ll(int(r), int(c)) for r, c in list(zip(rr, cc))[::max(1, len(rr) // 6)]]
# difference in peak between high and mean tide over land
hh = np.load(OUT/"runs"/"design_200_high"/"hmax.npy"); hm_ = np.load(OUT/"runs"/"design_200_mean"/"hmax.npy")
diff = (hh - hm_)[land & (hsh < .05)]
out["high_minus_mean_200mm"] = dict(cells_gt5cm=int((diff > .05).sum()), cells_lt_minus5cm=int((diff < -.05).sum()), max=round(float(diff.max()), 2))
print(json.dumps({k: v for k, v in out.items() if not k.startswith(("dec", "design"))}, indent=1))
json.dump(out, open(Path(__file__).with_name("a7_edges.json"), "w"), indent=1)
