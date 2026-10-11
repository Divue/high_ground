"""QA run 4, B2: compare the card's segment series with the planner's hourly graph-edge depths for the same
road. For each street: graph edges whose sample points lie within 12 m of the segment polyline, their hourly
p90 at hours 1..3 and at the street's t15/peak, vs the card series. Usage: python b2_edge_vs_seg.py run q lon lat ..."""
import json, math, sys, struct, base64
from pathlib import Path
import numpy as np
WEB = Path('/home/tekiru/Desktop/highground/data/out/web'); G = WEB / 'graph'
meta = json.loads((G / 'meta.json').read_text())
nodes = np.fromfile(G / 'nodes.bin', np.float32).reshape(-1, 2)
edges = np.fromfile(G / 'edges.bin', np.uint32).reshape(-1, 2)
goff = np.fromfile(G / 'geom_off.bin', np.uint32); geom = np.fromfile(G / 'geom.bin', np.float32).reshape(-1, 2)
src = Path('/home/tekiru/Desktop/highground/review/qa/ref3.py').read_text().split('runs = json.loads')[0]
ns = {}; exec(src, ns)
def hourly(run):
    ids = np.fromfile(G / f'hourly_{run}_ids.bin', np.uint32); v = np.fromfile(G / f'hourly_{run}.bin', np.uint8)
    H = meta['hourly'][run]['hours']; return ids, v.reshape(H, len(ids))
def peak(run): return np.fromfile(G / f'depth_{run}.bin', np.uint16)
def segdist(px, py, flat):
    return min(ns['pointSegM'](px, py, flat[j], flat[j+1], flat[j+2], flat[j+3]) for j in range(0, len(flat) - 3, 2))
args = sys.argv[1:]
run = args[0]; ids, hv = hourly(run); pk = peak(run); pos = {int(e): k for k, e in enumerate(ids)}
for k in range(1, len(args), 3):
    q, lon, lat = args[k], float(args[k+1]), float(args[k+2])
    d, t, i, sid, name, hw, br, flat = ns['nearest'](lon, lat)
    s = ns['decode'](ns['vals'](run, t)['series'][i])
    t15 = next((h + 1 for h, x in enumerate(s) if x >= 15), None)
    # candidate edges by bbox
    xs, ys = flat[0::2], flat[1::2]
    w, e_, so, n = min(xs) - 0.0005, max(xs) + 0.0005, min(ys) - 0.0005, max(ys) + 0.0005
    cand = np.nonzero((nodes[edges[:, 0], 0] > w - 0.003) & (nodes[edges[:, 0], 0] < e_ + 0.003) & (nodes[edges[:, 0], 1] > so - 0.003) & (nodes[edges[:, 0], 1] < n + 0.003))[0]
    match = []
    for e in cand:
        pts = geom[goff[e]:goff[e + 1]]
        mid = pts[len(pts) // 2]
        if segdist(float(mid[0]), float(mid[1]), flat) < 12 and segdist(float(pts[0][0]), float(pts[0][1]), flat) < 15:
            match.append(int(e))
    print(f'== {run} {q}: seg {sid} {name} series h1..3={s[:3]} t15={t15} max={max(s)}')
    for e in match:
        hv_e = hv[:, pos[e]] if e in pos else None
        print(f'   edge {e}: peak p90 {pk[e]} cm; hourly h1..3 {list(hv_e[:3]) if hv_e is not None else "not in hourly (peak<15)"}'
              + (f'; at t15 {hv_e[t15-1]}' if hv_e is not None and t15 else ''))
