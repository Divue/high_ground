"""04_streets: per-road-segment depth and time-to-15 cm for every scenario.

Roads (OSM highway=*) are split into pieces of at most 120 m and sampled every
10 m. For each scenario and segment:
  max_cm   : depth exceeded on the deepest 10% of the segment (p90 of samples), cm
  t15_h    : hours after the storm starts when 10% of the segment reaches 15 cm (-1 never)
  series   : hourly p90 depth, cm, capped at 255 (base64 uint8)
Bridges and flyovers sample nothing from the channel/ground beneath and are reported
as deck (0 cm) with `bridge` = 1.

Output (served from S3 / CloudFront):
  data/out/web/streets/index.json
  data/out/web/streets/geom/<tile>.json      segments in the tile
  data/out/web/streets/<run>/<tile>.json     values per scenario, aligned with geom
"""
from __future__ import annotations

import base64
import json
from collections import defaultdict

import geopandas as gpd
import numpy as np
from pyproj import Transformer
from shapely.ops import substring

from common import CFG, CRS, OUT, WORK, grid_spec, write_json

ROADS = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
    "service", "living_street", "road", "motorway_link", "trunk_link", "primary_link",
    "secondary_link", "tertiary_link",
}
PIECE_M = 120.0
STEP_M = 10.0
TILE_M = 2000.0
WEB = OUT / "web"


def tag(series, key):
    return series.fillna("").str.extract(rf'"{key}"=>"([^"]*)"', expand=False)


def segments():
    lines = gpd.read_file(WORK / "osm.gpkg", layer="lines")
    lines = lines[lines["highway"].isin(ROADS)].to_crs(CRS)
    lines["bridge"] = tag(lines["other_tags"], "bridge").fillna("")
    lines["layer"] = tag(lines["other_tags"], "layer").fillna("0")
    lines["is_bridge"] = (lines["bridge"].isin(["yes", "viaduct"]) |
                          lines["layer"].str.match(r"^[1-9]")).astype(int)
    rows = []
    for osm_id, name, hw, br, geom in zip(lines["osm_id"], lines["name"], lines["highway"],
                                          lines["is_bridge"], lines.geometry):
        if geom is None or geom.is_empty:
            continue
        L = geom.length
        n = max(1, int(np.ceil(L / PIECE_M)))
        for k in range(n):
            piece = substring(geom, k * L / n, (k + 1) * L / n) if n > 1 else geom
            rows.append((f"{osm_id}_{k}", name if isinstance(name, str) else "", hw, br, piece))
    return rows


def main():
    transform, W, H = grid_spec()
    x0, y1 = transform.c, transform.f
    to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    runs = json.loads((OUT / "runs.json").read_text())
    segs = segments()
    print(f"{len(segs)} segments")
    water = (np.load(WORK / "landcover.npy") == 4) | np.load(WORK / "waterway.npy")

    # sample cells
    samples, tiles = [], []
    for sid, name, hw, br, g in segs:
        L = g.length
        d = np.arange(0, L + 1e-6, STEP_M) if L > STEP_M else np.array([L / 2])
        pts = [g.interpolate(t) for t in d]
        xs = np.array([p.x for p in pts])
        ys = np.array([p.y for p in pts])
        c = ((xs - x0) / transform.a).astype(int)
        r = ((ys - y1) / transform.e).astype(int)
        ok = (r >= 0) & (r < H) & (c >= 0) & (c < W)
        r, c = r[ok], c[ok]
        land = ~water[r, c]          # a street sample on a lake/channel cell is a bridge or a mapping offset
        samples.append((r[land], c[land]))
        mid = g.interpolate(0.5, normalized=True)
        tiles.append(f"{int((mid.x - x0) // TILE_M)}_{int((y1 - mid.y) // TILE_M)}")

    by_tile = defaultdict(list)
    for i, t in enumerate(tiles):
        by_tile[t].append(i)

    # geometry per tile
    (WEB / "streets" / "geom").mkdir(parents=True, exist_ok=True)
    tile_bounds = {}
    for t, idx in by_tile.items():
        out = []
        bb = [180.0, 90.0, -180.0, -90.0]
        for i in idx:
            sid, name, hw, br, g = segs[i]
            lon, lat = to_ll.transform(*np.asarray(g.coords).T)
            flat = np.round(np.column_stack([lon, lat]).ravel(), 6).tolist()
            out.append([sid, name, hw, br, flat])
            bb = [min(bb[0], lon.min()), min(bb[1], lat.min()), max(bb[2], lon.max()), max(bb[3], lat.max())]
        tile_bounds[t] = [round(float(v), 5) for v in bb]
        write_json(WEB / "streets" / "geom" / f"{t}.json", {"segs": out})

    # values per run
    seg_max = {}
    for rid in runs:
        d = OUT / "runs" / rid
        hmax = np.load(d / "hmax.npy")
        t15 = np.load(d / "t15.npy")
        snaps = np.load(d / "snapshots_cm.npy", mmap_mode="r")
        nh = snaps.shape[0]
        mx = np.zeros(len(segs), np.int32)
        tt = np.full(len(segs), -1.0)
        series = np.zeros((len(segs), nh), np.uint8)
        for i, (r, c) in enumerate(samples):
            if segs[i][3] or len(r) == 0:          # bridge deck or outside grid
                continue
            mx[i] = int(round(np.percentile(hmax[r, c], 90) * 100))
            tv = t15[r, c]
            tv = np.where(tv < 0, np.inf, tv)
            q = np.percentile(tv, 10)
            tt[i] = round(float(q), 2) if np.isfinite(q) else -1.0
            series[i] = np.clip(np.percentile(snaps[:, r, c], 90, axis=1), 0, 255).astype(np.uint8)
        seg_max[rid] = mx
        (WEB / "streets" / rid).mkdir(parents=True, exist_ok=True)
        for t, idx in by_tile.items():
            write_json(WEB / "streets" / rid / f"{t}.json", {
                "max": mx[idx].tolist(), "t15": tt[idx].tolist(),
                "series": [base64.b64encode(series[i].tobytes()).decode() for i in idx]})
        wet = (mx >= 15).mean()
        print(f"{rid}: {wet*100:.1f}% of segments >= 15 cm")

    write_json(WEB / "streets" / "index.json", {
        "crs": CRS, "origin": [x0, y1], "tile_m": TILE_M, "tiles": sorted(by_tile),
        "tile_bounds_lonlat": tile_bounds,
        "segments": len(segs), "runs": list(runs),
        "fields": {"max": "p90 depth along segment, cm", "t15": "hours after storm start (-1 never)",
                   "series": "hourly p90 depth cm, uint8 base64, capped 255"},
    }, indent=1)
    np.savez_compressed(WORK / "street_samples.npz", max=np.stack([seg_max[r] for r in runs]),
                        runs=np.array(list(runs)))
    print("04_streets done")


if __name__ == "__main__":
    main()
