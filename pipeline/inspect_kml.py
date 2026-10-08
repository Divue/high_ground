"""Inspect validation KMLs before designing any metric (CLAUDE.md, Validation).

Prints feature count, geometry types, fields and any date/time fields, then plots
the layers over the hillshade -> review/p1/validation_layers.png.
"""
from __future__ import annotations

import json

import geopandas as gpd
import numpy as np
import pyogrio

from common import CFG, CRS, RAW, WORK, grid_spec, review_dir

FILES = ["crowd_2015.kml", "gcc_hazard_zones.kml", "gcc_inundation_points_depth.kml",
         "gcc_hotspots_2015.kml", "gcc_stagnation_2015.kml", "inundation_2015.kml", "gcc_wards_2022.kml"]


def read_all(path):
    frames = []
    for name, _ in pyogrio.list_layers(path):
        df = gpd.read_file(path, layer=name)
        df["_layer"] = name
        frames.append(df)
    import pandas as pd
    return gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=frames[0].crs)


def main():
    report = {}
    layers = {}
    for f in FILES:
        p = RAW / "validation" / f
        gdf = read_all(p)
        layers[f] = gdf
        cols = [c for c in gdf.columns if c not in ("geometry",)]
        time_cols = [c for c in cols if any(k in c.lower() for k in ("date", "time", "when", "timestamp", "begin", "end"))]
        time_cols = [c for c in time_cols if gdf[c].notna().any()]
        info = {
            "features": int(len(gdf)),
            "geometry_types": gdf.geom_type.value_counts().to_dict(),
            "fields": cols,
            "time_fields_with_data": time_cols,
            "bounds": [round(v, 4) for v in gdf.total_bounds],
        }
        for c in ("is_flooded", "CATEGORY", "class", "type", "Name", "DEPTH", "ZONE", "Description"):
            if c in gdf.columns and gdf[c].notna().any():
                vc = gdf[c].astype(str).value_counts()
                info[f"values_{c}"] = vc.head(12).to_dict() if len(vc) < 400 else {"unique": int(len(vc))}
        report[f] = info
        print(f"\n== {f}")
        for k, v in info.items():
            print(f"  {k}: {v}")

    crowd = layers["crowd_2015.kml"].to_crs(CRS)
    if "is_flooded" in crowd:
        fl = crowd[crowd["is_flooded"].astype(str) == "1"]
        report["crowd_2015.kml"]["flooded_length_km"] = float(fl.length.sum() / 1000)
        report["crowd_2015.kml"]["flooded_segments"] = int(len(fl))
        report["crowd_2015.kml"]["segment_length_m_median"] = float(fl.length.median())
    (WORK / "kml_inspection.json").write_text(json.dumps(report, indent=1, default=str))

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import importlib
    cond = importlib.import_module("01_condition")
    transform, W, H = grid_spec()
    z = np.load(WORK / "dtm_bare.npy")
    hs = cond.hillshade(z, CFG["domain"]["cell_m"])
    ext = [transform.c, transform.c + W * transform.a, transform.f + H * transform.e, transform.f]
    fig, axes = plt.subplots(1, 3, figsize=(21, 12), dpi=100)
    for ax in axes:
        ax.imshow(hs, cmap="gray", extent=ext)
        ax.imshow(np.clip(z, -2, 30), cmap="terrain", alpha=0.35, vmin=-2, vmax=30, extent=ext)
        ax.set_xlim(ext[0], ext[1]); ax.set_ylim(ext[2], ext[3]); ax.axis("off")
    crowd.plot(ax=axes[0], column=crowd["is_flooded"].astype(str), cmap="coolwarm", linewidth=0.6)
    axes[0].set_title(f"2015 crowd-sourced streets (red = flooded), n={len(crowd)}")
    zones = layers["gcc_hazard_zones.kml"].to_crs(CRS)
    zcol = "CATEGORY" if "CATEGORY" in zones else zones.columns[0]
    zones.plot(ax=axes[1], column=zcol, cmap="viridis_r", alpha=0.5, legend=True)
    axes[1].set_title("GCC flood hazard zones")
    pts = layers["gcc_inundation_points_depth.kml"].to_crs(CRS)
    wards = layers["gcc_wards_2022.kml"].to_crs(CRS)
    wards.boundary.plot(ax=axes[2], color="white", linewidth=0.3)
    pts.plot(ax=axes[2], color="red", markersize=6)
    axes[2].set_title(f"GCC inundation points (n={len(pts)}) and 200 wards")
    plt.tight_layout()
    plt.savefig(review_dir("p1") / "validation_layers.png")
    print("saved review/p1/validation_layers.png")


if __name__ == "__main__":
    main()
