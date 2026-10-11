"""Offline assets for the web app (no model rerun needed).

    python pipeline/08_offline_assets.py

1. basemap/chennai-z14.pmtiles: the basemap cut at zoom 14 (MapLibre overzooms it), about 7 MB
   instead of 17 MB, so it fits in the offline pack. The site uses it online too, so what you see
   offline is what you saw online.
2. offline/manifest.json: the files every offline pack needs, with sizes and a version hash, plus
   the per-run file lists the browser picks from (street tiles near your places, hourly edge depths).
"""
import gzip
import hashlib
import json
from pathlib import Path

from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import zxy_to_tileid
from pmtiles.writer import Writer

WEB = Path(__file__).resolve().parents[1] / "data" / "out" / "web"


def cut_basemap(maxzoom=14):
    src, dst = WEB / "basemap" / "chennai.pmtiles", WEB / "basemap" / f"chennai-z{maxzoom}.pmtiles"
    with open(src, "rb") as f:
        r = Reader(MmapSource(f))
        header, meta = r.header(), r.metadata()
        with open(dst, "wb") as out:
            w = Writer(out)
            n = 0
            for (z, x, y), data in all_tiles(r.get_bytes):
                if z <= maxzoom:
                    w.write_tile(zxy_to_tileid(z, x, y), data)
                    n += 1
            header = dict(header)
            header["max_zoom"] = maxzoom
            w.finalize(header, meta)
    print(f"{dst.name}: {n} tiles, {dst.stat().st_size / 1e6:.1f} MB (from {src.stat().st_size / 1e6:.1f} MB)")


def entry(rel):
    p = WEB / rel
    b = p.read_bytes()
    return {"path": rel, "bytes": len(b), "gz": len(gzip.compress(b, 6)), "sha": hashlib.sha1(b).hexdigest()[:12]}


def manifest():
    runs = json.loads((WEB / "runs.json").read_text())
    gmeta = json.loads((WEB / "graph" / "meta.json").read_text())
    # water/meta + elevation + sea mask: the map needs them to start, even when it shows no water
    core = ["runs.json", "streets/index.json", "parking.json", "hospitals.json", "places.json",
            "basemap/chennai-z14.pmtiles", "water/meta.json", "water/elev.png", "water/sea.png",
            "graph/meta.json", "graph/names.json", "graph/refs.json", "pois.json"]
    core += [f"graph/{f}.bin" for f in ("nodes", "edges", "len", "cls", "geom_off", "geom", "bridge")]
    core += [f"graph/{f}.bin" for f in ("flags",) if (WEB / "graph" / f"{f}.bin").exists()]
    core += [f"graph/depth_{r}.bin" for r in runs]
    files = [entry(c) for c in core]
    hourly = {r: [entry(f"graph/hourly_{r}_ids.bin"), entry(f"graph/hourly_{r}.bin")]
              for r in runs if r in gmeta.get("hourly", {})}
    version = hashlib.sha1("".join(f["sha"] for f in files).encode()).hexdigest()[:10]
    out = {"version": version, "core": files, "hourly": hourly,
           "street_tile_bytes_note": "street tiles are listed by the browser from streets/index.json (2 km tiles)"}
    (WEB / "offline").mkdir(exist_ok=True)
    (WEB / "offline" / "manifest.json").write_text(json.dumps(out, indent=1))
    tot = sum(f["bytes"] for f in files)
    gz = sum(f["gz"] for f in files)
    print(f"offline/manifest.json v{version}: core {len(files)} files, {tot / 1e6:.1f} MB raw, {gz / 1e6:.1f} MB gzipped")


if __name__ == "__main__":
    cut_basemap()
    manifest()
