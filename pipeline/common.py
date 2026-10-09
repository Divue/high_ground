"""Shared helpers for the HighGround pipeline."""
from __future__ import annotations

import json
import os
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CFG = yaml.safe_load((ROOT / "pipeline" / "config.yaml").read_text())

RAW = ROOT / CFG["paths"]["raw"]
WORK = ROOT / CFG["paths"]["work"]
OUT = ROOT / CFG["paths"]["out"]
REVIEW = ROOT / "review"
for p in (RAW, WORK, OUT, REVIEW):
    p.mkdir(parents=True, exist_ok=True)

CRS = CFG["domain"]["crs"]
CELL = float(CFG["domain"]["cell_m"])


def review_dir(phase: str) -> Path:
    d = REVIEW / phase
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_json(path: Path, obj, indent=None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=indent, separators=(",", ":") if indent is None else None))
    os.replace(tmp, path)


def grid_spec():
    """Return (transform, width, height) of the model grid in the working CRS."""
    from pyproj import Transformer
    from rasterio.transform import from_origin

    w, s, e, n = CFG["domain"]["bbox_wgs84"]
    tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    xs, ys = [], []
    for lon in (w, e):
        for lat in (s, n):
            x, y = tr.transform(lon, lat)
            xs.append(x)
            ys.append(y)
    x0 = CELL * round(min(xs) / CELL)
    y1 = CELL * round(max(ys) / CELL)
    width = int(round((max(xs) - x0) / CELL))
    height = int(round((y1 - min(ys)) / CELL))
    return from_origin(x0, y1, CELL, CELL), width, height


def load_grid(name: str):
    import numpy as np

    return np.load(WORK / f"{name}.npy")


def water_mask(run_dir=None):
    """Cells that are not 'flooded land': lakes/ponds, burnt channels, and (per run) land already
    standing in >= 5 cm of water when the storm starts (antecedent channel spill, marsh)."""
    import numpy as np
    m = (np.load(WORK / "landcover.npy") == 4) | np.load(WORK / "waterway.npy")
    if run_dir is not None:
        f = Path(run_dir) / "h_start.npy"
        if f.exists():
            m = m | (np.load(f) >= 0.05)
    return m
