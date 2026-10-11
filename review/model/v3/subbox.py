"""Sub-box rerun of the v3 solver (same numba kernels, same setup as 02_fast_model.run) for targeted experiments.
Usage: python subbox.py <tag> [--cap 1.0] [--cap-built X] [--no-drain-burn] [--smooth-built S] [--alpha 0.5]
       [--hours 14] [--mm 200] [--drainage 10] [--box r0 r1 c0 c1]"""
import argparse, importlib, json, math, sys, time
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import CFG, WORK
import terrain_variants as tv
fm = importlib.import_module("02_fast_model")
SP = Path("/tmp/claude-1000/-home-tekiru-Desktop-highground/55f88bdc-6229-41e3-9e51-dd1ae875e719/scratchpad/subbox")
SP.mkdir(parents=True, exist_ok=True)
LC = fm.LC; G = CFG["solver"]["g"]

ap = argparse.ArgumentParser()
ap.add_argument("tag"); ap.add_argument("--cap", type=float, default=1.0); ap.add_argument("--cap-built", type=float)
ap.add_argument("--no-drain-burn", action="store_true"); ap.add_argument("--smooth-built", type=float)
ap.add_argument("--alpha", type=float, default=CFG["solver"]["cfl_alpha"]); ap.add_argument("--hours", type=float, default=14)
ap.add_argument("--mm", type=float, default=200); ap.add_argument("--drainage", type=float, default=10.0)
ap.add_argument("--box", type=int, nargs=4, default=None); ap.add_argument("--tide", default="mean"); ap.add_argument("--dtm-file")
a = ap.parse_args()

g = tv.load()
if a.dtm_file: g["dtm_bare"] = np.load(a.dtm_file).astype(np.float32)
zf, burnf, dtmf = tv.build(g, cap=a.cap, cap_built=a.cap_built, burn_drains=not a.no_drain_burn, smooth_built_sigma=a.smooth_built)
H0, W0 = zf.shape
if a.box is None:
    from pyproj import Transformer
    from common import grid_spec, CRS
    T, W, H = grid_spec()
    tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    def rc(lon, lat):
        x, y = tr.transform(lon, lat); c, r = ~T * (x, y); return int(r), int(c)
    r0, c0 = rc(80.16, 13.075); r1, c1 = rc(80.275, 12.885)
else:
    r0, r1, c0, c1 = a.box
S = (slice(r0, r1), slice(c0, c1))
z = zf[S].astype(np.float64); burn = burnf[S]; lc = g["landcover"][S].copy(); sea = g["sea"][S]
bd = g["burn_depth"][S]; dtm0 = g["dtm_bare"][S].astype(np.float64)
if a.no_drain_burn:   # dropped drains become ordinary land cells again
    dropped = g["waterway"][S] & ~burn
    lc[dropped] = LC["urban"]
edge = np.zeros(z.shape, bool); edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
edge |= g["outlet_edge"][S]
edge &= ~sea
outl = sea | edge
lcfg = CFG["landcover"]
n = np.full(z.shape, lcfg["manning"]["urban"])
for k, v in lcfg["manning"].items():
    if k in LC: n[lc == LC[k]] = v
n2 = (n * n).astype(np.float32); z32 = z.astype(np.float32)
loss = np.zeros(z.shape)
for k, v in lcfg["infiltration_mm_h"].items(): loss[lc == LC[k]] += v / 1000 / 3600
loss[np.isin(lc, [LC["urban"], LC["road"], LC["building"]])] += a.drainage / 1000 / 3600
tide = CFG["tide"][f"{a.tide}_m"]
h = np.zeros(z.shape)
h[burn] = np.clip(dtm0[burn] - z[burn], 0.0, bd[burn])
outlet_h = np.zeros(z.shape); outlet_h[outl] = np.maximum(tide - z[outl], 0.0); h[outl] = outlet_h[outl]
rain = fm.front_loaded(a.mm, 24)
spin = 7200.0; total = spin + a.hours * 3600
Hh, Ww = z.shape
qx = np.zeros((Hh, Ww - 1), np.float32); qy = np.zeros((Hh - 1, Ww), np.float32)
fac = np.ones(z.shape); hmax = np.zeros(z.shape); t15 = np.full(z.shape, -1.0); row = np.zeros((Hh, 6)); hbuf = np.empty(z.shape)
inflow = np.zeros(z.shape)
nsnap = int(a.hours); snaps = np.zeros((nsnap, Hh, Ww), np.float32)
t = 0.0; hmd = float(h.max()); next_snap = spin + 3600; si = 0; steps = 0; hstart = None; w0 = time.time()
vin = vsea = vloss = 0.0; V0 = float(h[~outl].sum() * 900)
while t < total - 1e-6:
    dt = min(CFG["solver"]["max_dt_s"], a.alpha * 30.0 / math.sqrt(G * max(hmd, 0.01)))
    dt = min(dt, total - t, next_snap - t if next_snap > t else dt)
    ts = t - spin
    rm = (rain[int(ts // 3600)] if 0 <= ts < 24 * 3600 else 0.0) / 1000 / 3600 * dt
    fm.momentum(h, z32, qx, qy, n2, dt, 30.0, G, CFG["solver"]["h_dry_m"])
    fm.limit_outflow(h, qx, qy, fac, dt, 30.0)
    fm.continuity(h, qx, qy, fac, z, outl, outlet_h, rm, loss, inflow, 0.0, dt, 30.0, max(ts, 0) / 3600, 0.15 if ts >= 0 else 1e9,
                  hmax, t15, row, hbuf, edge)
    if ts < 0:
        hmax[:] = 0.0
    elif hstart is None:
        hstart = h.astype(np.float32)
    vsea += row[:, 0].sum() * 900; vloss += row[:, 1].sum() * 900; vin += row[:, 2].sum() * 900
    hmd = row[:, 4].max(); t += dt; steps += 1
    if abs(t - next_snap) < 1e-6 and si < nsnap:
        snaps[si] = h; si += 1; next_snap += 3600
V1 = float(h[~outl].sum() * 900)
hmax[outl] = 0
info = dict(tag=a.tag, args=vars(a), box=[r0, r1, c0, c1], steps=steps, wall_s=round(time.time() - w0, 1),
            mass_err_pct=100 * (V0 + vin - vsea - vloss - V1) / max(vin, 1))
np.savez_compressed(SP / f"{a.tag}.npz", hmax=hmax.astype(np.float32), hstart=hstart, snaps=snaps[:si].astype(np.float16), box=np.array([r0, r1, c0, c1]))
print(json.dumps(info))
