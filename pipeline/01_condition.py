"""01_condition: Copernicus DSM -> approximate bare-earth DTM -> model terrain.

Steps (CLAUDE.md, Stage A 1-4):
 1. Reproject DSM to the 30 m UTM grid.
 2. Mask OSM building footprints, dense trees, bridges/flyovers and unmapped
    tall objects; fill masked cells by inverse-distance interpolation; 5th
    percentile 3x3 filter.
 3. Burn waterways (-2 m).
 4. Re-add buildings as +3 m obstacles (never on road cells) for the solver.
 5. Land cover classes -> infiltration / drainage / Manning's n.
Outputs to data/work/: *.npy grids, GeoTIFFs, and review/p1 hillshade PNGs.
"""
from __future__ import annotations

import numpy as np
import geopandas as gpd
import pandas as pd
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.fill import fillnodata
from rasterio.merge import merge
from rasterio.warp import reproject
from scipy import ndimage as ndi

from common import CFG, CRS, RAW, WORK, grid_spec, review_dir

LC = {"urban": 0, "road": 1, "pervious": 2, "wetland": 3, "water": 4, "building": 5, "sea": 6}

ROAD_TYPES = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
    "service", "living_street", "road", "motorway_link", "trunk_link", "primary_link",
    "secondary_link", "tertiary_link", "pedestrian",
}
ROAD_WIDTH_M = {"motorway": 20, "trunk": 18, "primary": 14, "secondary": 12, "tertiary": 10}


def tag(series: pd.Series, key: str) -> pd.Series:
    """Extract one key from GDAL's other_tags hstore string."""
    pat = rf'"{key}"=>"([^"]*)"'
    return series.fillna("").str.extract(pat, expand=False)


def load_osm():
    gpkg = WORK / "osm.gpkg"
    lines = gpd.read_file(gpkg, layer="lines").to_crs(CRS)
    polys = gpd.read_file(gpkg, layer="multipolygons").to_crs(CRS)
    return lines, polys


def burn(shapes, transform, shape, all_touched=False, dtype="uint8", fill=0):
    shapes = [(g, 1) for g in shapes if g is not None and not g.is_empty]
    if not shapes:
        return np.zeros(shape, dtype=dtype)
    return rasterize(shapes, out_shape=shape, transform=transform, all_touched=all_touched,
                     fill=fill, dtype=dtype)


def fraction(geoms, transform, shape, k=5):
    """Area fraction per cell, by rasterising on a k-times finer grid."""
    fine_t = transform * transform.scale(1 / k, 1 / k)
    fine = burn(geoms, fine_t, (shape[0] * k, shape[1] * k))
    return fine.reshape(shape[0], k, shape[1], k).mean(axis=(1, 3)).astype(np.float32)


def hillshade(z, cell, az=315, alt=45):
    gy, gx = np.gradient(z, cell)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, b = np.radians(az), np.radians(alt)
    hs = np.sin(b) * np.sin(slope) + np.cos(b) * np.cos(slope) * np.cos(a - aspect)
    return np.clip(hs, 0, 1)


def main():
    transform, W, H = grid_spec()
    shape = (H, W)
    cell = CFG["domain"]["cell_m"]
    ccfg = CFG["conditioning"]
    print(f"grid {W}x{H} = {W*H/1e6:.2f} M cells at {cell} m")

    # 1. DSM ------------------------------------------------------------------
    srcs = [rasterio.open(RAW / "dem" / f"{t}.tif") for t in CFG["dem"]["tiles"]]
    mosaic, mtrans = merge(srcs)
    dsm = np.full(shape, np.nan, np.float32)
    reproject(mosaic[0].astype(np.float32), dsm, src_transform=mtrans, src_crs=srcs[0].crs,
              dst_transform=transform, dst_crs=CRS, resampling=Resampling.bilinear,
              dst_nodata=np.nan)
    print("dsm range", np.nanmin(dsm), np.nanmax(dsm))

    # OSM layers ----------------------------------------------------------------
    lines, polys = load_osm()
    lines["bridge"] = tag(lines["other_tags"], "bridge")
    lines["layer"] = tag(lines["other_tags"], "layer")
    polys["water"] = tag(polys["other_tags"], "water")
    polys["wetland"] = tag(polys["other_tags"], "wetland")

    bld = polys[polys["building"].notna()]
    trees = polys[polys["landuse"].isin(["forest", "orchard"]) | polys["natural"].isin(["wood", "scrub"])]
    roads = lines[lines["highway"].isin(ROAD_TYPES)]
    bridges = lines[(lines["bridge"].notna() & (lines["bridge"] != "no"))
                    | (lines["layer"].fillna("0").str.match(r"^[1-9]"))]
    bridges = bridges[bridges["highway"].notna() | bridges["railway"].notna()]
    ww_types = ccfg["burn_waterways"]
    waterways = lines[lines["waterway"].isin(ww_types)]
    polys["waterway"] = tag(polys["other_tags"], "waterway")
    water_polys = polys[(polys["natural"] == "water") | polys["landuse"].isin(["reservoir", "basin"])
                        | (polys["waterway"] == "riverbank")]
    river_polys = water_polys[water_polys["water"].isin(["river", "canal", "stream", "drain"])]
    wetlands = polys[polys["natural"] == "wetland"]
    pervious = polys[polys["leisure"].isin(["park", "garden", "pitch", "golf_course", "nature_reserve", "playground"])
                     | polys["landuse"].isin(["grass", "meadow", "farmland", "recreation_ground", "cemetery",
                                              "village_green", "forest", "orchard", "greenfield", "plant_nursery"])
                     | polys["natural"].isin(["scrub", "grassland", "sand", "beach", "wood", "heath"])]
    print(f"osm: {len(bld)} buildings, {len(roads)} roads, {len(bridges)} bridges, "
          f"{len(waterways)} waterways, {len(water_polys)} water polys, {len(wetlands)} wetlands, "
          f"{len(pervious)} pervious polys")

    # ESA WorldCover 2021 class fractions on the 30 m grid (AWS Open Data) -------
    with rasterio.open(RAW / "worldcover" / "worldcover_2021_chennai.tif") as src:
        wc = src.read(1)
        wc_t, wc_crs = src.transform, src.crs
    def wc_frac(classes):
        f = np.zeros(shape, np.float32)
        reproject(np.isin(wc, classes).astype(np.float32), f, src_transform=wc_t, src_crs=wc_crs,
                  dst_transform=transform, dst_crs=CRS, resampling=Resampling.average)
        return f
    wc_tree = wc_frac([10, 95])                 # tree cover, mangroves
    wc_built = wc_frac([50])
    wc_perv = wc_frac([10, 20, 30, 40, 60])     # tree, shrub, grass, crop, bare
    wc_wet = wc_frac([90, 95])
    wc_water = wc_frac([80])

    # Rasters --------------------------------------------------------------------
    bfrac = fraction(bld.geometry, transform, shape)
    tree_m = burn(trees.geometry, transform, shape).astype(bool) | (wc_tree >= 0.5)
    road_geoms = []
    for hw, g in zip(roads["highway"], roads.geometry):
        road_geoms.append(g.buffer(ROAD_WIDTH_M.get(hw, 7) / 2, cap_style=2))
    road_m = burn(road_geoms, transform, shape, all_touched=True).astype(bool)
    bridge_m = burn([g.buffer(15) for g in bridges.geometry], transform, shape, all_touched=True).astype(bool)
    ww_m = burn(waterways.geometry, transform, shape, all_touched=True).astype(bool)
    # burn depth by waterway type: a 30 m cell stands in for channels of very different size
    bdt = ccfg["burn_depth_by_type"]
    burn_depth = np.zeros(shape, np.float32)
    for wt in sorted(bdt, key=lambda k: bdt[k]):
        g = waterways[waterways["waterway"] == wt].geometry
        burn_depth = np.maximum(burn_depth, burn(g, transform, shape, all_touched=True).astype(np.float32) * bdt[wt])
    rivpoly_m = burn(river_polys.geometry, transform, shape).astype(bool)
    waterpoly_m = burn(water_polys.geometry, transform, shape).astype(bool)
    wet_m = burn(wetlands.geometry, transform, shape).astype(bool)
    perv_m = burn(pervious.geometry, transform, shape).astype(bool)

    # 2. DTM approximation ------------------------------------------------------
    # Unmapped objects: anything standing > 2.5 m above a 7x7 (210 m) morphological opening.
    opened = ndi.grey_opening(np.nan_to_num(dsm, nan=0), size=(7, 7))
    tall = (dsm - opened) > 2.5
    # Copernicus artefacts: deep negative pits on land (quarries / voids)
    pits = dsm < -1.0
    # Dilate canopy by 60 m so the fill draws from open ground, not forest edges.
    tree_d = ndi.binary_dilation(tree_m, iterations=2)
    mask = (bfrac > ccfg["building_mask_fraction"]) | tree_d | bridge_m | tall | pits
    mask &= ~(waterpoly_m & ~bridge_m & ~pits)   # keep water surfaces as measured (except void pits)
    valid = (~mask & np.isfinite(dsm)).astype(np.uint8)
    print(f"masked for DTM: {mask.mean()*100:.1f}% (buildings {np.mean(bfrac>ccfg['building_mask_fraction'])*100:.1f}%, "
          f"trees {tree_m.mean()*100:.1f}%, bridges {bridge_m.mean()*100:.1f}%, tall {tall.mean()*100:.1f}%)")
    filled = fillnodata(np.nan_to_num(dsm, nan=0).copy(), mask=valid, max_search_distance=200, smoothing_iterations=2)
    p = ccfg["percentile_filter"]
    if p.get("method") == "opening":
        # grey opening removes clutter narrower than 3x3 without growing low noise into square pits
        dtm = ndi.grey_opening(filled, size=(p["size"], p["size"])).astype(np.float32)
    else:
        dtm = ndi.percentile_filter(filled, percentile=p["percentile"], size=p["size"]).astype(np.float32)
    # The percentile filter is a clutter filter; it should not move the city relative
    # to the sea. Restore the median open-ground level (unmasked, non-water cells).
    open_ground = valid.astype(bool) & (wc_water < 0.5) & (dsm > 0.5)
    datum_shift = float(np.median((filled - dtm)[open_ground]))
    dtm[dtm > 0.0] += datum_shift
    print(f"datum restore +{datum_shift:.2f} m")

    # Sea: cells at or below 0.2 m connected to the east edge.
    low = dtm <= 0.2
    lab, _ = ndi.label(low)
    east_labels = np.unique(lab[:, -1][lab[:, -1] > 0])
    sea = np.isin(lab, east_labels)
    # keep the sea compact: drop inland low cells far from the east edge (marsh, lakes)
    cols = np.arange(W)[None, :].repeat(H, 0)
    first_land = np.where((~sea).any(axis=1), W - 1 - np.argmax((~sea)[:, ::-1], axis=1), 0)
    sea &= cols > first_land[:, None]
    dtm_bare = dtm.copy()
    dtm_bare[sea] = np.minimum(dtm_bare[sea], 0.0)

    # 3. Burn waterways ---------------------------------------------------------
    burn_m = (ww_m | rivpoly_m) & ~sea
    # Outlets: the sea and the land edge of the rectangle (free outfall, so valleys that
    # drain out of the domain do not become artificial lakes).
    edge = np.zeros(shape, bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    # The Adyar enters through the west edge, so that stretch of edge is not an outlet: otherwise a third
    # of the 2015 reservoir release drained straight back out (review/model-review/outflow_split.json).
    from pyproj import Transformer
    elon, elat = CFG["replays"]["dec2015_reservoir"]["reservoir"]["entry_lonlat"]
    ex, ey = Transformer.from_crs("EPSG:4326", CRS, always_xy=True).transform(elon, elat)
    erow = int((ey - transform.f) / transform.e)
    # v4: closed further south too: 14% of the release still left ~1 km south of the old stretch
    edge[max(erow - 65, 0):erow + 140, 0] = False
    outlet = sea | (edge & ~sea)
    from skimage.morphology import reconstruction
    seed = np.where(outlet, dtm_bare, dtm_bare.max())
    filled = reconstruction(seed, dtm_bare, method="erosion").astype(np.float32)
    # Channel beds follow the sink-filled surface (priority flood from the outlets), so a
    # burnt channel conveys water out instead of pooling in DSM noise pits.
    burn_depth = np.maximum(burn_depth, rivpoly_m.astype(np.float32) * ccfg["burn_depth_m"])
    burn_depth[burn_m & (burn_depth == 0)] = min(bdt.values())
    z = dtm_bare.copy()
    z[burn_m] = filled[burn_m] - burn_depth[burn_m]
    print(f"channel pits raised: {np.mean((filled - dtm_bare)[burn_m] > 0.05)*100:.1f}% of channel cells, "
          f"mean {np.mean((filled - dtm_bare)[burn_m]):.2f} m")
    # Depression cap: real basins (Velachery, Pallikaranai) keep up to `max_depression_m` of
    # ponding depth; deeper pits are DSM artefacts or embankments whose culverts the 30 m
    # DSM cannot see, so their floors are raised to (spill level - max_depression_m).
    dmax = ccfg["max_depression_m"]
    deep = (filled - z > dmax) & ~burn_m & ~sea
    z[deep] = filled[deep] - dmax
    print(f"depression cap {dmax} m: raised {deep.sum()} cells ({deep.mean()*100:.2f}%)")

    # 4. Buildings as obstacles -------------------------------------------------
    obst = (bfrac > ccfg["building_obstacle_fraction"]) & ~road_m & ~burn_m & ~sea
    z[obst] += ccfg["building_obstacle_m"]

    # 5. Land cover ---------------------------------------------------------------
    lc = np.full(shape, LC["urban"], np.uint8)
    lc[perv_m | ((wc_perv >= 0.6) & (bfrac < 0.15))] = LC["pervious"]
    lc[wet_m | (wc_wet >= 0.5)] = LC["wetland"]
    lc[road_m] = LC["road"]
    lc[obst] = LC["building"]
    lc[waterpoly_m | burn_m | (wc_water >= 0.6)] = LC["water"]
    lc[sea] = LC["sea"]

    # Save ------------------------------------------------------------------------
    for name, arr in dict(dsm=dsm, dtm_bare=dtm_bare, z_model=z, landcover=lc, bfrac=bfrac,
                          road=road_m, waterway=burn_m, sea=sea, bridge=bridge_m, outlet_edge=edge & ~sea,
                          burn_depth=burn_depth).items():
        np.save(WORK / f"{name}.npy", arr)
    prof = dict(driver="GTiff", height=H, width=W, count=1, crs=CRS, transform=transform,
                compress="deflate", tiled=True)
    for name, arr in dict(dsm=dsm, dtm_bare=dtm_bare, z_model=z).items():
        with rasterio.open(WORK / f"{name}.tif", "w", dtype="float32", nodata=np.nan, **prof) as dst:
            dst.write(arr.astype(np.float32), 1)
    with rasterio.open(WORK / "landcover.tif", "w", dtype="uint8", **prof) as dst:
        dst.write(lc, 1)

    # Gate checks -------------------------------------------------------------------
    land = ~sea
    stats = {"datum_shift_m": datum_shift,
        "dtm_min": float(np.nanmin(dtm_bare[land])), "dtm_p1": float(np.nanpercentile(dtm_bare[land], 1)),
        "dtm_p99": float(np.nanpercentile(dtm_bare[land], 99)), "dtm_max": float(np.nanmax(dtm_bare[land])),
        "dsm_minus_dtm_on_buildings": float(np.nanmean((dsm - dtm_bare)[bfrac > 0.5])),
        "dsm_minus_dtm_on_open": float(np.nanmean((dsm - dtm_bare)[(bfrac < 0.05) & ~tree_m & land])),
    }
    ring = ndi.binary_dilation(burn_m, iterations=4) & ~ndi.binary_dilation(burn_m, iterations=1) & land
    stats["river_minus_bank_m"] = float(np.nanmean(z[burn_m]) - np.nanmean(z[ring]))
    stats["sea_cells"] = int(sea.sum())
    stats["obstacle_share"] = float(obst.mean())
    print(stats)
    import json
    (WORK / "p1_stats.json").write_text(json.dumps(stats, indent=1))

    # Review images -----------------------------------------------------------------
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    rd = review_dir("p1")
    fig, axes = plt.subplots(1, 2, figsize=(14, 12), dpi=110)
    for ax, arr, title in ((axes[0], np.nan_to_num(dsm), "Copernicus DSM (raw)"),
                           (axes[1], z, "Conditioned model terrain (DTM, rivers burnt, buildings +3 m)")):
        hs = hillshade(arr, cell)
        ax.imshow(hs, cmap="gray", interpolation="nearest")
        ax.imshow(np.clip(arr, -2, 30), cmap="terrain", alpha=0.45, vmin=-2, vmax=30)
        ax.set_title(title)
        ax.axis("off")
    plt.tight_layout()
    plt.savefig(rd / "hillshade_dsm_vs_dtm.png")
    plt.close()

    # Zoom: Adyar through Saidapet/Kotturpuram and Velachery
    from pyproj import Transformer
    tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    def rc(lon, lat):
        x, y = tr.transform(lon, lat)
        c, r = ~transform * (x, y)
        return int(r), int(c)
    r0, c0 = rc(80.19, 13.05)
    r1, c1 = rc(80.29, 12.95)
    fig, axes = plt.subplots(1, 2, figsize=(16, 9), dpi=120)
    for ax, arr, title in ((axes[0], np.nan_to_num(dsm), "DSM zoom: Saidapet–Adyar–Velachery"),
                           (axes[1], z, "Model terrain zoom")):
        sub = arr[r0:r1, c0:c1]
        ax.imshow(hillshade(sub, cell), cmap="gray")
        im = ax.imshow(np.clip(sub, -2, 20), cmap="terrain", alpha=0.5, vmin=-2, vmax=20)
        ax.set_title(title)
        ax.axis("off")
    fig.colorbar(im, ax=axes, shrink=0.6, label="m")
    plt.savefig(rd / "hillshade_zoom_adyar.png")
    plt.close()

    fig, ax = plt.subplots(figsize=(8, 12), dpi=100)
    cmap = matplotlib.colors.ListedColormap(["#888888", "#333333", "#6a9a4a", "#3a7a7a", "#2a6ad0", "#c08060", "#0a2a60"])
    ax.imshow(lc, cmap=cmap, vmin=0, vmax=6, interpolation="nearest")
    ax.set_title("Land cover: urban, road, pervious, wetland, water, building obstacle, sea")
    ax.axis("off")
    plt.savefig(rd / "landcover.png")
    plt.close()
    print("01_condition done")


if __name__ == "__main__":
    main()
