"""Rebuild the solver terrain from saved conditioning grids (no pipeline files touched), with variants."""
import sys
import numpy as np
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import CFG, WORK
from skimage.morphology import reconstruction

def load():
    g = {k: np.load(WORK / f"{k}.npy") for k in ("dtm_bare", "waterway", "burn_depth", "sea", "outlet_edge", "bfrac", "road", "landcover", "z_model")}
    return g

def build(g, cap=1.0, cap_built=None, burn_drains=True, smooth_built_sigma=None):
    dtm = g["dtm_bare"].astype(np.float32).copy()
    if smooth_built_sigma:
        from scipy import ndimage as ndi
        built = g["bfrac"] > CFG["conditioning"]["building_mask_fraction"]
        sm = ndi.gaussian_filter(dtm, smooth_built_sigma)
        dtm = np.where(built & ~g["sea"] & ~g["waterway"], sm, dtm).astype(np.float32)
    sea = g["sea"]; burn = g["waterway"].copy(); bd = g["burn_depth"].copy()
    if not burn_drains:
        drop = burn & (bd <= 0.41)
        burn &= ~drop
    outlet = sea | g["outlet_edge"]
    seed = np.where(outlet, dtm, dtm.max())
    filled = reconstruction(seed, dtm, method="erosion").astype(np.float32)
    z = dtm.copy()
    z[burn] = filled[burn] - bd[burn]
    capm = np.full(z.shape, cap, np.float32)
    if cap_built is not None:
        capm[g["bfrac"] > CFG["conditioning"]["building_mask_fraction"]] = cap_built
    deep = (filled - z > capm) & ~burn & ~sea
    z[deep] = filled[deep] - capm[deep]
    obst = (g["bfrac"] > CFG["conditioning"]["building_obstacle_fraction"]) & ~g["road"] & ~g["waterway"] & ~sea
    z[obst] += CFG["conditioning"]["building_obstacle_m"]
    return z, burn, dtm

if __name__ == "__main__":
    g = load()
    z, burn, _ = build(g)
    d = np.abs(z - g["z_model"])
    print("max |z_rebuilt - z_model| =", float(d.max()), " cells > 1 mm:", int((d > 1e-3).sum()))
