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

from common import CFG, CRS, OUT, WORK, grid_spec, permanent_water, write_json

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


def reservoir_story(rid):
    """The documented release assumption (config.yaml) for captions: when it starts and peaks."""
    rc = (CFG.get("replays", {}).get(rid) or {}).get("reservoir")
    if not rc:
        return None
    tl = rc["cusecs_timeline_local"]
    peak = max(c for _, c in tl)
    return dict(peak_cusecs=int(peak), peak_from_local=next(t for t, c in tl if c == peak),
                rising_from_local=next(t for t, c in tl if c >= 10_000), entry_lonlat=rc["entry_lonlat"],
                source=rc.get("source", ""), note="Modelled release; an assumption from the CAG timeline, not a measured flow.")


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
    perm_water = (np.load(WORK / "landcover.npy") == 4) | np.load(WORK / "waterway.npy")
    land = ~sea & ~perm_water
    web_runs = {}
    for rid, info in runs.items():
        d = OUT / "runs" / rid
        full = json.loads((d / "info.json").read_text())
        # the sea is never floodwater: at high tide it holds water above the DTM datum and would
        # otherwise render as a "flooded Bay" in every hourly frame. Land already wet before the storm
        # is shown (hiding it hid the model's deepest riverside streets).
        run_water = permanent_water() | sea
        od = WEB / "water" / rid
        od.mkdir(parents=True, exist_ok=True)
        hmax = np.where(run_water, 0, np.load(d / "hmax.npy"))
        wet_share = float((hmax[land & ~run_water] >= CFG["validation"]["hit_depth_m"]).mean())
        m = to_merc(hmax * 100, transform, mt, Wm, Hm)
        Image.fromarray(np.clip(np.round(m), 0, 255).astype(np.uint8), "L").save(od / "max.png", optimize=True)
        snaps = np.load(d / "snapshots_cm.npy", mmap_mode="r")
        storm_land = land & ~run_water
        wet_hourly = []
        for k in range(snaps.shape[0]):
            sk = np.asarray(snaps[k], np.float32)
            # share of modelled land under >= 15 cm at this hour (same masks as wet_share_15cm)
            wet_hourly.append(round(float((sk[storm_land] >= CFG["validation"]["hit_depth_m"] * 100).mean()), 4))
            m = to_merc(np.where(run_water, 0, sk), transform, mt, Wm, Hm)
            Image.fromarray(np.clip(np.round(m), 0, 255).astype(np.uint8), "L").save(od / f"h{k+1:02d}.png", optimize=True)
        web_runs[rid] = dict(label=info["label"], kind=info["kind"], total_mm=info["total_mm"], tide=info["tide"],
                             hours=int(snaps.shape[0]), start_local=info["start_local"],
                             rain_mm_h=full["rain_mm_h"], drainage_mm_h=info["drainage_mm_h"],
                             wet_share_15cm=round(wet_share, 4), wet_share_15cm_hourly=wet_hourly,
                             reservoir=reservoir_story(rid))
        print(f"water textures {rid}: {snaps.shape[0]} hours")

    write_json(WEB / "water" / "meta.json", dict(
        bbox_lonlat=[w, s, e, n], bbox_mercator=list(mb), width=Wm, height=Hm,
        elev_encoding="elev_m = (R*256+G)/100 - 10", depth_encoding="depth_cm = R (capped at 255)",
        note="Textures are for rendering only. Numbers shown to users come from streets/*.json."), indent=1)
    write_json(WEB / "runs.json", web_runs, indent=1)
    # ANUGA detail view: peak depth in the Velachery box as a coloured, georeferenced image
    ag = OUT / "anuga" / "design_200_mean"
    if (ag / "hmax_grid.npy").exists():
        g = np.load(ag / "hmax_grid.npy")
        g = np.where(perm_water, np.nan, g)
        rr, cc = np.nonzero(np.isfinite(g))
        r0, r1, c0, c1 = rr.min(), rr.max() + 1, cc.min(), cc.max() + 1
        sub = g[r0:r1, c0:c1]
        sub_t = transform * transform.translation(c0, r0)
        from rasterio.transform import array_bounds
        l_, bt, r_, tp = array_bounds(sub.shape[0], sub.shape[1], sub_t)   # west, south, east, north (UTM)
        lw, ls, le, ln = transform_bounds(CRS, "EPSG:4326", l_, bt, r_, tp)
        mt2 = from_bounds(*transform_bounds(CRS, "EPSG:3857", l_, bt, r_, tp), sub.shape[1], sub.shape[0])
        d2 = np.zeros(sub.shape, np.float32)
        reproject(np.nan_to_num(sub).astype(np.float32), d2, src_transform=sub_t, src_crs=CRS, dst_transform=mt2,
                  dst_crs="EPSG:3857", resampling=Resampling.bilinear)
        def colour(d2):
            t = np.clip((d2 - 0.04) / 1.2, 0, 1)
            sh, dp = np.array([0x7F, 0xD3, 0xD8]), np.array([0x1C, 0x6E, 0x9C])
            rgb = (sh[None, None, :] * (1 - t[..., None]) + dp[None, None, :] * t[..., None]).astype(np.uint8)
            alpha = (np.clip((d2 - 0.04) / 0.11, 0, 1) * (150 + 90 * t)).astype(np.uint8)
            return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")

        def to_box(arr):
            out = np.zeros(sub.shape, np.float32)
            reproject(np.nan_to_num(arr).astype(np.float32), out, src_transform=sub_t, src_crs=CRS, dst_transform=mt2,
                      dst_crs="EPSG:3857", resampling=Resampling.bilinear)
            return out

        (WEB / "proof").mkdir(parents=True, exist_ok=True)
        colour(d2).save(WEB / "proof" / "anuga_200mm.png", optimize=True)
        hours = json.loads((ag / "agreement.json").read_text()).get("hours_simulated", 14)
        snaps = np.load(OUT / "runs" / "design_200_mean" / "snapshots_cm.npy", mmap_mode="r")
        fast = np.asarray(snaps[:hours]).max(axis=0)[r0:r1, c0:c1] / 100.0
        fast = np.where(np.isfinite(sub), fast, np.nan)
        colour(to_box(fast)).save(WEB / "proof" / "fast_200mm.png", optimize=True)
        write_json(WEB / "proof" / "anuga_200mm.json", dict(coordinates=[[lw, ln], [le, ln], [le, ls], [lw, ls]],
                                                            hours=hours,
                                                            note=f"Peak depth, 200 mm storm, first {hours} h, both models"), indent=1)
        print("anuga detail image", sub.shape)

    src = OUT / "basemap" / "chennai.pmtiles"
    if src.exists():
        (WEB / "basemap").mkdir(parents=True, exist_ok=True)
        shutil.copy(src, WEB / "basemap" / "chennai.pmtiles")
    print("07_export_tiles done", Wm, Hm)


if __name__ == "__main__":
    main()
