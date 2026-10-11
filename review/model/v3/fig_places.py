import sys, json
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
import importlib
from common import CRS, OUT, WORK, grid_spec
from pyproj import Transformer
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from matplotlib.patches import Circle
cond = importlib.import_module("01_condition")
SP = Path("/tmp/claude-1000/-home-tekiru-Desktop-highground/55f88bdc-6229-41e3-9e51-dd1ae875e719/scratchpad")
T, W, H = grid_spec(); tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
def rc(lon, lat):
    x, y = tr.transform(lon, lat); c, r = ~T * (x, y); return r, c
r0, c0 = map(int, rc(80.185, 13.06)); r1, c1 = map(int, rc(80.265, 12.93))
S = (slice(r0, r1), slice(c0, c1))
dtm = np.load(WORK/"dtm_bare.npy")[S]; lc = np.load(WORK/"landcover.npy")[S]; burn = np.load(WORK/"waterway.npy")[S]
perm = (lc == 4) | burn
hm = np.load(OUT/"runs"/"design_200_mean"/"hmax.npy")[S]; hs = np.load(OUT/"runs"/"design_200_mean"/"h_start.npy")[S]
dep = np.load(SP/"dep_model.npy")[S]; ng = np.load(SP/"nrsc.npy")[S]; zg = np.load(SP/"gcc_zone.npy")[S]
hsd = cond.hillshade(dtm, 30)
P = {"Velachery": (12.9791, 80.2209, 1200), "Pallikaranai": (12.9395, 80.2125, 1500), "T. Nagar": (13.0418, 80.2341, 1000)}
fig, ax = plt.subplots(1, 5, figsize=(26, 9), dpi=90)
panels = [("Model terrain (DTM), m", np.ma.masked_where(perm, dtm), "terrain", 0, 16),
          ("Closed-pit depth in model terrain, m", np.ma.masked_where(perm | (dep < .05), dep), "magma_r", 0, 1.0),
          ("v3 peak depth, 200 mm (>=15 cm), m", np.ma.masked_where(perm | (hm < .15) | (hs >= .05), hm), "Blues", 0, 1.0),
          ("NRSC 2015 inundation extent", np.ma.masked_where(~ng | perm, ng.astype(float)), "Blues", 0, 1.3),
          ("GCC hazard zone (1 very low .. 5 very high)", np.ma.masked_where((zg == 0) | perm, zg), "YlOrRd", 1, 5)]
for a, (t, arr, cm, lo, hi) in zip(ax, panels):
    a.imshow(hsd, cmap="gray"); im = a.imshow(arr, cmap=cm, vmin=lo, vmax=hi, alpha=.85)
    a.imshow(np.ma.masked_where(~perm, perm), cmap="cool", alpha=.5)
    for nm, (lat, lon, rad) in P.items():
        r, c = rc(lon, lat); a.add_patch(Circle((c - c0, r - r0), rad / 30, fill=False, ec="k", lw=1.5)); a.text(c - c0, r - r0, nm, ha="center", fontsize=9, weight="bold")
    a.set_title(t, fontsize=10); a.axis("off"); fig.colorbar(im, ax=a, shrink=.5)
fig.suptitle("Velachery vs T. Nagar: official sources rank Velachery far wetter; the v3 model floods closed pits of the 30 m terrain (pink = channels/lakes)", fontsize=12)
plt.tight_layout(); plt.savefig("/home/tekiru/Desktop/highground/review/model/v3/places_velachery_tnagar.png"); print("ok")
