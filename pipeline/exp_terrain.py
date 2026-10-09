"""Build experimental terrain variants from saved intermediates (does not touch z_model.npy)."""
import sys
import numpy as np
from scipy import ndimage as ndi
from skimage.morphology import reconstruction
from common import CFG, WORK

sigma = float(sys.argv[1]) if len(sys.argv) > 1 else 1.5
dtm = np.load(WORK / "dtm_bare.npy"); sea = np.load(WORK / "sea.npy"); edge = np.load(WORK / "outlet_edge.npy")
burn = np.load(WORK / "waterway.npy"); bd = np.load(WORK / "burn_depth.npy"); lc = np.load(WORK / "landcover.npy")
sm = ndi.gaussian_filter(dtm.astype(np.float64), sigma)
sm[sea] = dtm[sea]
outlet = sea | edge
filled = reconstruction(np.where(outlet, sm, sm.max()), sm, method="erosion")
z = sm.copy()
z[burn] = filled[burn] - bd[burn]
dmax = CFG["conditioning"]["max_depression_m"]
deep = (filled - z > dmax) & ~burn & ~sea
z[deep] = filled[deep] - dmax
z[lc == 5] += CFG["conditioning"]["building_obstacle_m"]
np.save(WORK / f"z_model_smooth{sigma:g}.npy", z.astype(np.float32))
f2 = reconstruction(np.where(outlet, z, z.max()), z, method="erosion")
print(f"sigma {sigma}: depression storage {((f2 - z)[~sea & ~edge]).sum() * 900 / 1e6:.1f} Mm3")
