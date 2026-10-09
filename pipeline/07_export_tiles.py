"""07_export_tiles: rasters -> web assets.

  data/out/web/terrain/{z}/{x}/{y}.png   terrain-RGB (Mapbox encoding) from the bare-earth DTM
  data/out/web/water/meta.json           Web-Mercator bbox + texture size
  data/out/web/water/elev.png            ground elevation, 16-bit split across R (high) and G (low):
                                         cm above -10 m  -> elev_m = (R*256+G)/100 - 10
  data/out/web/water/<run>/hNN.png       hourly depth, 8-bit grey, cm (capped 255) — visual only
  data/out/web/water/<run>/max.png       peak depth, same encoding
  data/out/web/runs.json                 scenario index with rain series (for the UI)
  data/out/web/basemap/chennai.pmtiles   Protomaps extract
Exact numbers shown to users come from street JSON, never from these textures.
"""
from __future__ import annotations

import json
import shutil

import mercantile
import numpy as np
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject, transform_bounds

from common import CFG, CRS, OUT, WORK, grid_spec, write_json

WEB = OUT / "web"
TERRAIN_Z = range(8, 15)


def terrain_rgb(elev):
    v = np.round((elev + 10000) * 10).astype(np.int64)
    return np.dstack([(v >> 16) & 255, (v >> 8) & 255, v & 255]).astype(np.uint8)


def export_terrain(dtm, transform):
    w, s, e, n = CFG["domain"]["bbox_wgs84"]
    count = 0
    for z in TERRAIN_Z:
        for t in mercantile.tiles(w, s, e, n, [z]):
            b = mercantile.xy_bounds(t)
            dst = np.zeros((256, 256), np.float32)
            reproject(dtm, dst, src_transform=transform, src_crs=CRS,
                      dst_transform=from_bounds(b.left, b.bottom, b.right, b.top, 256, 256),
                      dst_crs="EPSG:3857", resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=0)
            p = WEB / "terrain" / str(z) / str(t.x)
            p.mkdir(parents=True, exist_ok=True)
            Image.fromarray(terrain_rgb(np.nan_to_num(dst))).save(p / f"{t.y}.png", optimize=True)
            count += 1
    print(f"terrain tiles: {count}")


def merc_grid():
    w, s, e, n = CFG["domain"]["bbox_wgs84"]
    l, b, r, t = transform_bounds("EPSG:4326", "EPSG:3857", w, s, e, n)
    cell = CFG["domain"]["cell_m"] / np.cos(np.radians((s + n) / 2))   # ~30 m on the ground
    Wm = int(np.ceil((r - l) / cell))
    Hm = int(np.ceil((t - b) / cell))
    return from_bounds(l, b, r, t, Wm, Hm), Wm, Hm, (l, b, r, t)


def to_merc(arr, src_t, dst_t, Wm, Hm, resampling=Resampling.bilinear):
    dst = np.zeros((Hm, Wm), np.float32)
    reproject(arr.astype(np.float32), dst, src_transform=src_t, src_crs=CRS, dst_transform=dst_t,
              dst_crs="EPSG:3857", resampling=resampling, dst_nodata=0)
    return dst


def main():
    transform, W, H = grid_spec()
    dtm = np.load(WORK / "dtm_bare.npy").astype(np.float32)
    sea = np.load(WORK / "sea.npy")
    export_terrain(np.where(sea, 0, dtm), transform)

    mt, Wm, Hm, mb = merc_grid()
    w, s, e, n = CFG["domain"]["bbox_wgs84"]
    (WEB / "water").mkdir(parents=True, exist_ok=True)
    elev = to_merc(np.where(sea, 0, dtm), transform, mt, Wm, Hm)
    ev = np.clip(np.round((elev + 10) * 100), 0, 65535).astype(np.uint16)
    rgb = np.dstack([(ev >> 8).astype(np.uint8), (ev & 255).astype(np.uint8), np.zeros_like(ev, np.uint8)])
    Image.fromarray(rgb, "RGB").save(WEB / "water" / "elev.png", optimize=True)
    seam = to_merc(sea.astype(np.float32), transform, mt, Wm, Hm, Resampling.nearest) > 0.5
    Image.fromarray((seam * 255).astype(np.uint8), "L").save(WEB / "water" / "sea.png", optimize=True)

    runs = json.loads((OUT / "runs.json").read_text())
    web_runs = {}
    for rid, info in runs.items():
        d = OUT / "runs" / rid
        full = json.loads((d / "info.json").read_text())
        od = WEB / "water" / rid
        od.mkdir(parents=True, exist_ok=True)
        hmax = np.load(d / "hmax.npy")
        m = to_merc(hmax * 100, transform, mt, Wm, Hm)
        Image.fromarray(np.clip(np.round(m), 0, 255).astype(np.uint8), "L").save(od / "max.png", optimize=True)
        snaps = np.load(d / "snapshots_cm.npy", mmap_mode="r")
        for k in range(snaps.shape[0]):
            m = to_merc(np.asarray(snaps[k], np.float32), transform, mt, Wm, Hm)
            Image.fromarray(np.clip(np.round(m), 0, 255).astype(np.uint8), "L").save(od / f"h{k+1:02d}.png", optimize=True)
        web_runs[rid] = dict(label=info["label"], kind=info["kind"], total_mm=info["total_mm"], tide=info["tide"],
                             hours=int(snaps.shape[0]), start_local=info["start_local"],
                             rain_mm_h=full["rain_mm_h"], drainage_mm_h=info["drainage_mm_h"],
                             wet_share_15cm=round(info["wet_share_15cm"], 4))
        print(f"water textures {rid}: {snaps.shape[0]} hours")

    write_json(WEB / "water" / "meta.json", dict(
        bbox_lonlat=[w, s, e, n], bbox_mercator=list(mb), width=Wm, height=Hm,
        elev_encoding="elev_m = (R*256+G)/100 - 10", depth_encoding="depth_cm = R (capped at 255)",
        note="Textures are for rendering only. Numbers shown to users come from streets/*.json."), indent=1)
    write_json(WEB / "runs.json", web_runs, indent=1)
    src = OUT / "basemap" / "chennai.pmtiles"
    if src.exists():
        (WEB / "basemap").mkdir(parents=True, exist_ok=True)
        shutil.copy(src, WEB / "basemap" / "chennai.pmtiles")
    print("07_export_tiles done", Wm, Hm)


if __name__ == "__main__":
    main()
