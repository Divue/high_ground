"""Reviewer check: approximate where water leaves the domain (sea vs N/S/W free-outfall edges),
from hourly snapshots and a steady Manning face flux capped at Froude 1 (same cap as the solver)."""
import sys, json
import numpy as np
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import WORK, OUT, CFG

z = np.load(WORK / "z_model.npy").astype(np.float64)
lc = np.load(WORK / "landcover.npy")
sea = np.load(WORK / "sea.npy")
edge = np.load(WORK / "outlet_edge.npy")
H, W = z.shape
LC = {"urban": 0, "road": 1, "pervious": 2, "wetland": 3, "water": 4, "building": 5, "sea": 6}
n = np.full(z.shape, CFG["landcover"]["manning"]["urban"])
for k, v in CFG["landcover"]["manning"].items():
    if k in LC:
        n[lc == LC[k]] = v
g, dx = 9.81, 30.0
outlet = sea | edge
lab = np.zeros(z.shape, np.int8)       # 1 sea, 2 north, 3 south, 4 west, 5 east-edge(non-sea)
lab[sea] = 1
lab[0, :][edge[0, :]] = 2
lab[-1, :][edge[-1, :]] = 3
lab[:, 0][edge[:, 0]] = 4
lab[:, -1][edge[:, -1]] = 5

def faces(h, tide):
    hb = np.zeros_like(h)
    hb[sea] = np.maximum(tide - z[sea], 0)
    hh = np.where(outlet, hb, h)
    eta = z + hh
    tot = np.zeros(6)
    for axis in (0, 1):
        for sgn in (1, -1):
            # pairs (a inner, b outlet) with b = a shifted
            if axis == 0:
                a = (slice(0, H - 1), slice(None)) if sgn == 1 else (slice(1, H), slice(None))
                b = (slice(1, H), slice(None)) if sgn == 1 else (slice(0, H - 1), slice(None))
            else:
                a = (slice(None), slice(0, W - 1)) if sgn == 1 else (slice(None), slice(1, W))
                b = (slice(None), slice(1, W)) if sgn == 1 else (slice(None), slice(0, W - 1))
            m = (~outlet[a]) & outlet[b]
            ea, eb = eta[a][m], eta[b][m]
            hf = np.maximum(ea, eb) - np.maximum(z[a][m], z[b][m])
            hf = np.maximum(hf, 0)
            S = (ea - eb) / dx
            nn = 0.5 * (n[a][m] + n[b][m])
            q = hf ** (5 / 3) * np.sqrt(np.abs(S)) / nn
            q = np.minimum(q, hf * np.sqrt(g * hf)) * np.sign(S)   # + = out of the domain
            np.add.at(tot, lab[b][m], q * dx)
    return tot  # m3/s by outlet label

res = {}
for run in sys.argv[1:]:
    info = json.loads((OUT / "runs" / run / "info.json").read_text())
    s = np.load(OUT / "runs" / run / "snapshots_cm.npy", mmap_mode="r")
    acc = np.zeros(6)
    for k in range(s.shape[0]):
        acc += faces(np.asarray(s[k], np.float64) / 100.0, info["tide_m"]) * 3600
    names = ["-", "sea", "north", "south", "west", "east_edge"]
    est = {names[i]: round(acc[i] / 1e6, 2) for i in range(1, 6)}
    est["estimated_total"] = round(acc[1:].sum() / 1e6, 2)
    est["reported_total_outflow"] = round(info["volume_m3"]["sea_outflow"] / 1e6, 2)
    est["rain_Mm3"] = round(info["volume_m3"]["rain"] / 1e6, 2)
    est["reservoir_Mm3"] = round(info["volume_m3"]["reservoir"] / 1e6, 2)
    res[run] = est
    print(run, est, flush=True)
json.dump(res, open("/home/tekiru/Desktop/highground/review/model-review/outflow_split.json", "w"), indent=1)
