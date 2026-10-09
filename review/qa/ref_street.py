"""QA reference: reproduce the frontend's nearestSegment + segmentValues from data/out/web JSON.
Usage: python ref_street.py '<json [[name, lon, lat], ...]>' <run>"""
import base64, json, math, sys
from pathlib import Path
WEB = Path('/home/tekiru/Desktop/highground/data/out/web')
idx = json.loads((WEB / 'streets/index.json').read_text())


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


def nearest(lon, lat):
    pad = 0.004
    best = None
    for t, (w, s, e, n) in idx['tile_bounds_lonlat'].items():
        if not (w - pad <= lon <= e + pad and s - pad <= lat <= n + pad):
            continue
        g = json.loads((WEB / f'streets/geom/{t}.json').read_text())
        for i, (sid, name, hw, br, flat) in enumerate(g['segs']):
            pen = (25 if hw == 'service' else 0) + (0 if name else 40)
            for j in range(0, len(flat) - 3, 2):
                d = pointSegM(lon, lat, flat[j], flat[j + 1], flat[j + 2], flat[j + 3]) + pen
                if best is None or d < best[0]:
                    best = (d, t, i, sid, name or 'Unnamed street', hw, br)
    return best


pts = json.loads(sys.argv[1])
run = sys.argv[2]
for name, lon, lat in pts:
    b = nearest(lon, lat)
    if not b:
        print(json.dumps({'q': name, 'none': True}))
        continue
    d, t, i, sid, sname, hw, br = b
    v = json.loads((WEB / f'streets/{run}/{t}.json').read_text())
    ser = list(base64.b64decode(v['series'][i]))
    t15 = next((k + 1 for k, x in enumerate(ser) if x >= 15), None)
    peak = max(ser) if ser else 0
    print(json.dumps({'q': name, 'seg': sid, 'tile': t, 'idx': i, 'street': sname, 'hw': hw, 'bridge': br, 'dist_m': round(d),
                      'max': v['max'][i], 'json_t15': v['t15'][i], 'series_t15_hour': t15, 'series_peak': peak,
                      'peak_hour': ser.index(peak) + 1 if peak else None, 'series': ser}))
