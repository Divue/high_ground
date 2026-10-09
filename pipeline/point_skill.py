"""Point-level skill on GCC official observation points (2015 hotspots with depth in feet; stagnation points)
vs random points on GCC roads. AUC of each predictor (sampled as the max within 60 m of the point).
Used to choose a sound validation metric (reviewer finding: street hit rate rewards patchy maps)."""
import json, sys
import numpy as np
import geopandas as gpd
from scipy import ndimage as ndi, stats
from rasterio.features import rasterize
import scoring
from common import CRS, OUT, RAW, WORK, grid_spec

T, W, H = grid_spec()
land, dtm = scoring._land_and_dtm()
water = scoring._BASE["water"]
def cells(gdf):
    x = gdf.geometry.x.values; y = gdf.geometry.y.values
    c = ((x - T.c) / T.a).astype(int); r = ((y - T.f) / T.e).astype(int)
    ok = (r >= 2) & (r < H - 2) & (c >= 2) & (c < W - 2)
    return r[ok], c[ok], ok
def local_max(grid):  # 60 m neighbourhood: tolerate geolocation error of points
    return ndi.maximum_filter(np.where(water, -1e9, grid), size=5)
hot = scoring._read_kml(RAW / "validation" / "gcc_hotspots_2015.kml").to_crs(CRS)
stag = scoring._read_kml(RAW / "validation" / "gcc_stagnation_2015.kml").to_crs(CRS)
hot = hot[hot.geometry.geom_type == "Point"]; stag = stag[stag.geometry.geom_type == "Point"]
# random road points inside GCC as the comparison set
lines = gpd.read_file(WORK / "osm.gpkg", layer="lines")
roads = lines[lines["highway"].isin(scoring.ROADS)].to_crs(CRS)
rng = np.random.default_rng(7)
pts = roads.sample(6000, random_state=7).geometry.interpolate(rng.random(6000), normalized=True)
rnd = gpd.GeoDataFrame(geometry=pts, crs=CRS)
rr, rc, _ = cells(rnd)
inside = land[rr, rc]
rr, rc = rr[inside], rc[inside]
preds = {}
for run in sys.argv[1:] or ["dec2015_reservoir", "design_200_mean"]:
    for d in (OUT / "runs" / run, OUT / "runs_v1" / run):
        if (d / "hmax.npy").exists():
            preds[f"model {run}" + (" (v1)" if "runs_v1" in str(d) else "")] = local_max(np.load(d / "hmax.npy"))
            break
preds["low elevation (-DTM)"] = local_max(-dtm)
tpi = dtm - ndi.median_filter(dtm, size=11)
preds["local hollow (-relief 330 m)"] = local_max(-tpi)
burn = np.load(WORK / "waterway.npy")
preds["near a channel (-distance)"] = -ndi.distance_transform_edt(~burn)
preds["random"] = rng.random(dtm.shape)
out = {}
for name, pts_ in (("GCC 2015 hotspots", hot), ("GCC 2015 stagnation points", stag)):
    r, c, _ = cells(pts_)
    keep = land[r, c] | ndi.binary_dilation(land, iterations=2)[r, c]
    r, c = r[keep], c[keep]
    row = {"n_points": int(len(r))}
    for k, g in preds.items():
        a, b = g[r, c], g[rr, rc]
        u = stats.mannwhitneyu(a, b, alternative="two-sided").statistic
        row[k] = round(float(u / (len(a) * len(b))), 3)
    out[name] = row
# depth agreement at hotspots that report a depth in feet
if "inundation_ft" in hot.columns:
    ft = hot["inundation_ft"].astype(str).str.extract(r"([\d.]+)", expand=False).astype(float)
    r, c, ok = cells(hot)
    for k in [k for k in preds if k.startswith("model")]:
        v = preds[k][r, c]; f = ft.values[ok]
        m = np.isfinite(f) & (f > 0)
        if m.sum() > 10:
            out.setdefault("hotspot depth (feet) rank correlation", {})[k] = dict(
                spearman=round(float(stats.spearmanr(f[m], v[m]).statistic), 3), n=int(m.sum()))
print(json.dumps(out, indent=1))
json.dump(out, open("/home/tekiru/Desktop/highground/review/validation-v3/point_skill.json", "w"), indent=1)
