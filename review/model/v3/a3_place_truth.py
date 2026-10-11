"""Independent evidence per place (GCC zones, NRSC 2015, crowd reports) and a citywide test:
is the model's 200 mm wet pattern explained by local pit storage (rain staying where it falls)?"""
import json, sys
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import CFG, CRS, OUT, RAW, WORK, grid_spec
import scoring
from rasterio.features import rasterize
from pyproj import Transformer
from scipy import ndimage as ndi, stats
SP = Path("/tmp/claude-1000/-home-tekiru-Desktop-highground/55f88bdc-6229-41e3-9e51-dd1ae875e719/scratchpad")
T, W, H = grid_spec()
lc = np.load(WORK/"landcover.npy"); burn = np.load(WORK/"waterway.npy"); sea = np.load(WORK/"sea.npy")
dtm = np.load(WORK/"dtm_bare.npy"); bfrac = np.load(WORK/"bfrac.npy")
perm = (lc == 4) | burn
dep = np.load(SP/"dep_model.npy")
ZR = {"Very Low": 1, "Low": 2, "Moderate": 3, "High": 4, "Very High": 5}
zones = scoring._read_kml(RAW/"validation"/"gcc_hazard_zones.kml").to_crs(CRS)
zones["rank"] = zones["CATEGORY"].map(ZR).fillna(0).astype(int)
zones = zones.sort_values("rank")
zg = rasterize([(g, r) for g, r in zip(zones.geometry, zones["rank"]) if g is not None], out_shape=(H, W), transform=T, fill=0, dtype="uint8")
nr = scoring._read_kml(RAW/"validation"/"inundation_2015.kml").to_crs(CRS)
ng = rasterize([(g, 1) for g in nr.geometry if g is not None], out_shape=(H, W), transform=T, fill=0, dtype="uint8").astype(bool)
np.save(SP/"gcc_zone.npy", zg); np.save(SP/"nrsc.npy", ng)
data = scoring.prepare()
tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
yy, xx = np.mgrid[0:H, 0:W]
X = T.c + (xx + 0.5) * T.a; Y = T.f + (yy + 0.5) * T.e
h200 = np.load(OUT/"runs"/"design_200_mean"/"hmax.npy"); h15 = np.load(OUT/"runs"/"dec2015_reservoir"/"hmax.npy")
cl = np.bincount(data["c_seg"], minlength=int(data["c_n"])).astype(float)
P = {"velachery": (12.9791, 80.2209, 1200), "pallikaranai": (12.9395, 80.2125, 1500), "tnagar": (13.0418, 80.2341, 1000)}
out = {}
for k, (lat, lon, r) in P.items():
    x, y = tr.transform(lon, lat)
    circ = ((X - x) ** 2 + (Y - y) ** 2 <= r * r); m = circ & ~sea & ~perm
    zz = zg[m]
    d = dict(gcc_zoned_share=round(float((zz > 0).mean()), 3),
             gcc_moderate_plus_share_of_zoned=round(float((zz >= 3).sum() / max((zz > 0).sum(), 1)), 3),
             gcc_high_plus_share_of_zoned=round(float((zz >= 4).sum() / max((zz > 0).sum(), 1)), 3),
             gcc_mean_rank=round(float(zz[zz > 0].mean()), 2) if (zz > 0).any() else None,
             nrsc_2015_share=round(float(ng[m].mean()), 3),
             model200_wet15=round(float((h200[m] >= .15).mean()), 3), model2015res_wet15=round(float((h15[m] >= .15).mean()), 3))
    out[k] = d
    print(k, d)
# citywide: 1 km blocks inside GCC land
wd = scoring.wards()
wg = rasterize([(g, w) for g, w in zip(wd.geometry, wd["ward"])], out_shape=(H, W), transform=T, fill=0, dtype="int32")
land = (wg > 0) & ~sea & ~perm
B = 33
rows = []
for i in range(0, H - B, B):
    for j in range(0, W - B, B):
        m = land[i:i+B, j:j+B]
        if m.sum() < 0.6 * B * B:
            continue
        s = (slice(i, i+B), slice(j, j+B))
        rows.append([float((h200[s][m] >= .15).mean()), float((dep[s][m] > .15).mean()), float(np.median(dtm[s][m])),
                     float(ng[s][m].mean()), float((zg[s][m] >= 3).mean()), float(bfrac[s][m].mean()), float((h15[s][m] >= .15).mean())])
a = np.array(rows)
names = ["model200_wet15", "pit_share_gt15cm", "dtm_median", "nrsc2015", "gcc_mod_plus", "building_frac", "model2015_wet15"]
corr = {}
for i in range(1, len(names)):
    corr[f"model200_wet15 vs {names[i]}"] = round(float(stats.spearmanr(a[:, 0], a[:, i]).statistic), 3)
for i in (1, 2, 5):
    corr[f"nrsc2015 vs {names[i]}"] = round(float(stats.spearmanr(a[:, 3], a[:, i]).statistic), 3)
    corr[f"gcc_mod_plus vs {names[i]}"] = round(float(stats.spearmanr(a[:, 4], a[:, i]).statistic), 3)
corr["model2015_wet15 vs nrsc2015"] = round(float(stats.spearmanr(a[:, 6], a[:, 3]).statistic), 3)
corr["model2015_wet15 vs pit_share"] = round(float(stats.spearmanr(a[:, 6], a[:, 1]).statistic), 3)
corr["n_blocks"] = len(a)
# cell level: of wet cells at 200 mm, how many sit in a closed pit of the model terrain (rain stays where it fell)?
wet = (h200 >= .15) & land
corr["wet_cells_in_pit_gt15cm_share"] = round(float((dep[wet] > .15).mean()), 3)
corr["pit_cells_gt15cm_wet_share"] = round(float(wet[(dep > .15) & land].mean()), 3)
corr["nonpit_cells_wet_share"] = round(float(wet[(dep <= .15) & land].mean()), 3)
print(json.dumps(corr, indent=1))
out["citywide_1km_blocks"] = corr
json.dump(out, open(Path(__file__).with_name("a3_place_truth.json"), "w"), indent=1)
np.save(SP/"blocks.npy", a)
