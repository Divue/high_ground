"""03_anuga_velachery: ANUGA (Geoscience Australia) detail run for Velachery + Pallikaranai.

Timeboxed Stage B. Runs in the separate `anuga` conda env:
    ~/miniforge3/envs/anuga/bin/python 03_anuga_velachery.py design_200_mean

- ~6.5 x 6.6 km box; unstructured triangular mesh, finer (~12 m) in the Velachery
  core, ~20 m elsewhere.
- Same terrain (the conditioned 30 m model terrain, so this is a *numerical*
  cross-check of Stage A, not a new-terrain result), same hyetograph, same
  drainage and infiltration losses.
- Open boundaries: transmissive stage, zero momentum (water may leave the box).
Writes data/out/anuga/<run>/hmax_grid.npy on the Stage A grid window, and
agreement stats (data/out/anuga/<run>/agreement.json).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import CFG, OUT, WORK, grid_spec  # noqa: E402

import anuga  # noqa: E402

BOX = (80.19, 12.925, 80.25, 12.99)         # W, S, E, N
CORE = (80.205, 12.962, 80.235, 12.985)     # Velachery core, refined


def main(run_id="design_200_mean", max_area=400.0, core_area=150.0):
    import importlib
    fm = importlib.import_module("02_fast_model")
    from pyproj import Transformer

    sc = fm.scenario(run_id)
    tr = Transformer.from_crs("EPSG:4326", CFG["domain"]["crs"], always_xy=True)
    transform, W, H = grid_spec()

    def to_xy(lon, lat):
        return tr.transform(lon, lat)

    x0, y0 = to_xy(BOX[0], BOX[1])
    x1, y1 = to_xy(BOX[2], BOX[3])
    cx0, cy0 = to_xy(CORE[0], CORE[1])
    cx1, cy1 = to_xy(CORE[2], CORE[3])
    bounding = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    core = [[cx0, cy0], [cx1, cy0], [cx1, cy1], [cx0, cy1]]

    out = OUT / "anuga" / run_id
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    domain = anuga.create_domain_from_regions(
        bounding, boundary_tags={"south": [0], "east": [1], "north": [2], "west": [3]},
        maximum_triangle_area=max_area, interior_regions=[[core, core_area]],
        use_cache=False, verbose=False)
    domain.set_name("velachery")
    domain.set_datadir(str(out))
    domain.set_minimum_storable_height(0.01)
    domain.set_flow_algorithm("DE0")
    print(f"mesh: {domain.number_of_elements} triangles ({time.time()-t0:.0f} s)")

    # Terrain + parameters sampled from the Stage A grids at triangle centroids
    z = np.load(WORK / "z_model.npy")
    lc = np.load(WORK / "landcover.npy")
    burn = np.load(WORK / "waterway.npy")
    cents = domain.get_centroid_coordinates(absolute=True)
    cols = ((cents[:, 0] - transform.c) / transform.a).astype(int).clip(0, W - 1)
    rows = ((cents[:, 1] - transform.f) / transform.e).astype(int).clip(0, H - 1)

    def bilinear(arr, x, y):
        c = (x - transform.c) / transform.a - 0.5
        r = (y - transform.f) / transform.e - 0.5
        c0 = np.floor(c).astype(int).clip(0, W - 2)
        r0 = np.floor(r).astype(int).clip(0, H - 2)
        fc = (c - c0).clip(0, 1)
        fr = (r - r0).clip(0, 1)
        return ((1 - fr) * ((1 - fc) * arr[r0, c0] + fc * arr[r0, c0 + 1])
                + fr * ((1 - fc) * arr[r0 + 1, c0] + fc * arr[r0 + 1, c0 + 1]))

    domain.set_quantity("elevation", lambda x, y: bilinear(z, x + domain.geo_reference.xllcorner,
                                                           y + domain.geo_reference.yllcorner),
                        location="centroids")
    lcfg = CFG["landcover"]
    names = {0: "urban", 1: "road", 2: "pervious", 3: "wetland", 4: "water", 5: "building", 6: "sea"}
    n = np.array([lcfg["manning"].get(names[int(k)], 0.035) for k in lc[rows, cols]])
    domain.set_quantity("friction", n, location="centroids")
    elev = domain.quantities["elevation"].centroid_values
    stage0 = elev.copy()
    wet0 = burn[rows, cols]
    stage0[wet0] += CFG["conditioning"]["burn_depth_m"]
    domain.set_quantity("stage", stage0, location="centroids")

    bt = anuga.Transmissive_stage_zero_momentum_boundary(domain)
    domain.set_boundary({"south": bt, "east": bt, "north": bt, "west": bt})

    rain = sc["rain_mm_h"]
    spin = 2 * 3600.0
    storm_s = len(rain) * 3600.0

    def rain_rate(t):
        ts = t - spin
        return rain[int(ts // 3600)] / 1000 / 3600 if 0 <= ts < storm_s else 0.0

    anuga.Rate_operator(domain, rate=rain_rate)
    cal = OUT / "calibration.json"
    drain = json.loads(cal.read_text())["drainage_mm_h"] if cal.exists() else lcfg["drainage_mm_h_default"]
    loss = np.zeros(len(n))
    cls = lc[rows, cols]
    loss[np.isin(cls, [0, 1, 5])] += drain / 1000 / 3600
    for k, v in lcfg["infiltration_mm_h"].items():
        code = {v2: k2 for k2, v2 in names.items()}[k]
        loss[cls == code] += v / 1000 / 3600
    loss_q = anuga.Quantity(domain)
    loss_q.set_values(-loss, location="centroids")
    anuga.Rate_operator(domain, rate=loss_q)

    total = spin + storm_s + sc["tail_h"] * 3600.0
    hmax = np.zeros(len(n))
    wall = time.time()
    for t in domain.evolve(yieldstep=600.0, finaltime=total):
        st = domain.quantities["stage"].centroid_values
        h = st - elev
        if t > spin:
            hmax = np.maximum(hmax, h)
        if int(t) % 7200 == 0:
            print(f"  t={t/3600:5.1f} h  wall {time.time()-wall:6.0f} s  max h {h.max():.2f}", flush=True)

    # Rasterise centroid hmax onto the Stage A grid window (mean per cell)
    acc = np.zeros((H, W))
    cnt = np.zeros((H, W))
    np.add.at(acc, (rows, cols), hmax)
    np.add.at(cnt, (rows, cols), 1)
    grid = np.where(cnt > 0, acc / np.maximum(cnt, 1), np.nan)
    np.save(out / "hmax_grid.npy", grid.astype(np.float32))

    fast = np.load(OUT / "runs" / run_id / "hmax.npy")
    m = np.isfinite(grid) & ~burn
    a = grid[m] >= 0.15
    b = fast[m] >= 0.15
    agree = dict(run=run_id, triangles=int(domain.number_of_elements), wall_s=round(time.time() - wall),
                 cells_compared=int(m.sum()),
                 cell_agreement=float((a == b).mean()),
                 csi=float((a & b).sum() / max((a | b).sum(), 1)),
                 anuga_wet_share=float(a.mean()), fast_wet_share=float(b.mean()),
                 depth_corr=float(np.corrcoef(grid[m], fast[m])[0, 1]),
                 median_abs_diff_m=float(np.median(np.abs(grid[m] - fast[m]))),
                 note="Same 30 m terrain and inputs; different numerics (unstructured finite-volume vs local-inertial grid).")
    (out / "agreement.json").write_text(json.dumps(agree, indent=1))
    print(agree)


if __name__ == "__main__":
    main(*(sys.argv[1:2] or ["design_200_mean"]))
