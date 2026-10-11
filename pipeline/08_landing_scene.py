"""08_landing_scene: one small file for the landing page's 3D story.

Cuts a box around one Velachery street out of outputs the pipeline already wrote, and packs it into
web/public/landing/scene.json (about 1-3 MB, committed to git so the landing page works without
data/ on the machine that builds the site):

  terrain   ground elevation on a 30 m grid            (from data/out/web/water/elev.png)
  frames    depth on that grid at up to 10 hours,       (from data/out/web/water/<run>/hNN.png,
            from the first hour to the box's peak         visual only, cm capped at 255)
  buildings OSM footprints with a height                (from data/work/osm.gpkg; height from
                                                          building:levels or height tags, else 2-4
                                                          storeys: a drawing default, never shown)
  roads     drivable edges inside the box               (from data/out/web/graph)
  street    the street the app opens on (VELACHERY in web/src/config.ts): name, peak cm, the hour it
            reaches 15 cm and its hourly series          (from data/out/web/streets, the answer card's numbers)
  route     the suggested car route from that street to the nearest dry parking, and the usual
            route that ignores water                    (graph + depth_<run>.bin + parking.json,
                                                          same 20 cm car limit as the app's navigation)

Every number the landing page prints comes from the street and parking records here.

Usage:  python pipeline/08_landing_scene.py [run] [lon lat]
        defaults: michaung2023, the app's Velachery point (80.21951, 12.96762)
"""
from __future__ import annotations

import base64
import json
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

from common import CFG, CRS, OUT, ROOT, WORK, write_json

WEB = OUT / "web"
DEST = ROOT / "web" / "public" / "landing" / "scene.json"
CELL = 30.0
MAX_FRAMES = 10
# the app's car navigation never routes through 20 cm or more (web/src/lib/nav.ts, mode car: block 20)
CAR_BLOCK_CM = 20

run = sys.argv[1] if len(sys.argv) > 1 else "michaung2023"
pt_lon, pt_lat = (float(sys.argv[2]), float(sys.argv[3])) if len(sys.argv) > 3 else (80.21951, 12.96762)

to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
to_merc = Transformer.from_crs(CRS, "EPSG:3857", always_xy=True)


def b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def load_runs():
    runs = json.loads((WEB / "runs.json").read_text())
    if run not in runs:
        sys.exit(f"run {run!r} not in runs.json: {', '.join(runs)}")
    return runs


# ---------------------------------------------------------------- the street (answer-card numbers)
def find_street():
    idx = json.loads((WEB / "streets" / "index.json").read_text())
    best = None
    for t, bb in idx["tile_bounds_lonlat"].items():
        if not (bb[0] - 0.01 <= pt_lon <= bb[2] + 0.01 and bb[1] - 0.01 <= pt_lat <= bb[3] + 0.01):
            continue
        segs = json.loads((WEB / "streets" / "geom" / f"{t}.json").read_text())["segs"]
        for k, (sid, name, hw, br, flat) in enumerate(segs):
            if br:
                continue
            xy = np.array(flat).reshape(-1, 2)
            d = np.hypot((xy[:, 0] - pt_lon) * np.cos(np.radians(pt_lat)), xy[:, 1] - pt_lat).min() * 111_000
            if best is None or d < best[0]:
                best = (d, t, k, sid, name, hw, xy)
    if best is None:
        sys.exit("no street segment near the point")
    d, t, k, sid, name, hw, xy = best
    vals = json.loads((WEB / "streets" / run / f"{t}.json").read_text())
    series = np.frombuffer(base64.b64decode(vals["series"][k]), "<u2").astype(int)
    print(f"street {sid} {name or '(unnamed)'} {d:.0f} m from the point: peak {vals['max'][k]} cm, t15 {vals['t15'][k]}")
    return dict(id=sid, name=name or "", highway=hw, lonlat=xy, peak_cm=int(vals["max"][k]),
                t15_hour=float(vals["t15"][k]), series=series.tolist())


# ---------------------------------------------------------------- graph and routes
def load_graph():
    g = WEB / "graph"
    nodes = np.fromfile(g / "nodes.bin", np.float32).reshape(-1, 2)
    edges = np.fromfile(g / "edges.bin", np.uint32).reshape(-1, 2).astype(np.int64)
    length = np.fromfile(g / "len.bin", np.float32)
    cls = np.fromfile(g / "cls.bin", np.uint8)
    bridge = np.fromfile(g / "bridge.bin", np.uint8)
    off = np.fromfile(g / "geom_off.bin", np.uint32)
    geom = np.fromfile(g / "geom.bin", np.float32).reshape(-1, 2)
    depth = np.fromfile(g / f"depth_{run}.bin", np.uint16)
    return nodes, edges, length, cls, bridge, off, geom, depth


def shortest(nodes, edges, cost, src):
    n = len(nodes)
    a, b = edges[:, 0], edges[:, 1]
    m = coo_matrix((np.concatenate([cost, cost]), (np.concatenate([a, b]), np.concatenate([b, a]))), shape=(n, n)).tocsr()
    dist, pred = dijkstra(m, directed=True, indices=src, return_predecessors=True)
    return dist, pred


def path_nodes(pred, src, dst):
    p = [dst]
    while p[-1] != src:
        q = pred[p[-1]]
        if q < 0:
            return None
        p.append(int(q))
    return p[::-1]


def path_lonlat(p, edges, off, geom):
    key = {}
    for i, (a, b) in enumerate(edges):
        key.setdefault((int(a), int(b)), i)
    out = []
    for u, v in zip(p[:-1], p[1:]):
        i = key.get((u, v))
        rev = False
        if i is None:
            i, rev = key[(v, u)], True
        seg = geom[off[i]:off[i + 1]]
        seg = seg[::-1] if rev else seg
        out.extend(seg.tolist() if not out else seg[1:].tolist())
    return np.array(out)


def routes(street, graph):
    nodes, edges, length, cls, bridge, off, geom, depth = graph
    mid = street["lonlat"][len(street["lonlat"]) // 2]
    used = np.zeros(len(nodes), bool)
    used[edges[cls <= 4].ravel()] = True
    cand = np.nonzero(used)[0]
    k = np.hypot((nodes[cand, 0] - mid[0]) * np.cos(np.radians(mid[1])), nodes[cand, 1] - mid[1]).argmin()
    src = int(cand[k])

    # an edge is closed to cars at 20 cm unless it is a deck; leaving a flooded street is allowed
    # but costs a lot, so the route takes the shortest way out of the water
    wet = (depth >= CAR_BLOCK_CM) & (bridge == 0)
    dist_dry, pred_dry = shortest(nodes, edges, np.where(wet, length * 1000.0, length).astype(np.float64), src)
    dist_any, pred_any = shortest(nodes, edges, length.astype(np.float64), src)

    park = json.loads((WEB / "parking.json").read_text())
    dry = park["dry"][run]
    best = None
    for c, ok in zip(park["candidates"], dry):
        if not ok:
            continue
        if c["kind"] == "flyover":
            e = int(c["id"][1:])
            ends = [int(edges[e, 0]), int(edges[e, 1])]
        else:
            q = np.hypot((nodes[:, 0] - c["lon"]) * np.cos(np.radians(c["lat"])), nodes[:, 1] - c["lat"])
            ends = [int(q.argmin())]
        for nd in ends:
            if np.isfinite(dist_dry[nd]) and (best is None or dist_dry[nd] < best[0]):
                best = (dist_dry[nd], nd, c)
    if best is None:
        sys.exit("no dry parking reachable")
    cost, dst, c = best
    p_dry = path_nodes(pred_dry, src, dst)
    p_any = path_nodes(pred_any, src, dst)
    dry_ll = path_lonlat(p_dry, edges, off, geom)
    any_ll = path_lonlat(p_any, edges, off, geom) if p_any else None
    deck = None
    if c["kind"] == "flyover":
        e = int(c["id"][1:])
        deck = geom[off[e]:off[e + 1]]
    # metres along the suggested route that still cross water over the car limit (the way out of the street)
    wet_m = 0.0
    key = {(int(a), int(b)): i for i, (a, b) in enumerate(edges)}
    for u, v in zip(p_dry[:-1], p_dry[1:]):
        i = key.get((u, v), key.get((v, u)))
        if wet[i]:
            wet_m += float(length[i])
    usual_m = float(dist_any[dst])
    dry_m = float(sum(length[key.get((u, v), key.get((v, u)))] for u, v in zip(p_dry[:-1], p_dry[1:])))
    print(f"parking: {c['name']} ({c['kind']}), suggested route {dry_m:.0f} m ({wet_m:.0f} m through water), usual {usual_m:.0f} m")
    return dict(dry=dry_ll, usual=any_ll, deck=deck, parking=c, dry_m=dry_m, usual_m=usual_m, wet_m=wet_m)


# ---------------------------------------------------------------- rasters
def sampler(meta):
    l, b, r, t = meta["bbox_mercator"]
    W, H = meta["width"], meta["height"]

    def sample(img: np.ndarray, X, Y):
        mx, my = to_merc.transform(X, Y)
        fx = (mx - l) / (r - l) * W - 0.5
        fy = (t - my) / (t - b) * H - 0.5
        x0 = np.clip(np.floor(fx).astype(int), 0, W - 2)
        y0 = np.clip(np.floor(fy).astype(int), 0, H - 2)
        ax = np.clip(fx - x0, 0, 1)
        ay = np.clip(fy - y0, 0, 1)
        v00, v10, v01, v11 = img[y0, x0], img[y0, x0 + 1], img[y0 + 1, x0], img[y0 + 1, x0 + 1]
        return (v00 * (1 - ax) + v10 * ax) * (1 - ay) + (v01 * (1 - ax) + v11 * ax) * ay
    return sample


def main():
    runs = load_runs()
    info = runs[run]
    street = find_street()
    graph = load_graph()
    rt = routes(street, graph)

    # box: street and parking with a margin, square, 4-7 km a side
    pts = np.vstack([street["lonlat"], rt["dry"]])
    ux, uy = to_utm.transform(pts[:, 0], pts[:, 1])
    cx, cy = (ux.min() + ux.max()) / 2, (uy.min() + uy.max()) / 2
    half = float(np.clip(max(ux.max() - ux.min(), uy.max() - uy.min()) / 2 + 900, 2000, 3500))
    x0, y0 = CELL * np.floor((cx - half) / CELL), CELL * np.floor((cy - half) / CELL)
    n = int(np.ceil(2 * half / CELL)) + 1
    print(f"box {2 * half / 1000:.1f} km, grid {n}x{n}")

    def local(lonlat):
        x, y = to_utm.transform(lonlat[:, 0], lonlat[:, 1])
        return np.column_stack([x - x0, y - y0])

    gx, gy = np.meshgrid(x0 + np.arange(n) * CELL, y0 + np.arange(n) * CELL)   # row 0 = south
    meta = json.loads((WEB / "water" / "meta.json").read_text())
    sample = sampler(meta)
    ev = np.asarray(Image.open(WEB / "water" / "elev.png").convert("RGB"), np.float32)
    elev = sample(ev[..., 0] * 256 + ev[..., 1], gx.ravel(), gy.ravel()) / 100 - 10
    seaimg = WEB / "water" / "sea.png"
    if seaimg.exists():
        sea = sample(np.asarray(Image.open(seaimg).convert("L"), np.float32), gx.ravel(), gy.ravel()) > 127
        elev = np.where(sea, -1.0, elev)

    # frames from hour 1 to the hour the box holds the most water
    hours = int(info["hours"])
    tot = []
    imgs = {}
    for h in range(1, hours + 1):
        f = WEB / "water" / run / f"h{h:02d}.png"
        if not f.exists():
            continue
        a = sample(np.asarray(Image.open(f).convert("L"), np.float32), gx.ravel(), gy.ravel())
        imgs[h] = a
        tot.append((h, float(a.sum())))
    peak_h = max(tot, key=lambda x: x[1])[0]
    pick = sorted({int(v) for v in np.round(np.linspace(1, peak_h, min(MAX_FRAMES, peak_h)))})
    frames = [np.clip(np.round(imgs[h]), 0, 255).astype(np.uint8) for h in pick]
    print(f"frames at hours {pick} (box peak at hour {peak_h})")

    # roads: every graph edge that touches the box
    nodes, edges, length, cls, bridge, off, geom, depth = graph
    gxy = local(geom.astype(np.float64))
    inside = (gxy[:, 0] >= 0) & (gxy[:, 0] <= 2 * half) & (gxy[:, 1] >= 0) & (gxy[:, 1] <= 2 * half)
    road_pts, road_off, road_cls, road_bridge = [], [0], [], []
    for i in range(len(edges)):
        s, e = off[i], off[i + 1]
        if not inside[s:e].any():
            continue
        road_pts.append(gxy[s:e])
        road_off.append(road_off[-1] + (e - s))
        road_cls.append(int(cls[i]))
        road_bridge.append(int(bridge[i]))
    road_pts = np.vstack(road_pts)
    print(f"{len(road_cls)} road edges")

    # buildings
    import geopandas as gpd
    from shapely.geometry import box as sbox
    clip = sbox(x0, y0, x0 + 2 * half, y0 + 2 * half)
    lon0, lat0 = to_ll.transform(x0 - 200, y0 - 200)
    lon1, lat1 = to_ll.transform(x0 + 2 * half + 200, y0 + 2 * half + 200)
    polys = gpd.read_file(WORK / "osm.gpkg", layer="multipolygons", bbox=(lon0, lat0, lon1, lat1))
    polys = polys[polys["building"].notna()].to_crs(CRS)
    tags = polys["other_tags"].fillna("")
    lv = tags.str.extract(r'"building:levels"=>"([0-9.]+)', expand=False).astype(float)
    ht = tags.str.extract(r'"height"=>"([0-9.]+)', expand=False).astype(float)
    b_pts, b_off, b_h, b_tagged = [], [0], [], []
    for oid, geom_, l_, h_ in zip(polys["osm_way_id"].fillna(polys["osm_id"]), polys.geometry, lv, ht):
        if geom_ is None or geom_.is_empty:
            continue
        g2 = geom_.intersection(clip)
        if g2.is_empty:
            continue
        parts = list(g2.geoms) if g2.geom_type == "MultiPolygon" else [g2] if g2.geom_type == "Polygon" else []
        for p in parts:
            if p.area < 25:
                continue
            ring = np.asarray(p.simplify(1.5).exterior.coords)[:-1]
            if len(ring) < 3:
                continue
            if np.isfinite(h_):
                hh, tagged = float(h_), 1
            elif np.isfinite(l_):
                hh, tagged = float(l_) * 3.2, 1
            else:
                # drawing default only: 2-4 storeys, stable per building
                hh, tagged = 3.2 * (2 + zlib.crc32(str(oid).encode()) % 3), 0
            b_pts.append(ring - [x0, y0])
            b_off.append(b_off[-1] + len(ring))
            b_h.append(min(hh, 120.0))
            b_tagged.append(tagged)
    b_pts = np.vstack(b_pts)
    print(f"{len(b_h)} buildings ({sum(b_tagged)} with a mapped height)")

    q = lambda a: np.clip(np.round(np.asarray(a) * 2), 0, 65535).astype("<u2")   # 0.5 m steps
    street_xy = local(street["lonlat"])
    out = dict(
        version=1,
        note="Landing-page slice of HighGround model outputs. Depth frames are for drawing; the numbers "
             "printed on the page come from 'street' and 'route' (the app's own street and parking records).",
        run=run, run_label=info["label"], total_mm=info["total_mm"], start_local=info.get("start_local"),
        wet_share_15cm=info.get("wet_share_15cm"),
        crs=CRS, origin_utm=[float(x0), float(y0)], size_m=float(2 * half), cell_m=CELL, n=n,
        ground_cm="int16 little-endian, cm, row 0 = south, n*n",
        ground=b64(np.clip(np.round(elev * 100), -32768, 32767).astype("<i2")),
        frame_hours=pick, frames_cm="uint8 per frame, n*n, same layout", frames=[b64(f) for f in frames],
        roads=dict(xy_half_m=b64(q(road_pts)), off=b64(np.array(road_off, "<u4")), cls=b64(np.array(road_cls, "u1")),
                   bridge=b64(np.array(road_bridge, "u1"))),
        buildings=dict(xy_half_m=b64(q(b_pts)), off=b64(np.array(b_off, "<u4")),
                       height_dm=b64(np.clip(np.round(np.array(b_h) * 10), 0, 65535).astype("<u2")),
                       height_mapped=b64(np.array(b_tagged, "u1")),
                       note="height from OSM building:levels or height where mapped, else a 2-4 storey drawing default"),
        street=dict(id=street["id"], name=street["name"], xy=np.round(street_xy, 1).tolist(),
                    peak_cm=street["peak_cm"], t15_hour=street["t15_hour"], series_cm=street["series"]),
        route=dict(dry=np.round(local(rt["dry"]), 1).tolist(),
                   usual=np.round(local(rt["usual"]), 1).tolist() if rt["usual"] is not None else None,
                   deck=np.round(local(rt["deck"].astype(np.float64)), 1).tolist() if rt["deck"] is not None else None,
                   dry_m=round(rt["dry_m"]), usual_m=round(rt["usual_m"]), wet_m=round(rt["wet_m"]),
                   parking=dict(name=rt["parking"]["name"], kind=rt["parking"]["kind"],
                                xy=np.round(local(np.array([[rt["parking"]["lon"], rt["parking"]["lat"]]]))[0], 1).tolist()),
                   rule=f"closed to cars at {CAR_BLOCK_CM} cm, decks stay open (the app's car navigation limit)"),
    )
    write_json(DEST, out)
    print(f"wrote {DEST} ({DEST.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
