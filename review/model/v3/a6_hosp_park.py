"""Reviewer check 3c: hospital cut-offs and flyover parking flags with and without the standing-water zeroing."""
import json, sys
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import CRS, OUT, WORK, grid_spec, water_mask
from pyproj import Transformer
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
SP = Path("/tmp/claude-1000/-home-tekiru-Desktop-highground/55f88bdc-6229-41e3-9e51-dd1ae875e719/scratchpad")
T, W, H = grid_spec()
G = OUT/"web"/"graph"
nodes = np.fromfile(G/"nodes.bin", np.float32).reshape(-1, 2); edges = np.fromfile(G/"edges.bin", np.uint32).reshape(-1, 2).astype(np.int64)
ln = np.fromfile(G/"len.bin", np.float32); cls = np.fromfile(G/"cls.bin", np.uint8)
off = np.fromfile(G/"geom_off.bin", np.uint32); geom = np.fromfile(G/"geom.bin", np.float32).reshape(-1, 2)
hosp = json.loads((OUT/"web"/"hospitals.json").read_text()); park = json.loads((OUT/"web"/"parking.json").read_text())
to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
water = (np.load(WORK/"landcover.npy") == 4) | np.load(WORK/"waterway.npy")
def cell(lon, lat):
    x, y = to_utm.transform(lon, lat)
    return int(np.clip((y - T.f) / T.e, 0, H - 1)), int(np.clip((x - T.c) / T.a, 0, W - 1))
def cutoffs(dcm):
    ok = dcm < 30; a, b = edges[ok, 0], edges[ok, 1]; N = len(nodes)
    _, lab = connected_components(coo_matrix((np.ones(len(a)), (a, b)), shape=(N, N)), directed=False)
    art = np.bincount(lab[edges[ok & (cls <= 1), 0]], weights=ln[ok & (cls <= 1)], minlength=lab.max() + 1)
    main = int(np.argmax(art))
    return [int(lab[h["node"]] != main) for h in hosp["hospitals"]]
res = {}
for run in ["design_200_mean", "design_300_mean", "michaung2023", "dec2015_reservoir"]:
    served = np.fromfile(G/f"depth_{run}.bin", np.uint16).astype(np.float32)
    f = SP/f"edge_nomask_{run}.npy"
    r_ = dict(served_cut_off=hosp["runs"][run]["cut_off"], recomputed_cut_off=sum(cutoffs(served)))
    if f.exists():
        nm = np.load(f)
        c2 = cutoffs(nm)
        r_["cut_off_if_standing_water_counted"] = sum(c2)
        r_["newly_cut_hospitals"] = [hosp["hospitals"][i]["name"] for i, (x, y) in enumerate(zip(cutoffs(served), c2)) if y and not x]
    # flyover parking: dry flag uses min of the two end cells' peak; how many ends sit on a cell zeroed by the masks?
    d = OUT/"runs"/run
    hm = np.load(d/"hmax.npy"); wm = water_mask(d)
    flags = park["dry"][run]
    n_fly = n_dry = n_dry_end_masked = n_dry_if_unmasked_wet = 0; examples = []
    for i, c in enumerate(park["candidates"]):
        if c["kind"] != "flyover": continue
        e = int(c["id"][1:]); a, b = off[e], off[e + 1]
        ends = [cell(float(geom[a, 0]), float(geom[a, 1])), cell(float(geom[b - 1, 0]), float(geom[b - 1, 1]))]
        n_fly += 1
        if flags[i]:
            n_dry += 1
            masked = [wm[rc] for rc in ends]
            raw = [hm[rc] * 100 for rc in ends]
            if any(masked): n_dry_end_masked += 1
            if min(raw) >= 30:
                n_dry_if_unmasked_wet += 1; examples.append((c["name"], [round(v) for v in raw], [bool(m) for m in masked], [bool(water[rc]) for rc in ends]))
    r_.update(flyovers=n_fly, flyovers_dry=n_dry, dry_flyovers_with_an_end_on_masked_cell=n_dry_end_masked,
              dry_flyovers_whose_both_ends_have_ge30cm_unmasked=n_dry_if_unmasked_wet, examples=examples[:8])
    res[run] = r_
    print(run, json.dumps(r_), flush=True)
json.dump(res, open(Path(__file__).with_name("a6_hosp_park.json"), "w"), indent=1)
