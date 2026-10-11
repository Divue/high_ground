"""Reviewer check 2: why is Velachery drier than T. Nagar? Terrain/landcover/burn/loss diagnostics per place."""
import json, sys
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import CFG, CRS, OUT, WORK, grid_spec
from pyproj import Transformer
from skimage.morphology import reconstruction
T, W, H = grid_spec()
dsm = np.load(WORK/"dsm.npy"); dtm = np.load(WORK/"dtm_bare.npy"); z = np.load(WORK/"z_model.npy")
lc = np.load(WORK/"landcover.npy"); burn = np.load(WORK/"waterway.npy"); bd = np.load(WORK/"burn_depth.npy")
bfrac = np.load(WORK/"bfrac.npy"); road = np.load(WORK/"road.npy"); sea = np.load(WORK/"sea.npy"); edge = np.load(WORK/"outlet_edge.npy")
perm = (lc == 4) | burn
outlet = sea | edge
seed = np.where(outlet, z, z.max()); spill = reconstruction(seed, z.astype(np.float64), method="erosion")
dep = spill - z      # depression depth in the MODEL terrain (what the solver sees)
tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
yy, xx = np.mgrid[0:H, 0:W]
X = T.c + (xx + 0.5) * T.a; Y = T.f + (yy + 0.5) * T.e
PLACES = {"velachery": (12.9791, 80.2209, 1200), "pallikaranai": (12.9395, 80.2125, 1500), "tnagar": (13.0418, 80.2341, 1000),
          "velachery_r1500": (12.9791, 80.2209, 1500), "tnagar_r1500": (13.0418, 80.2341, 1500)}
runs = ["design_100_mean","design_150_mean","design_200_mean","design_300_mean","design_400_mean","dec2015_rain","michaung2023"]
out = {}
for k, (lat, lon, r) in PLACES.items():
    x, y = tr.transform(lon, lat)
    circ = ((X - x) ** 2 + (Y - y) ** 2 <= r * r)
    m = circ & ~sea & ~perm
    d = dict(cells=int(circ.sum()), land_cells=int(m.sum()),
             perm_water_share=round(float(perm[circ].mean()), 3), burnt_share=round(float(burn[circ].mean()), 3),
             burnt_drain_share=round(float((burn & (bd <= 0.41))[circ].mean()), 3),
             dtm_median=round(float(np.median(dtm[m])), 2), dtm_p10=round(float(np.percentile(dtm[m], 10)), 2),
             dtm_p90=round(float(np.percentile(dtm[m], 90)), 2), dtm_std=round(float(dtm[m].std()), 2),
             dsm_minus_dtm=round(float(np.median((dsm - dtm)[m])), 2),
             bfrac_mean=round(float(bfrac[m].mean()), 3), obstacle_share=round(float((lc == 5)[m].mean()), 3),
             lc_urban=round(float((lc == 0)[m].mean()), 3), lc_road=round(float((lc == 1)[m].mean()), 3),
             lc_pervious=round(float((lc == 2)[m].mean()), 3), lc_wetland=round(float((lc == 3)[m].mean()), 3),
             depression_storage_mm=round(float(dep[m].sum() / m.sum() * 1000), 1),
             share_in_depression_gt5cm=round(float((dep[m] > 0.05).mean()), 3),
             share_in_depression_gt15cm=round(float((dep[m] > 0.15).mean()), 3),
             capped_share=round(float(((z - dtm) > 0.05)[m & (lc != 5)].mean()), 3),
             mean_slope_pct=round(float(np.hypot(*np.gradient(dtm, 30.0))[m].mean() * 100), 2))
    for rid in runs:
        hm = np.load(OUT/"runs"/rid/"hmax.npy"); hs = np.load(OUT/"runs"/rid/"h_start.npy")
        mm = m & (hs < 0.05)
        d[f"{rid}_wet15"] = round(float((hm[m] >= 0.15).mean()), 3)
        d[f"{rid}_wet5"] = round(float((hm[m] >= 0.05).mean()), 3)
        d[f"{rid}_p90cm"] = round(float(np.percentile(hm[m], 90) * 100), 1)
    for ver in ("runs_v1", "runs_v2"):
        f = OUT/ver/"design_200_mean"/"hmax.npy"
        if f.exists():
            d[f"{ver}_200_wet15"] = round(float((np.load(f)[m] >= 0.15).mean()), 3)
    out[k] = d
    print(k, json.dumps(d), flush=True)
json.dump(out, open(Path(__file__).with_name("a2_places.json"), "w"), indent=1)
np.save("/tmp/claude-1000/-home-tekiru-Desktop-highground/55f88bdc-6229-41e3-9e51-dd1ae875e719/scratchpad/dep_model.npy", dep.astype(np.float32))
