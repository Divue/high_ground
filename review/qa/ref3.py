"""QA run 3 reference: reproduce the answer card from data/out/web (uint16 series aware).
Usage: python ref3.py '<json [{"q":..., "lon":..., "lat":..., "run":...}, ...]>'
Prints one JSON line per query: segment, max, series, t15 hour, peak hour, top dry parking (deduped by name,
as the frontend), nearby share (500 m), and the water frame sampled along the segment vs the series."""
import base64, json, math, struct, sys
from pathlib import Path
import numpy as np
from PIL import Image

WEB = Path('/home/tekiru/Desktop/highground/data/out/web')
idx = json.loads((WEB / 'streets/index.json').read_text())
NB = idx.get('series_bytes', 1)
meta = json.loads((WEB / 'water/meta.json').read_text())
parking = json.loads((WEB / 'parking.json').read_text())
R = 20037508.342789244


def distM(lon1, lat1, lon2, lat2):
    k = math.cos((lat1 + lat2) / 2 * math.pi / 180)
    return math.hypot((lon2 - lon1) * 111320 * k, (lat2 - lat1) * 110540)


def pointSegM(px, py, ax, ay, bx, by):
    k = math.cos(py * math.pi / 180)
    axk, bxk, pxk = ax * k, bx * k, px * k
    dx, dy = bxk - axk, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((pxk - axk) * dx + (py - ay) * dy) / L))
    return distM(px, py, (axk + t * dx) / k, ay + t * dy)


_geo = {}
def geom(t):
    if t not in _geo:
        _geo[t] = json.loads((WEB / f'streets/geom/{t}.json').read_text())
    return _geo[t]


_vals = {}
def vals(run, t):
    k = (run, t)
    if k not in _vals:
        _vals[k] = json.loads((WEB / f'streets/{run}/{t}.json').read_text())
    return _vals[k]


def decode(b64):
    raw = base64.b64decode(b64)
    return list(struct.unpack(f'<{len(raw) // 2}H', raw)) if NB == 2 else list(raw)


def nearest(lon, lat):
    pad = 0.004
    best = None
    for t, (w, s, e, n) in idx['tile_bounds_lonlat'].items():
        if not (w - pad <= lon <= e + pad and s - pad <= lat <= n + pad):
            continue
        for i, (sid, name, hw, br, flat) in enumerate(geom(t)['segs']):
            pen = (25 if hw == 'service' else 0) + (0 if name else 40)
            for j in range(0, len(flat) - 3, 2):
                d = pointSegM(lon, lat, flat[j], flat[j + 1], flat[j + 2], flat[j + 3]) + pen
                if best is None or d < best[0]:
                    best = (d, t, i, sid, name or 'Unnamed street', hw, br, flat)
    return best


def nearby(lon, lat, run, radius=500):
    pad = radius / 100000 + 0.002
    wet = tot = 0
    for t, (w, s, e, n) in idx['tile_bounds_lonlat'].items():
        if not (w - pad <= lon <= e + pad and s - pad <= lat <= n + pad):
            continue
        v = vals(run, t)
        for i, (sid, name, hw, br, flat) in enumerate(geom(t)['segs']):
            if hw == 'service' or br:
                continue
            mid = (len(flat) // 4) * 2
            if distM(lon, lat, flat[mid], flat[mid + 1]) > radius:
                continue
            tot += 1
            if v['max'][i] >= 15:
                wet += 1
    return wet, tot


def park(lon, lat, run):
    flags = parking['dry'][run]
    opts = sorted(({**c, 'd': distM(lon, lat, c['lon'], c['lat'])} for c, f in zip(parking['candidates'], flags) if f == 1),
                  key=lambda c: c['d'])
    seen, out = set(), []
    for c in opts:
        if c['name'] in seen:
            continue
        seen.add(c['name'])
        out.append({'name': c['name'], 'kind': c['kind'], 'd_m': round(c['d'])})
        if len(out) == 3:
            break
    return out


_frames = {}
def frame(run, h):
    k = (run, h)
    if k not in _frames:
        _frames[k] = np.asarray(Image.open(WEB / f'water/{run}/h{h:02d}.png').convert('L'))
    return _frames[k]


def to_px(lon, lat):
    l, b, r, t = meta['bbox_mercator']
    x = lon * R / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) * R / math.pi
    return int((t - y) / (t - b) * meta['height']), int((x - l) / (r - l) * meta['width'])


def frame_series(flat, run, hours):
    # densify the segment every ~10 m and sample each hourly frame; p90 like the pipeline
    pts = []
    for j in range(0, len(flat) - 3, 2):
        a, b = (flat[j], flat[j + 1]), (flat[j + 2], flat[j + 3])
        n = max(1, int(distM(*a, *b) / 10))
        for k in range(n + 1):
            pts.append((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n))
    px = list({to_px(*p) for p in pts})
    out = []
    for h in range(1, hours + 1):
        f = frame(run, h)
        v = [int(f[r, c]) for r, c in px if 0 <= r < f.shape[0] and 0 <= c < f.shape[1]]
        out.append(int(round(np.percentile(v, 90))) if v else None)
    return out


runs = json.loads((WEB / 'runs.json').read_text())
for qd in json.loads(sys.argv[1]):
    b = nearest(qd['lon'], qd['lat'])
    if not b:
        print(json.dumps({**qd, 'none': True})); continue
    d, t, i, sid, sname, hw, br, flat = b
    v = vals(qd['run'], t)
    ser = decode(v['series'][i])
    t15 = next((k + 1 for k, x in enumerate(ser) if x >= 15), None)
    peak = max(ser) if ser else 0
    fs = frame_series(flat, qd['run'], runs[qd['run']]['hours']) if not qd.get('noframes') else None
    diff = [abs(a - min(255, s)) for a, s in zip(fs, ser)] if fs else None
    print(json.dumps({**qd, 'seg': sid, 'street': sname, 'hw': hw, 'bridge': bool(br), 'dist_m': round(d),
                      'max': v['max'][i], 'round_max': round(v['max'][i]), 'json_t15': v['t15'][i], 't15_hour': t15,
                      'peak': peak, 'peak_hour': ser.index(peak) + 1 if peak else None, 'series': ser,
                      'parking': park(qd['lon'], qd['lat'], qd['run']), 'nearby': nearby(qd['lon'], qd['lat'], qd['run']),
                      'frame_p90_series': fs, 'frame_vs_series_max_abs_diff': max(diff) if diff else None,
                      'frame_vs_series_hours_diff_gt10': sum(1 for x in diff if x > 10) if diff else None}))
