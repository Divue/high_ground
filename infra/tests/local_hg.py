"""Exercise the Lambda helper layer against local model outputs (no AWS needed)."""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
sys.path.insert(0, str(ROOT / "infra" / "layers" / "common" / "python"))
import hg  # noqa: E402

WEB = ROOT / "data" / "out" / "web"
hg._get = lambda key: (WEB / key).read_bytes()

lat, lon = 12.9791, 80.2209
sc = {"run": sys.argv[1]} if len(sys.argv) > 1 else None
print("street_risk", json.dumps(hg.street_risk(lat, lon, sc))[:600])
print("dry_parking", json.dumps(hg.dry_parking(lat, lon, sc))[:400])
print("hospitals", json.dumps(hg.hospital_status(sc))[:300])
r = hg.safe_route((lat, lon), (13.0067, 80.2206), sc, "car")
print("route", {k: v for k, v in r.items() if k != "safe_edges"})
print("band 22cm", hg.band(22))
