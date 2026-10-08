"""00_fetch: download DEM tiles, OSM extract, validation KMLs, ERA5 storm timing;
clip OSM to the model bbox and convert to GeoPackage layers.

Idempotent: skips files that already exist.
"""
from __future__ import annotations

import json
import subprocess
import sys
import urllib.request
from pathlib import Path

from common import CFG, RAW, WORK

OPENCITY = "https://data.opencity.in/dataset"
VALIDATION = {
    "crowd_2015.kml": f"{OPENCITY}/866141ab-3a3f-4dc0-8092-421d97ba29a2/resource/782a2e52-78ac-4f89-b469-28a6f7d365eb/download/46d6c279-ae09-43a8-8691-7a5386f69e3a.kml",
    "gcc_stagnation_2015.kml": f"{OPENCITY}/866141ab-3a3f-4dc0-8092-421d97ba29a2/resource/b5f39598-2e2d-40c5-82c3-806a1ad65c91/download/db3840ff-9f33-43a3-b826-2f9dae1bcb78.kml",
    "gcc_hotspots_2015.kml": f"{OPENCITY}/866141ab-3a3f-4dc0-8092-421d97ba29a2/resource/8e1c5b2d-322c-4dbd-bd64-6da2d1a8681d/download/31523c86-0ad1-42f5-b4d1-297daa4bbcd6.kml",
    "inundation_2015.kml": f"{OPENCITY}/866141ab-3a3f-4dc0-8092-421d97ba29a2/resource/2056abd6-26d7-413b-9dfa-e63cbbf41ee7/download/7cb3cecf-a95a-4786-8032-9c7417655d24.kml",
    "gcc_hazard_zones.kml": f"{OPENCITY}/022dd080-e927-40d7-897d-adf3ee98ad69/resource/e61afe07-0f52-4be9-bdf3-5eb0f62b2ed6/download/7f29da20-6621-4b49-b0cf-28b9d1de232b.kml",
    "gcc_inundation_points_depth.kml": f"{OPENCITY}/022dd080-e927-40d7-897d-adf3ee98ad69/resource/ceddf53f-03c0-4866-8ba8-5e84c8007a85/download/814ca028-4c84-4bd0-aa67-6dbaeb9b6ba5.kml",
    "gcc_wards_2022.kml": f"{OPENCITY}/c77de7f8-e377-4990-90fc-4f0f8ca0e2d2/resource/e90176d4-319a-45bd-918e-ecce4f048c4d/download/6a8a05ed-a41c-492a-aade-ff7517e1a4b1.kml",
}
# Geofabrik is the spec's source but is unusably slow from this network (~200 B/s);
# openstreetmap.fr publishes the same OSM data per state.
OSM_URL = "https://download.openstreetmap.fr/extracts/asia/india/tamil_nadu-latest.osm.pbf"
ERA5 = {
    "michaung": ("2023-12-02", "2023-12-05"),
    "fengal": ("2024-11-29", "2024-12-02"),
    "2015": ("2015-11-30", "2015-12-03"),
}


def get(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print("fetch", url, "->", dest)
    subprocess.run(["curl", "-fsSL", "-C", "-", "--retry", "5", "-o", str(dest), url], check=True)


def fetch_dem() -> None:
    for t in CFG["dem"]["tiles"]:
        dest = RAW / "dem" / f"{t}.tif"
        if dest.exists():
            continue
        subprocess.run(["aws", "s3", "cp", "--no-sign-request",
                        f"s3://{CFG['dem']['bucket']}/{t}/{t}.tif", str(dest)], check=True)


def fetch_era5() -> None:
    pts = list(CFG["forecast_points"].values())
    lats = ",".join(str(p[0]) for p in pts)
    lons = ",".join(str(p[1]) for p in pts)
    for name, (s, e) in ERA5.items():
        url = ("https://archive-api.open-meteo.com/v1/archive?"
               f"latitude={lats}&longitude={lons}&start_date={s}&end_date={e}"
               "&hourly=precipitation&timezone=Asia%2FKolkata")
        get(url, RAW / "rain" / f"era5_{name}.json")


def fetch_worldcover() -> None:
    """ESA WorldCover 2021 (10 m) window from AWS Open Data (s3://esa-worldcover)."""
    import os
    import rasterio
    from rasterio.windows import from_bounds
    dest = RAW / "worldcover" / "worldcover_2021_chennai.tif"
    if dest.exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.environ["AWS_NO_SIGN_REQUEST"] = "YES"
    w, s, e, n = CFG["domain"]["bbox_wgs84"]
    src_path = "/vsis3/esa-worldcover/v200/2021/map/ESA_WorldCover_10m_2021_v200_N12E078_Map.tif"
    with rasterio.open(src_path) as src:
        win = from_bounds(w - 0.01, s - 0.01, e + 0.01, n + 0.01, src.transform).round_offsets().round_lengths()
        arr = src.read(1, window=win)
        prof = src.profile | dict(width=arr.shape[1], height=arr.shape[0],
                                  transform=src.window_transform(win))
    with rasterio.open(dest, "w", **prof) as dst:
        dst.write(arr, 1)
    print("worldcover", dest, arr.shape)


def extract_osm() -> None:
    src = RAW / "osm" / "tamil_nadu-latest.osm.pbf"
    get(OSM_URL, src)
    w, s, e, n = CFG["domain"]["bbox_wgs84"]
    clip = WORK / "chennai.osm.pbf"
    if not clip.exists():
        subprocess.run(["osmium", "extract", "-b", f"{w},{s},{e},{n}", "-s", "smart",
                        "--overwrite", "-o", str(clip), str(src)], check=True)
    gpkg = WORK / "osm.gpkg"
    if not gpkg.exists():
        # GDAL OSM driver: points, lines, multilinestrings, multipolygons layers.
        # Tags not in GDAL's default osmconf.ini land in the `other_tags` hstore column.
        subprocess.run(["ogr2ogr", "-f", "GPKG", str(gpkg), str(clip)], check=True)
    print("osm gpkg", gpkg, gpkg.stat().st_size // 1_000_000, "MB")


def main() -> None:
    fetch_dem()
    for name, url in VALIDATION.items():
        get(url, RAW / "validation" / name)
    fetch_era5()
    fetch_worldcover()
    extract_osm()
    print("00_fetch done")


if __name__ == "__main__":
    sys.exit(main())
