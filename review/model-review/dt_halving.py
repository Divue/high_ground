"""Reviewer check: timestep sensitivity on a cropped 150x150 box around Velachery using the
production numba kernels from 02_fast_model.py. cfl_alpha 0.7 (production) vs 0.35 (half dt)."""
import importlib, json, math, sys, time
import numpy as np
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import CFG, WORK, CRS, grid_spec
from pyproj import Transformer
fm = importlib.import_module("02_fast_model")

transform, W, H = grid_spec()
tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
x, y = tr.transform(80.22, 12.98)
c0, r0 = ~transform * (x, y)
r0, c0 = int(r0) - 75, int(c0) - 75
S = np.s_[r0:r0 + 150, c0:c0 + 150]
z = np.load(WORK / "z_model.npy")[S].astype(np.float64)
lc = np.load(WORK / "landcover.npy")[S]
burn = np.load(WORK / "waterway.npy")[S]
dtm = np.load(WORK / "dtm_bare.npy")[S].astype(np.float64)
bd = np.load(WORK / "burn_depth.npy")[S]
LC = fm.LC
lcfg = CFG["landcover"]
n = np.full(z.shape, lcfg["manning"]["urban"])
for k, v in lcfg["manning"].items():
    if k in LC:
        n[lc == LC[k]] = v
n2 = (n * n).astype(np.float32)
loss = np.zeros(z.shape)
for k, v in lcfg["infiltration_mm_h"].items():
    loss[lc == LC[k]] += v / 1000 / 3600
ring = np.zeros(z.shape, bool); ring[0] = ring[-1] = True; ring[:, 0] = ring[:, -1] = True
G, dx, hdry = 9.81, 30.0, CFG["solver"]["h_dry_m"]

def sim(alpha, rain_mm_h=40.0, spin_h=1.0, rain_h=3.0, tail_h=2.0, probes=None):
    h = np.zeros(z.shape)
    h[burn] = np.clip(dtm[burn] - z[burn], 0, bd[burn])
    h[ring] = 0.0
    qx = np.zeros((150, 149), np.float32); qy = np.zeros((149, 150), np.float32)
    fac = np.ones(z.shape); hmax = np.zeros(z.shape); t15 = np.full(z.shape, -1.0)
    row = np.zeros((150, 5)); hbuf = np.empty(z.shape); outlet_h = np.zeros(z.shape); infl = np.zeros(z.shape)
    z32 = z.astype(np.float32)
    total = (spin_h + rain_h + tail_h) * 3600
    t = 0.0; hm = float(h.max()); V0 = h[~ring].sum() * dx * dx; vin = vout = vl = 0.0; steps = 0
    ts_rec = {p: [] for p in (probes or [])}
    while t < total - 1e-9:
        dt = min(CFG["solver"]["max_dt_s"], alpha * dx / math.sqrt(G * max(hm, 0.01)), total - t)
        tt = t - spin_h * 3600
        rate = rain_mm_h if 0 <= tt < rain_h * 3600 else 0.0
        fm.momentum(h, z32, qx, qy, n2, dt, dx, G, hdry)
        fm.limit_outflow(h, qx, qy, fac, dt, dx)
        fm.continuity(h, qx, qy, fac, z, ring, outlet_h, rate / 1000 / 3600 * dt, loss, infl, 0.0, dt, dx,
                      max(tt, 0) / 3600, 0.15 if tt >= 0 else 1e9, hmax, t15, row, hbuf)
        if tt < 0:
            hmax[:] = 0.0
        vout += row[:, 0].sum() * dx * dx; vl += row[:, 1].sum() * dx * dx; vin += row[:, 2].sum() * dx * dx
        hm = row[:, 4].max(); t += dt; steps += 1
        for p in ts_rec:
            ts_rec[p].append((t, h[p]))
    V1 = h[~ring].sum() * dx * dx
    err = 100 * (V0 + vin - vout - vl - V1) / vin
    return dict(h=h.copy(), hmax=hmax.copy(), t15=t15.copy(), steps=steps, mass_err_pct=err, ts=ts_rec)

if __name__ == "__main__":
    inner = ~ring & ~burn & (lc != 4)
    # probes: 4 land cells that end up ponded in a quick look + 1 channel cell
    t0 = time.time()
    A = sim(0.7)
    wetc = np.argwhere(inner & (A["hmax"] > 0.3))
    rng = np.random.default_rng(0)
    probes = [tuple(wetc[i]) for i in rng.choice(len(wetc), 5, replace=False)]
    A = sim(0.7, probes=probes)
    B = sim(0.35, probes=probes)
    C = sim(0.175, probes=probes)
    out = {}
    for name, X in (("alpha_0.35", B), ("alpha_0.175", C)):
        d = (A["hmax"] - X["hmax"])[inner]
        wa, wx = A["hmax"][inner] >= 0.15, X["hmax"][inner] >= 0.15
        ta, tx = A["t15"][inner], X["t15"][inner]
        both = (ta >= 0) & (tx >= 0)
        out[name] = dict(steps=X["steps"], mass_err_pct=X["mass_err_pct"],
                         hmax_mean_abs_diff_cm=float(np.abs(d).mean() * 100), hmax_p99_abs_diff_cm=float(np.percentile(np.abs(d), 99) * 100),
                         hmax_max_abs_diff_cm=float(np.abs(d).max() * 100),
                         final_h_mean_abs_diff_cm=float(np.abs((A["h"] - X["h"])[inner]).mean() * 100),
                         wet15_share_prod=float(wa.mean()), wet15_share_this=float(wx.mean()),
                         wet15_cell_agreement=float((wa == wx).mean()),
                         t15_median_abs_diff_min=float(np.median(np.abs(ta[both] - tx[both])) * 60),
                         t15_p95_abs_diff_min=float(np.percentile(np.abs(ta[both] - tx[both]), 95) * 60))
    out["alpha_0.7"] = dict(steps=A["steps"], mass_err_pct=A["mass_err_pct"])
    # oscillation: total variation of h over the rain-free tail vs net change, per probe
    osc = {}
    for p in probes:
        for name, X in (("0.7", A), ("0.35", B)):
            arr = np.array(X["ts"][p]); tail = arr[arr[:, 0] > 4 * 3600][:, 1]
            osc.setdefault(str(p), {})[name] = dict(tail_total_variation_cm=float(np.abs(np.diff(tail)).sum() * 100),
                                                    tail_net_change_cm=float((tail[-1] - tail[0]) * 100),
                                                    sign_changes=int((np.diff(np.sign(np.diff(tail))) != 0).sum()))
    out["probe_oscillation"] = osc
    out["box"] = dict(row0=int(r0), col0=int(c0), size=150, rain="40 mm/h for 3 h after 1 h spin-up, 2 h dry tail",
                      wall_s=round(time.time() - t0, 1))
    json.dump(out, open("/home/tekiru/Desktop/highground/review/model-review/dt_halving.json", "w"), indent=1)
    print(json.dumps(out, indent=1))
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 3, figsize=(16, 5.4), dpi=100)
    im = ax[0].imshow(np.where(inner, A["hmax"], np.nan), vmin=0, vmax=1, cmap="Blues"); ax[0].set_title("peak depth, cfl_alpha 0.7 (m)"); fig.colorbar(im, ax=ax[0])
    im = ax[1].imshow(np.where(inner, (A["hmax"] - B["hmax"]) * 100, np.nan), vmin=-3, vmax=3, cmap="RdBu"); ax[1].set_title("peak depth difference 0.7 - 0.35 (cm)"); fig.colorbar(im, ax=ax[1])
    for p in probes:
        for name, X, ls in (("0.7", A, "-"), ("0.35", B, "--")):
            arr = np.array(X["ts"][p]); ax[2].plot(arr[:, 0] / 3600, arr[:, 1] * 100, ls, lw=1)
    ax[2].set_xlabel("hours"); ax[2].set_ylabel("depth (cm)"); ax[2].set_title("5 probe cells: solid 0.7, dashed 0.35")
    for a in ax[:2]: a.axis("off")
    plt.tight_layout(); plt.savefig("/home/tekiru/Desktop/highground/review/model-review/dt_halving.png")
