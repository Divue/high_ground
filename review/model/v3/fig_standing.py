import sys, json
import numpy as np
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
import importlib
from common import CRS, OUT, WORK, grid_spec
from pyproj import Transformer
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
cond = importlib.import_module("01_condition")
T, W, H = grid_spec(); tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
dtm = np.load(WORK/"dtm_bare.npy"); lc = np.load(WORK/"landcover.npy"); burn = np.load(WORK/"waterway.npy"); sea = np.load(WORK/"sea.npy")
perm = (lc == 4) | burn
hs = np.load(OUT/"runs"/"design_200_mean"/"h_start.npy"); hm = np.load(OUT/"runs"/"design_200_mean"/"hmax.npy")
stand = (hs >= .05) & ~perm & ~sea
fig, ax = plt.subplots(1, 2, figsize=(18, 13), dpi=90, gridspec_kw=dict(width_ratios=[1, 1.4]))
ax[0].imshow(cond.hillshade(dtm, 30), cmap="gray")
ax[0].imshow(np.ma.masked_where(~perm, perm), cmap="cool", alpha=.6)
ax[0].imshow(np.ma.masked_where(~stand, hm), cmap="autumn_r", vmin=0, vmax=1.5)
ax[0].set_title(f"Land already >=5 cm deep at storm start (yellow-red = peak depth, m): {int(stand.sum())} cells.\nThese are dropped from streets, routing, parking, hospitals, textures and validation", fontsize=10); ax[0].axis("off")
def rc(lon, lat):
    x, y = tr.transform(lon, lat); c, r = ~T * (x, y); return int(r), int(c)
r0, c0 = rc(80.225, 13.085); r1, c1 = rc(80.275, 13.035)   # Nungambakkam / Egmore / Cooum
S = (slice(r0, r1), slice(c0, c1))
ax[1].imshow(cond.hillshade(dtm[S], 30), cmap="gray")
ax[1].imshow(np.ma.masked_where(~perm[S], perm[S]), cmap="cool", alpha=.6)
im = ax[1].imshow(np.ma.masked_where(~stand[S], hm[S]), cmap="autumn_r", vmin=0, vmax=1.5)
w = (hm[S] >= .15) & ~stand[S] & ~perm[S]
ax[1].imshow(np.ma.masked_where(~w, hm[S]), cmap="Blues", vmin=0, vmax=1.5, alpha=.8)
for nm, lon, lat in (("Wallace Garden", 80.2455, 13.0598), ("Montieth Road", 80.2602, 13.0681)):
    r, c = rc(lon, lat); ax[1].plot(c - c0, r - r0, "k^", ms=9); ax[1].text(c - c0 + 3, r - r0, nm, fontsize=9, weight="bold")
ax[1].set_title("Zoom Nungambakkam-Egmore: masked standing-water cells (yellow-red) vs flood shown to users (blue), 200 mm", fontsize=10); ax[1].axis("off")
fig.colorbar(im, ax=ax[1], shrink=.5, label="peak depth (m) the app does not show")
plt.tight_layout(); plt.savefig("/home/tekiru/Desktop/highground/review/model/v3/standing_water_mask.png"); print("ok")
