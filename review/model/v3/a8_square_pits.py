"""Square-pit artefact: how many closed pits in the model terrain are 3x3 squares (signature of a 5th-percentile 3x3 = ~minimum filter)?
And how much pit storage would remain if the filter were followed by a 3x3 dilation (= morphological opening)."""
import json, sys
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import OUT, WORK
from scipy import ndimage as ndi
import terrain_variants as tv
from skimage.morphology import reconstruction
SP = Path("/tmp/claude-1000/-home-tekiru-Desktop-highground/55f88bdc-6229-41e3-9e51-dd1ae875e719/scratchpad")
g = tv.load(); lc = g["landcover"]; perm = (lc == 4) | g["waterway"]; sea = g["sea"]
land = ~sea & ~perm & ~g["outlet_edge"]
def pits(z):
    outlet = sea | g["outlet_edge"]
    seed = np.where(outlet, z, z.max()); sp = reconstruction(seed, z.astype(np.float64), method="erosion")
    return sp - z
out = {}
dep = np.load(SP/"dep_model.npy")
lab, n = ndi.label((dep > 0.05) & land)
sizes = np.bincount(lab.ravel())[1:]
sl = ndi.find_objects(lab)
sq = sum(1 for k, s in enumerate(sl) if s is not None and (s[0].stop - s[0].start) == 3 and (s[1].stop - s[1].start) == 3 and sizes[k] == 9)
out["v3_pit_components"] = int(n); out["v3_exact_3x3_square_pits"] = int(sq)
out["v3_pits_le_12_cells_share_of_components"] = round(float((sizes <= 12).mean()), 3)
out["v3_cells_in_pits_le_12_cells_share_of_pit_cells"] = round(float(sizes[sizes <= 12].sum() / sizes.sum()), 3)
out["v3_pit_storage_Mm3"] = round(float(dep[land].sum() * 900 / 1e6), 1)
h200 = np.load(OUT/"runs"/"design_200_mean"/"hmax.npy"); hs = np.load(OUT/"runs"/"design_200_mean"/"h_start.npy")
wet = (h200 >= .15) & land & (hs < .05)
small = np.isin(lab, np.nonzero(sizes <= 12)[0] + 1)
out["v3_200mm_wet_cells_in_small_pits_share"] = round(float(small[wet].mean()), 3)
# opening variant: dilate the filtered DTM on land (water surfaces and sea untouched), rebuild the solver terrain
z_open, _, dtm_open = tv.build(dict(g, dtm_bare=np.where(land | (lc == 0), ndi.grey_dilation(g["dtm_bare"], size=(3, 3)), g["dtm_bare"]).astype(np.float32)))
dep2 = pits(z_open)
lab2, n2 = ndi.label((dep2 > 0.05) & land); s2 = np.bincount(lab2.ravel())[1:]
out["opening_pit_components"] = int(n2); out["opening_pit_storage_Mm3"] = round(float(dep2[land].sum() * 900 / 1e6), 1)
out["opening_share_land_in_pits_gt15cm"] = round(float((dep2[land] > .15).mean()), 3)
out["v3_share_land_in_pits_gt15cm"] = round(float((dep[land] > .15).mean()), 3)
np.save(SP/"dtm_open.npy", dtm_open)
print(json.dumps(out, indent=1))
json.dump(out, open(Path(__file__).with_name("a8_square_pits.json"), "w"), indent=1)
