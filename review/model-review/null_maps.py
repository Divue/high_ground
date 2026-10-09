"""Reviewer check: does the hit-rate gain over the matched elevation baseline measure *location* skill,
or just map texture? Scores (validation = even wards, same scoring.py code) for:
  model, the model's own wet map displaced by 3-6 km (texture kept, location destroyed),
  random speckle at the same flooded share, matched elevation baseline, and a matched
  local-relief (TPI) baseline that is as patchy as the model."""
import sys, json
import numpy as np
from scipy import ndimage as ndi
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
import scoring
from common import WORK, OUT

data = scoring.prepare()
land, dtm = scoring._land_and_dtm()
water = scoring._BASE["water"]; sea = scoring._BASE["sea"]
wet = (np.load(OUT / "runs" / "dec2015_reservoir" / "hmax.npy") >= 0.15) & ~water
share = float(wet[land].mean())

def score(g, filt=scoring.even, group=None):
    m = scoring.evaluate(g, data, filt, group)
    return dict(hit=round(m["hit_rate"], 3), false=round(m["false_rate"], 3), skill=round(m["skill"], 3),
                flooded_share=round(float(g[land].mean()), 3))

out = {"model": score(wet)}
shifts = [(100, 0), (-100, 0), (0, 100), (0, -100), (170, 0), (-170, 0), (0, 170), (0, -170), (120, 120), (-120, -120)]
rows = []
for dy, dx in shifts:
    g = np.roll(np.roll(wet, dy, 0), dx, 1) & land
    rows.append(score(g))
out["model_displaced_3to6km_mean"] = {k: round(float(np.mean([r[k] for r in rows])), 3) for k in rows[0]}
out["model_displaced_each"] = [dict(shift_cells=s, **r) for s, r in zip(shifts, rows)]
rng = np.random.default_rng(1)
out["random_speckle_same_share"] = score((rng.random(wet.shape) < share) & land)
out["matched_elevation_baseline"] = score(scoring.baseline_grid(share))
tpi = dtm - ndi.median_filter(dtm, size=11)
thr = np.percentile(tpi[land], 100 * share)
out["matched_local_relief_baseline_330m"] = score((tpi <= thr) & land)
# (150 m relief variant dropped: median-filter ties broke the share match)
# segment-length bias: mean number of 30 m cells per reported segment vs unreported
out["note"] = "even wards, hit = >=15 cm on >=30% of sampled length; false = same on unreported OSM roads"
print(json.dumps(out, indent=1))
json.dump(out, open("/home/tekiru/Desktop/highground/review/model-review/null_maps.json", "w"), indent=1)

import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
names = ["model", "model_displaced_3to6km_mean", "random_speckle_same_share",
         "matched_local_relief_baseline_330m", "matched_elevation_baseline"]
labels = ["Model\n(2015 + release)", "Model map shifted\n3–6 km (mean of 10)", "Random speckle\nsame share",
          "Local-relief map\n330 m, same share", "Elevation map\nsame share (Proof)"]
fig, ax = plt.subplots(figsize=(11, 4.8), dpi=110)
x = np.arange(len(names)); w = 0.38
ax.bar(x - w / 2, [out[n]["hit"] * 100 for n in names], w, label="hit rate on reported streets", color="#1C6E9C")
ax.bar(x + w / 2, [out[n]["false"] * 100 for n in names], w, label="same rate on unreported streets", color="#9AA9B0")
for i, n in enumerate(names):
    ax.text(i - w / 2, out[n]["hit"] * 100 + 0.8, f"{out[n]['hit']*100:.0f}", ha="center", fontsize=9)
    ax.text(i + w / 2, out[n]["false"] * 100 + 0.8, f"{out[n]['false']*100:.0f}", ha="center", fontsize=9)
ax.set_xticks(x); ax.set_xticklabels(labels, fontsize=8.5); ax.set_ylabel("% of street segments")
ax.set_title("Held-out (even) wards: the 39% vs 26% headline is matched by maps with no location information")
ax.legend(frameon=False, fontsize=9); ax.spines[["top", "right"]].set_visible(False)
plt.tight_layout(); plt.savefig("/home/tekiru/Desktop/highground/review/model-review/null_maps.png")
