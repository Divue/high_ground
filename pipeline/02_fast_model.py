"""02_fast_model: local-inertial 2D shallow-water model (Bates et al. 2010) in numba.

    q^{n+1} = (q^n - g h_f dt dEta/dx) / (1 + g dt n^2 |q^n| / h_f^{7/3})

- Explicit, adaptive timestep dt = alpha * dx / sqrt(g h_max).
- Froude <= 1 cap on unit discharge (stability on the western hills).
- Donor-cell outflow limiter: a cell never sends out more water than it holds,
  so depth never goes negative and mass is conserved exactly (no clipping).
- Rain is a spatially uniform source (hyetograph per scenario); the Chembarambakkam
  release is a point inflow at the Adyar's upstream domain edge.
- Losses: infiltration on pervious cells; storm drains as a uniform mm/h removal
  on urban/road/building cells (the calibration parameter).
- Sea cells are held at the tide level; anything crossing into them leaves the domain.
- Edges of the rectangle are closed (no flux).

Usage:
    python 02_fast_model.py design_200_mean          # one run
    python 02_fast_model.py --all                    # 12 design + 4 replay runs
    python 02_fast_model.py dec2015_reservoir --drainage 15 --tag cal15 --no-snapshots
"""
from __future__ import annotations

import argparse
import json
import math
import time
from datetime import datetime, timedelta

import numba as nb
import numpy as np

from common import CFG, OUT, WORK, grid_spec, review_dir, write_json

LC = {"urban": 0, "road": 1, "pervious": 2, "wetland": 3, "water": 4, "building": 5, "sea": 6}
G = CFG["solver"]["g"]


# ----------------------------------------------------------------------------- kernels
@nb.njit(inline="always", fastmath=True)
def _face_q(q, el, er, zl, zr, nn, gdt, gdtdx, sqrtg, hdry):
    """Branchless float32 face update (vectorises). hf^(1/3) by a rational guess and two
    Halley steps (max relative error 0.7% for 1 mm..60 m) instead of scalar libm cbrt."""
    hf = max(el, er) - max(zl, zr)
    hs = max(hf, hdry)
    c = (np.float32(0.1) + np.float32(1.2) * hs) / (np.float32(1.0) + np.float32(0.45) * hs) + np.float32(0.12)
    c3 = c * c * c
    c = c * (c3 + np.float32(2.0) * hs) / (np.float32(2.0) * c3 + hs)
    c3 = c * c * c
    c = c * (c3 + np.float32(2.0) * hs) / (np.float32(2.0) * c3 + hs)
    qn = (q - gdtdx * hs * (er - el)) / (np.float32(1.0) + gdt * nn * abs(q) / (hs * hs * c))
    qm = hs * sqrtg * math.sqrt(hs)
    qn = max(-qm, min(qm, qn))
    return qn if hf > hdry else np.float32(0.0)


@nb.njit(parallel=True, cache=True, fastmath=True)
def momentum(h, z, qx, qy, n2, dt, dx, g, hdry):
    """Local-inertial momentum on every east (qx) and south (qy) face. z, qx, qy, n2 float32."""
    H, W = h.shape
    gdt = np.float32(g * dt)
    gdtdx = np.float32(g * dt / dx)
    sqrtg = np.float32(math.sqrt(g))
    hd = np.float32(hdry)
    half = np.float32(0.5)
    for i in nb.prange(H):
        for j in range(W - 1):
            qx[i, j] = _face_q(qx[i, j], np.float32(h[i, j]) + z[i, j], np.float32(h[i, j + 1]) + z[i, j + 1],
                               z[i, j], z[i, j + 1], half * (n2[i, j] + n2[i, j + 1]), gdt, gdtdx, sqrtg, hd)
    for i in nb.prange(H - 1):
        for j in range(W):
            qy[i, j] = _face_q(qy[i, j], np.float32(h[i, j]) + z[i, j], np.float32(h[i + 1, j]) + z[i + 1, j],
                               z[i, j], z[i + 1, j], half * (n2[i, j] + n2[i + 1, j]), gdt, gdtdx, sqrtg, hd)


@nb.njit(parallel=True, cache=True)
def limit_outflow(h, qx, qy, fac, dt, dx):
    """Donor-cell limiter factor: a cell never sends out more water than it holds."""
    H, W = h.shape
    for i in nb.prange(H):
        for j in range(W):
            out = 0.0
            if j < W - 1 and qx[i, j] > 0.0:
                out += qx[i, j]
            if j > 0 and qx[i, j - 1] < 0.0:
                out -= qx[i, j - 1]
            if i < H - 1 and qy[i, j] > 0.0:
                out += qy[i, j]
            if i > 0 and qy[i - 1, j] < 0.0:
                out -= qy[i - 1, j]
            od = out * dt / dx
            fac[i, j] = 1.0 if od <= h[i, j] else (h[i, j] / od if od > 0 else 1.0)


@nb.njit(inline="always")
def _lim(q, fa, fb):
    """Scale a face flux by its donor cell's factor (a = west/north cell, b = east/south)."""
    return q * fa if q > 0.0 else q * fb


@nb.njit(parallel=True, cache=True)
def continuity(h, qx, qy, fac, z, sea, outlet_h, rain_m, loss_rate, inflow_d, Q, dt, dx, t_now, thr,
               hmax, t15, row_stats, hn_all):
    """Apply limited fluxes, update depth, sources/sinks, reset sea cells.
    Each cell also stores its own east/south limited flux back (each face written once).
    row_stats[i] = [sea_removed_depth_sum, loss_depth_sum, rain_depth_sum, inflow_depth_sum, max_h]"""
    H, W = h.shape
    for i in nb.prange(H):
        for j in range(W):
            net = 0.0
            if j > 0:
                net += _lim(qx[i, j - 1], fac[i, j - 1], fac[i, j])
            if j < W - 1:
                net -= _lim(qx[i, j], fac[i, j], fac[i, j + 1])
            if i > 0:
                net += _lim(qy[i - 1, j], fac[i - 1, j], fac[i, j])
            if i < H - 1:
                net -= _lim(qy[i, j], fac[i, j], fac[i + 1, j])
            hn_all[i, j] = h[i, j] + net * dt / dx
    for i in nb.prange(H):
        s_sea = 0.0
        s_loss = 0.0
        s_rain = 0.0
        s_in = 0.0
        mh = 0.0
        for j in range(W):
            if j < W - 1:
                qx[i, j] = _lim(qx[i, j], fac[i, j], fac[i, j + 1])
            if i < H - 1:
                qy[i, j] = _lim(qy[i, j], fac[i, j], fac[i + 1, j])
            hn = hn_all[i, j]
            if hn < 0.0:
                hn = 0.0
            if sea[i, j]:
                # outlet cell (sea at tide level, or free-outfall domain edge at h = 0)
                target = outlet_h[i, j]
                s_sea += hn - target
                hn = target
            else:
                hn += rain_m
                s_rain += rain_m
                if inflow_d[i, j] > 0.0:
                    add = inflow_d[i, j] * Q * dt
                    hn += add
                    s_in += add
                lr = loss_rate[i, j] * dt
                if lr > 0.0:
                    l = lr if lr < hn else hn
                    hn -= l
                    s_loss += l
                if hn > hmax[i, j]:
                    hmax[i, j] = hn
                if hn >= thr and t15[i, j] < 0.0:
                    t15[i, j] = t_now
            h[i, j] = hn
            if hn > mh:
                mh = hn
        row_stats[i, 0] = s_sea
        row_stats[i, 1] = s_loss
        row_stats[i, 2] = s_rain
        row_stats[i, 3] = s_in
        row_stats[i, 4] = mh


# ----------------------------------------------------------------------------- scenarios
def front_loaded(total_mm: float, hours: int) -> np.ndarray:
    """Gamma-shaped hyetograph (k=2.5, theta=2.667 h -> mode at hour 4), hourly mm."""
    k, theta = 2.5, 4.0 / 1.5
    t = np.linspace(0, hours, hours * 60 + 1)
    f = t ** (k - 1) * np.exp(-t / theta)
    cum = np.concatenate([[0], np.cumsum((f[1:] + f[:-1]) / 2)])
    hourly = np.diff(cum[::60])
    return total_mm * hourly / hourly.sum()


def era5_scaled(path, start_local: str, hours: int, total_mm: float) -> np.ndarray:
    d = json.loads((WORK.parent.parent / path).read_text())
    locs = d if isinstance(d, list) else [d]
    times = locs[0]["hourly"]["time"]
    p = np.mean([[x or 0.0 for x in loc["hourly"]["precipitation"]] for loc in locs], axis=0)
    i0 = times.index(start_local[:13] + ":00")
    seg = p[i0:i0 + hours]
    return total_mm * seg / seg.sum()


def scenario(run_id: str) -> dict:
    sc = CFG["scenarios"]["design"]
    if run_id.startswith("design_"):
        _, mm, tide = run_id.split("_")
        hy = front_loaded(float(mm), sc["duration_h"])
        return dict(id=run_id, label=f"{mm} mm in 24 h, {tide} tide", rain_mm_h=hy, tail_h=sc["tail_h"],
                    tide=tide, total_mm=float(mm), start_local=None, reservoir=None, kind="design")
    rp = dict(CFG["replays"][run_id])
    if "inherits" in rp:
        base = dict(CFG["replays"][rp["inherits"]])
        base.update({k: v for k, v in rp.items() if k != "inherits"})
        rp = base
    if rp["pattern"] == "front_loaded":
        hy = front_loaded(rp["total_mm"], rp["duration_h"])
    else:
        hy = era5_scaled(rp["era5_file"], rp["start_local"], rp["duration_h"], rp["total_mm"])
    return dict(id=run_id, label=rp["label"], rain_mm_h=hy, tail_h=rp["tail_h"], tide=rp["tide"],
                total_mm=rp["total_mm"], start_local=rp["start_local"], reservoir=rp.get("reservoir"),
                kind="replay")


def reservoir_series(res: dict, start_local: str):
    t0 = datetime.fromisoformat(start_local)
    ts = [(datetime.fromisoformat(t) - t0).total_seconds() for t, _ in res["cusecs_timeline_local"]]
    qs = [c * res["cusec_to_m3s"] for _, c in res["cusecs_timeline_local"]]
    return np.array(ts), np.array(qs)


def all_runs():
    runs = [f"design_{mm}_{tide}" for tide in CFG["scenarios"]["tides"]
            for mm in CFG["scenarios"]["design"]["totals_mm"]]
    return runs + list(CFG["replays"].keys())


# ----------------------------------------------------------------------------- driver
def load_terrain():
    import os
    z = np.load(WORK / os.environ.get("HG_ZMODEL", "z_model.npy")).astype(np.float64)
    lc = np.load(WORK / "landcover.npy")
    sea = np.load(WORK / "sea.npy")
    burn = np.load(WORK / "waterway.npy")
    return z, lc, sea, burn


import os


def run(run_id: str, drainage_mm_h: float | None = None, tag: str | None = None,
        snapshots: bool = True, verbose: bool = True) -> dict:
    sc = scenario(run_id)
    scfg = CFG["solver"]
    lcfg = CFG["landcover"]
    if drainage_mm_h is None:
        cal = OUT / "calibration.json"
        drainage_mm_h = (json.loads(cal.read_text())["drainage_mm_h"] if cal.exists()
                         else lcfg["drainage_mm_h_default"])
    out_id = tag or run_id
    transform, W, H = grid_spec()
    dx = float(CFG["domain"]["cell_m"])
    area = dx * dx

    z, lc, sea_only, burn = load_terrain()
    edge_out = np.load(WORK / "outlet_edge.npy")
    sea = sea_only | edge_out      # every outlet cell; 'sea_out' volume below includes edge outflow
    n = np.full(z.shape, lcfg["manning"]["urban"])
    for k, v in lcfg["manning"].items():
        if k in LC:
            n[lc == LC[k]] = v
    n2 = (n * n).astype(np.float32)
    z32 = z.astype(np.float32)
    loss = np.zeros(z.shape)
    for k, v in lcfg["infiltration_mm_h"].items():
        loss[lc == LC[k]] += v / 1000 / 3600
    urban = np.isin(lc, [LC["urban"], LC["road"], LC["building"]])
    loss[urban] += drainage_mm_h / 1000 / 3600
    tide = CFG["tide"][f"{sc['tide']}_m"]

    # Antecedent state: channels hold water to their measured surface (burn depth),
    # sea at tide. Then a 2-hour dry spin-up lets channels settle before the storm.
    h = np.zeros(z.shape)
    bd_file = WORK / "burn_depth.npy"
    bd = np.load(bd_file) if bd_file.exists() else np.full(z.shape, CFG["conditioning"]["burn_depth_m"])
    # Channels start at their measured water surface (the DSM/DTM level), never above it:
    # filling them to the sink-filled spill level spilled water onto adjacent land before the storm.
    dtm0 = np.load(WORK / "dtm_bare.npy").astype(np.float64)
    h[burn] = np.clip(dtm0[burn] - z[burn], 0.0, bd[burn])
    outlet_h = np.zeros(z.shape)
    outlet_h[sea_only] = np.maximum(tide - z[sea_only], 0.0)
    h[sea] = outlet_h[sea]
    if CFG["solver"].get("antecedent", "dry") == "full" or os.environ.get("HG_ANTECEDENT") == "full":
        # Wet antecedent: closed pockets and tanks already full to their spill level (monsoon season)
        from skimage.morphology import reconstruction
        seed = np.where(sea, z, z.max())
        spill = reconstruction(seed, z, method="erosion")
        h = np.maximum(h, np.where(sea, h, spill - z))
    spinup_s = 2 * 3600.0

    # Reservoir inflow cells
    inflow_unit = np.zeros(z.shape)
    res_t = res_q = None
    if sc["reservoir"]:
        from pyproj import Transformer
        lon, lat = sc["reservoir"]["entry_lonlat"]
        x, y = Transformer.from_crs("EPSG:4326", CFG["domain"]["crs"], always_xy=True).transform(lon, lat)
        c, r = ~transform * (x, y)
        r, c = int(r), int(c)
        rr, cc = np.nonzero(burn[max(r - 40, 0):r + 40, max(c - 40, 0):c + 40])
        rr += max(r - 40, 0)
        cc += max(c - 40, 0)
        k = np.argmin((rr - r) ** 2 + (cc - c) ** 2)
        r, c = rr[k], cc[k]
        cells = np.zeros(z.shape, bool)
        cells[max(r - 1, 0):r + 2, max(c - 1, 0):c + 2] = True
        cells &= burn | (lc == LC["water"])
        if not cells.any():
            cells[r, c] = True
        inflow_unit[cells] = 1.0 / (cells.sum() * area)   # (m/s) per (m3/s)
        res_t, res_q = reservoir_series(sc["reservoir"], sc["start_local"])
        if verbose:
            print(f"reservoir inflow at row {r} col {c} over {cells.sum()} cells, peak {res_q.max():.0f} m3/s")

    rain = sc["rain_mm_h"]
    storm_s = len(rain) * 3600.0
    total_s = spinup_s + storm_s + sc["tail_h"] * 3600.0
    if os.environ.get("HG_MAXHOURS"):          # quick checks only
        total_s = min(total_s, spinup_s + float(os.environ["HG_MAXHOURS"]) * 3600.0)
    nsnap = int((storm_s + sc["tail_h"] * 3600.0) // scfg["snapshot_every_s"])

    qx = np.zeros((H, W - 1), np.float32)
    qy = np.zeros((H - 1, W), np.float32)
    fac = np.ones(z.shape)
    hmax = np.zeros(z.shape)
    t15 = np.full(z.shape, -1.0)
    row = np.zeros((H, 5))
    hbuf = np.empty(z.shape)
    snaps = np.zeros((nsnap, H, W), np.uint16) if snapshots else None

    land = ~sea
    V0 = float(h[land].sum() * area)
    vin_rain = vin_res = vout_sea = vout_loss = 0.0
    t = 0.0
    hmax_dom = float(h.max())
    nsteps = 0
    next_snap = spinup_s + scfg["snapshot_every_s"]
    snap_i = 0
    wall = time.time()
    while t < total_s - 1e-6:
        dt = min(scfg["max_dt_s"], scfg["cfl_alpha"] * dx / math.sqrt(G * max(hmax_dom, 0.01)))
        dt = min(dt, total_s - t, next_snap - t if next_snap > t else dt)
        ts = t - spinup_s
        rate_mm_h = rain[int(ts // 3600)] if 0 <= ts < storm_s else 0.0
        rain_m = rate_mm_h / 1000 / 3600 * dt
        Q = float(np.interp(ts, res_t, res_q, left=0.0, right=0.0)) if (res_t is not None and ts >= 0) else 0.0
        momentum(h, z32, qx, qy, n2, dt, dx, G, scfg["h_dry_m"])
        limit_outflow(h, qx, qy, fac, dt, dx)
        continuity(h, qx, qy, fac, z, sea, outlet_h, rain_m, loss, inflow_unit, Q, dt, dx, max(ts, 0.0) / 3600.0,
                   scfg["wet_threshold_m"] if ts >= 0 else 1e9, hmax, t15, row, hbuf)
        if ts < 0:
            hmax[:] = 0.0   # do not record antecedent channel water during spin-up as storm peaks
            hmax[burn] = 0.0
        vout_sea += row[:, 0].sum() * area
        vout_loss += row[:, 1].sum() * area
        vin_rain += row[:, 2].sum() * area
        vin_res += row[:, 3].sum() * area
        hmax_dom = row[:, 4].max()
        t += dt
        nsteps += 1
        if snapshots and abs(t - next_snap) < 1e-6 and snap_i < nsnap:
            snaps[snap_i] = np.clip(np.round(h * 100), 0, 65535).astype(np.uint16)
            snap_i += 1
            next_snap += scfg["snapshot_every_s"]
        elif not snapshots and t >= next_snap:
            next_snap += scfg["snapshot_every_s"]
        if verbose and nsteps % 5000 == 0:
            print(f"  t={t/3600:6.2f} h  dt={dt:5.2f} s  hmax={hmax_dom:5.2f} m  wall={time.time()-wall:6.0f} s")

    V1 = float(h[land].sum() * area)
    vin = vin_rain + vin_res + V0
    err = (V0 + vin_rain + vin_res - vout_sea - vout_loss - V1)
    err_pct = 100 * err / max(vin_rain + vin_res, 1.0)

    # hmax excludes the permanently wet channel water at its antecedent level
    hmax_storm = hmax.copy()
    hmax_storm[sea] = 0.0
    t15[sea] = -1.0
    d = OUT / "runs" / out_id
    d.mkdir(parents=True, exist_ok=True)
    np.save(d / "hmax.npy", hmax_storm.astype(np.float32))
    np.save(d / "t15.npy", t15.astype(np.float32))
    if snapshots:
        np.save(d / "snapshots_cm.npy", snaps[:snap_i])
    info = dict(id=out_id, scenario=run_id, label=sc["label"], kind=sc["kind"], total_mm=sc["total_mm"],
                tide=sc["tide"], tide_m=tide, drainage_mm_h=drainage_mm_h, start_local=sc["start_local"],
                rain_mm_h=[round(float(x), 3) for x in rain], tail_h=sc["tail_h"],
                hours=snap_i, steps=nsteps, wall_s=round(time.time() - wall, 1),
                volume_m3=dict(initial=V0, final=V1, rain=vin_rain, reservoir=vin_res,
                               sea_outflow=vout_sea, losses=vout_loss, error=err),
                mass_error_pct=err_pct,
                reservoir_peak_m3s=float(res_q.max()) if res_q is not None else 0.0,
                wet_share_15cm=float((hmax_storm[land] >= 0.15).mean()))
    write_json(d / "info.json", info, indent=1)
    if verbose:
        print(f"{out_id}: {nsteps} steps, {info['wall_s']} s wall, mass error {err_pct:.4f}%, "
              f"rain {vin_rain/1e6:.1f} Mm3, res {vin_res/1e6:.1f} Mm3, sea out {vout_sea/1e6:.1f} Mm3, "
              f"losses {vout_loss/1e6:.1f} Mm3, storage {V0/1e6:.1f}->{V1/1e6:.1f} Mm3")
    return info


def plot_run(out_id: str):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import importlib
    cond = importlib.import_module("01_condition")
    d = OUT / "runs" / out_id
    hmax = np.load(d / "hmax.npy")
    z = np.load(WORK / "dtm_bare.npy")
    info = json.loads((d / "info.json").read_text())
    hs = cond.hillshade(z, CFG["domain"]["cell_m"])
    fig, ax = plt.subplots(figsize=(8, 13), dpi=110)
    ax.imshow(hs, cmap="gray")
    m = np.ma.masked_less(hmax, 0.05)
    im = ax.imshow(m, cmap="Blues", vmin=0, vmax=1.5, alpha=0.85)
    fig.colorbar(im, ax=ax, shrink=0.5, label="max depth (m)")
    ax.set_title(f"{info['label']}\ndrainage {info['drainage_mm_h']} mm/h · mass error {info['mass_error_pct']:.3f}% "
                 f"· {info['wet_share_15cm']*100:.1f}% of land ≥15 cm")
    ax.axis("off")
    plt.tight_layout()
    plt.savefig(review_dir("p2") / f"maxdepth_{out_id}.png")
    plt.close()


def update_index():
    runs = {}
    for d in sorted((OUT / "runs").iterdir()):
        f = d / "info.json"
        if f.exists():
            info = json.loads(f.read_text())
            if not info["id"].startswith(("cal", "exp")):
                runs[info["id"]] = {k: info[k] for k in ("label", "kind", "total_mm", "tide", "drainage_mm_h",
                                                          "mass_error_pct", "hours", "wall_s", "wet_share_15cm",
                                                          "start_local")}
    write_json(OUT / "runs.json", runs, indent=1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--drainage", type=float)
    ap.add_argument("--tag")
    ap.add_argument("--no-snapshots", action="store_true")
    a = ap.parse_args()
    ids = all_runs() if a.all else a.runs
    for rid in ids:
        info = run(rid, a.drainage, a.tag, snapshots=not a.no_snapshots)
        plot_run(a.tag or rid)
    update_index()
