"""Reviewer check: run the production kernels on a crop, initialised from an hourly snapshot,
and measure where water leaves: true outlet edge (N/S/W free outfall), sea cells, and the crop's
artificial sides (held at the snapshot depth). Usage: crop_flux.py run hour r0 r1 c0 c1 minutes [Q_m3s]"""
import importlib, json, math, sys
import numpy as np
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import CFG, WORK, OUT, CRS, grid_spec
fm = importlib.import_module("02_fast_model")
run, hour, r0, r1, c0, c1, minutes = sys.argv[1], int(sys.argv[2]), *map(int, sys.argv[3:7]), float(sys.argv[7])
Qres = float(sys.argv[8]) if len(sys.argv) > 8 else 0.0
info = json.loads((OUT / "runs" / run / "info.json").read_text())
S = np.s_[r0:r1, c0:c1]
z = np.load(WORK / "z_model.npy")[S].astype(np.float64); lc = np.load(WORK / "landcover.npy")[S]
sea = np.load(WORK / "sea.npy")[S]; edge = np.load(WORK / "outlet_edge.npy")[S]; burn = np.load(WORK / "waterway.npy")[S]
h = np.load(OUT / "runs" / run / "snapshots_cm.npy", mmap_mode="r")[hour - 1][S].astype(np.float64) / 100
LC = fm.LC; lcfg = CFG["landcover"]
n = np.full(z.shape, lcfg["manning"]["urban"])
for k, v in lcfg["manning"].items():
    if k in LC: n[lc == LC[k]] = v
n2 = (n * n).astype(np.float32)
loss = np.zeros(z.shape)
for k, v in lcfg["infiltration_mm_h"].items(): loss[lc == LC[k]] += v / 1000 / 3600
Hc, Wc = z.shape
side = np.zeros(z.shape, bool)
if r0 > 0: side[0, :] = True
if r1 < 836 * 2: side[-1, :] = True if r1 < 1440 else False
if c0 > 0: side[:, 0] = True
if c1 < 836: side[:, -1] = True
side &= ~edge & ~sea
outlet = sea | edge | side
outlet_h = np.zeros(z.shape)
outlet_h[sea] = np.maximum(info["tide_m"] - z[sea], 0)
outlet_h[side] = h[side]
h[outlet] = outlet_h[outlet]
infl = np.zeros(z.shape)
if Qres > 0:
    from pyproj import Transformer
    transform, W, H = grid_spec()
    lon, lat = CFG["replays"]["dec2015_reservoir"]["reservoir"]["entry_lonlat"]
    x, y = Transformer.from_crs("EPSG:4326", CRS, always_xy=True).transform(lon, lat)
    c, r = ~transform * (x, y); r, c = int(r), int(c)
    fb = np.load(WORK / "waterway.npy")
    rr, cc = np.nonzero(fb[r - 40:r + 40, max(c - 40, 0):c + 40]); rr += r - 40; cc += max(c - 40, 0)
    k = np.argmin((rr - r) ** 2 + (cc - c) ** 2); r, c = rr[k], cc[k]
    cells = np.zeros(fb.shape, bool); cells[max(r - 1, 0):r + 2, max(c - 1, 0):c + 2] = True
    cells &= fb | (np.load(WORK / "landcover.npy") == 4)
    infl = (cells / (cells.sum() * 900.0))[S]
rate = info["rain_mm_h"][hour] if hour < len(info["rain_mm_h"]) else 0.0
lab = np.zeros(z.shape, np.int8); lab[sea] = 1; lab[edge] = 2; lab[side] = 3
qx = np.zeros((Hc, Wc - 1), np.float32); qy = np.zeros((Hc - 1, Wc), np.float32)
fac = np.ones(z.shape); hmax = np.zeros(z.shape); t15 = np.full(z.shape, -1.0); row = np.zeros((Hc, 5)); hbuf = np.empty(z.shape)
z32 = z.astype(np.float32); acc = np.zeros(4); t = 0.0; T = minutes * 60; dx = 30.0
hm = float(h[~outlet].max())
while t < T - 1e-9:
    dt = min(10.0, CFG["solver"]["cfl_alpha"] * dx / math.sqrt(9.81 * max(hm, 0.01)), T - t)
    hprev = h.copy()
    fm.momentum(h, z32, qx, qy, n2, dt, dx, 9.81, CFG["solver"]["h_dry_m"])
    fm.limit_outflow(h, qx, qy, fac, dt, dx)
    fm.continuity(h, qx, qy, fac, z, outlet, outlet_h, rate / 3.6e6 * dt, loss, infl, Qres, dt, dx, 0.0, 1e9, hmax, t15, row, hbuf)
    # volume gained by each outlet class this step = (hn - target) before reset; recompute from net flux
    # net into outlet cells = (h_after_flux - target); continuity reset it, so use limited fluxes directly
    net = np.zeros(z.shape)
    net[:, 1:] += qx; net[:, :-1] -= qx; net[1:, :] += qy; net[:-1, :] -= qy
    np.add.at(acc, lab[outlet], net[outlet] * dt * dx)
    hm = float(np.where(outlet, 0, h).max()); t += dt
names = {1: "sea", 2: "domain_edge_outfall", 3: "crop_sides"}
res = {names[k]: round(acc[k] / (minutes * 60), 1) for k in (1, 2, 3)}
res.update(run=run, hour=hour, crop=[r0, r1, c0, c1], minutes=minutes, reservoir_m3s=Qres, rain_mm_h=rate,
           note="m3/s into each outlet class (positive = leaving the modelled land)")
print(json.dumps(res))
