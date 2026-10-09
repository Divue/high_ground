"""Shared scoring for calibration (odd wards) and validation (even wards).

What the data supports (see PROGRESS.md, KML inspection):
- 2015 crowd reports are OSM street ways flagged flooded (positives only, cumulative
  Nov–Dec 2015, no timestamps, biased toward areas with more internet users).
- Each crowd segment carries its OSM way id, so OSM roads in the same wards whose
  ids were never reported form an "unreported" set. Unreported is not the same as
  dry; it is a proxy used only to penalise a model that floods everything.

Metrics per subset:
  hit_rate     share of reported segments with >= 15 cm on >= 30% of their length
  false_rate   same share on unreported segments
  skill        hit_rate - false_rate (Peirce-style; used as the calibration objective)
  lift         hit_rate / false_rate
"""
from __future__ import annotations

import re

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio

from common import CFG, CRS, RAW, WORK, grid_spec

VCFG = CFG["validation"]
CACHE = WORK / "scoring_cache.npz"
ROADS = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
         "living_street", "road", "service", "motorway_link", "trunk_link", "primary_link",
         "secondary_link", "tertiary_link"}


def _read_kml(path):
    frames = [gpd.read_file(path, layer=name) for name, _ in pyogrio.list_layers(path)]
    return gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=frames[0].crs)


def wards():
    w = _read_kml(RAW / "validation" / "gcc_wards_2022.kml").to_crs(CRS)
    w["ward"] = w["Name"].astype(str).str.strip().str.extract(r"(\d+)", expand=False).astype(int)
    return w[["ward", "geometry"]]


def _sample_lines(geoms, transform, W, H, step=5.0):
    idx_seg, idx_cell = [], []
    for i, g in enumerate(geoms):
        if g is None or g.is_empty:
            continue
        L = g.length
        d = np.arange(0, L + 1e-6, step) if L > step else np.array([L / 2])
        pts = [g.interpolate(t) for t in d]
        x = np.array([p.x for p in pts])
        y = np.array([p.y for p in pts])
        c = ((x - transform.c) / transform.a).astype(int)
        r = ((y - transform.f) / transform.e).astype(int)
        ok = (r >= 0) & (r < H) & (c >= 0) & (c < W)
        idx_seg.append(np.full(ok.sum(), i))
        idx_cell.append(r[ok] * W + c[ok])
    return np.concatenate(idx_seg), np.concatenate(idx_cell)


def prepare(force=False):
    if CACHE.exists() and not force:
        return dict(np.load(CACHE, allow_pickle=True))
    transform, W, H = grid_spec()
    wd = wards()
    crowd = _read_kml(RAW / "validation" / "crowd_2015.kml").to_crs(CRS)
    crowd = crowd[crowd["is_flooded"].astype(str) == "1"].copy()
    crowd = crowd.explode(index_parts=False)
    crowd["osm_id"] = crowd["osm_id"].astype(str)

    lines = gpd.read_file(WORK / "osm.gpkg", layer="lines")
    lines = lines[lines["highway"].isin(ROADS)].to_crs(CRS)
    reported_ids = set(crowd["osm_id"])
    unrep = lines[~lines["osm_id"].astype(str).isin(reported_ids)].copy()

    rivers = lines.iloc[0:0]
    allw = gpd.read_file(WORK / "osm.gpkg", layer="lines").to_crs(CRS)
    named = allw[(allw["waterway"] == "river") &
                 allw["name"].fillna("").str.contains("Adyar|Cooum|Koovam|Adayar", flags=re.I)]
    river_union = named.geometry.union_all()

    def attrs(gdf):
        cen = gdf.geometry.representative_point()
        pts = gpd.GeoDataFrame(geometry=cen, crs=CRS)
        j = gpd.sjoin(pts, wd, how="left", predicate="within")
        j = j[~j.index.duplicated()]
        ward = j["ward"].fillna(-1).astype(int).values
        river = (cen.distance(river_union) <= VCFG["river_buffer_m"]).values
        return ward, river

    cw, cr = attrs(crowd)
    uw, ur = attrs(unrep)
    cs, cc = _sample_lines(list(crowd.geometry), transform, W, H)
    us, uc = _sample_lines(list(unrep.geometry), transform, W, H, step=10.0)
    data = dict(c_ward=cw, c_river=cr, c_seg=cs, c_cell=cc, c_n=len(crowd),
                u_ward=uw, u_river=ur, u_seg=us, u_cell=uc, u_n=len(unrep),
                c_len=crowd.length.values, n_named_river_lines=len(named))
    np.savez_compressed(CACHE, **data)
    print(f"scoring cache: {len(crowd)} reported segments, {len(unrep)} unreported OSM roads, "
          f"{len(named)} Adyar/Cooum river lines")
    return data


def flooded_share(wet_flat, seg, cell, n):
    hit = np.bincount(seg, weights=wet_flat[cell].astype(float), minlength=n)
    tot = np.bincount(seg, minlength=n)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(tot > 0, hit / np.maximum(tot, 1), np.nan)


def evaluate(wet: np.ndarray, data: dict, ward_filter, group: str | None = None) -> dict:
    """wet: boolean grid (>= 15 cm). ward_filter: function(ward array) -> bool mask."""
    flat = wet.ravel()
    cs = flooded_share(flat, data["c_seg"], data["c_cell"], int(data["c_n"]))
    us = flooded_share(flat, data["u_seg"], data["u_cell"], int(data["u_n"]))
    cm = ward_filter(data["c_ward"]) & np.isfinite(cs)
    um = ward_filter(data["u_ward"]) & np.isfinite(us)
    if group == "river_driven":
        cm &= data["c_river"]
        um &= data["u_river"]
    elif group == "rain_driven":
        cm &= ~data["c_river"]
        um &= ~data["u_river"]
    thr = VCFG["hit_length_share"]
    hit = float((cs[cm] >= thr).mean()) if cm.any() else float("nan")
    fal = float((us[um] >= thr).mean()) if um.any() else float("nan")
    return dict(hit_rate=hit, false_rate=fal, skill=hit - fal,
                lift=hit / fal if fal and fal > 0 else None,
                reported_segments=int(cm.sum()), unreported_segments=int(um.sum()))


def odd(w):
    return (w > 0) & (w % 2 == 1)


def even(w):
    return (w > 0) & (w % 2 == 0)


def gcc(w):
    return w > 0
