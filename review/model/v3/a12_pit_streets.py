"""How many street segments that the app calls 'unsafe for cars' (>=30 cm) at 200 mm get that from small closed pits?"""
import json, sys
import numpy as np
from pathlib import Path
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
from common import CRS, OUT, WORK, grid_spec
from pyproj import Transformer
from scipy import ndimage as ndi
SP = Path("/tmp/claude-1000/-home-tekiru-Desktop-highground/55f88bdc-6229-41e3-9e51-dd1ae875e719/scratchpad")
T, W, H = grid_spec(); WEB = OUT/"web"/"streets"
idx = json.loads((WEB/"index.json").read_text()); to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
lc = np.load(WORK/"landcover.npy"); burn = np.load(WORK/"waterway.npy"); sea = np.load(WORK/"sea.npy")
water = (lc == 4) | burn
dep = np.load(SP/"dep_model.npy")
lab, n = ndi.label((dep > 0.05) & ~water & ~sea); sizes = np.bincount(lab.ravel()); sizes[0] = 0
sl = ndi.find_objects(lab)
square = np.zeros(n + 1, bool)
for k, s in enumerate(sl, 1):
    if s is not None and s[0].stop - s[0].start == 3 and s[1].stop - s[1].start == 3 and sizes[k] == 9: square[k] = True
small = sizes <= 12
run = "design_200_mean"
sn = np.load(OUT/"runs"/run/"snapshots_cm.npy"); hs = np.load(OUT/"runs"/run/"h_start.npy")
stand = (hs >= .05) & ~water
peak = sn.max(0)
tot = in_small = in_sq = in_pit = 0
for t in idx["tiles"]:
    g = json.loads((WEB/"geom"/f"{t}.json").read_text()); v = json.loads((WEB/run/f"{t}.json").read_text())
    for i, (sid, name, hw, br, flat) in enumerate(g["segs"]):
        if v["max"][i] < 30 or br: continue
        a = np.array(flat).reshape(-1, 2); x, y = to_utm.transform(a[:, 0], a[:, 1])
        # dense resample of the polyline every 10 m
        seg = np.hypot(np.diff(x), np.diff(y)); cum = np.concatenate([[0], np.cumsum(seg)])
        d = np.arange(0, cum[-1] + 1e-6, 10.0) if cum[-1] > 10 else np.array([cum[-1] / 2])
        xs = np.interp(d, cum, x); ys = np.interp(d, cum, y)
        c = ((xs - T.c) / T.a).astype(int); r = ((ys - T.f) / T.e).astype(int)
        ok = (r >= 0) & (r < H) & (c >= 0) & (c < W); r, c = r[ok], c[ok]
        k = ~water[r, c] & ~stand[r, c]; r, c = r[k], c[k]
        if not len(r): continue
        j = np.argmax(peak[r, c]); L = lab[r[j], c[j]]
        tot += 1; in_pit += L > 0; in_small += bool(L > 0 and small[L]); in_sq += bool(L > 0 and square[L])
out = dict(run=run, segments_ge30cm=tot, deepest_cell_in_closed_pit=round(in_pit / tot, 3),
           deepest_cell_in_pit_le_12_cells=round(in_small / tot, 3), deepest_cell_in_exact_3x3_square_pit=round(in_sq / tot, 3))
print(json.dumps(out)); json.dump(out, open(Path(__file__).with_name("a12_pit_streets.json"), "w"), indent=1)
