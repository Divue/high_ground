"""Diff the two rain frames written by rain_diff.mjs (the map is still; only rain should move)."""
import numpy as np
from PIL import Image
a = np.asarray(Image.open("../review/p5-dev/rain_a.png").convert("RGB")).astype(int)
b = np.asarray(Image.open("../review/p5-dev/rain_b.png").convert("RGB")).astype(int)
d = np.abs(a - b).sum(axis=2)
print(f"pixels changed between frames: {(d > 6).sum()} ({100 * (d > 6).mean():.2f}%), max change {d.max()}")
