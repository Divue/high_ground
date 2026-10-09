"""geocode: POST /geocode {q} -> Amazon Location Service (Places API v2), biased to Chennai.

Falls back to OpenStreetMap Nominatim if Amazon Location returns nothing usable,
and says which source answered.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request

import boto3

CHENNAI = [80.2209, 12.9791]          # bias position (lon, lat): Velachery
BBOX = [80.10, 12.85, 80.33, 13.24]   # model domain
_places = None


def places():
    """Created lazily: an older bundled boto3 without 'geo-places' must not break the fallback."""
    global _places
    if _places is None:
        _places = boto3.client("geo-places")
    return _places


def inside(lon, lat):
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def amazon(q):
    r = places().geocode(QueryText=q, BiasPosition=CHENNAI, MaxResults=5,
                       Filter={"IncludeCountries": ["IND"]})
    out = []
    for it in r.get("ResultItems", []):
        lon, lat = it["Position"]
        out.append(dict(label=it.get("Title") or it.get("Address", {}).get("Label", q), lon=lon, lat=lat,
                        inside=inside(lon, lat)))
    return out


def nominatim(q):
    url = ("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&viewbox="
           f"{BBOX[0]},{BBOX[3]},{BBOX[2]},{BBOX[1]}&bounded=1&q=" + urllib.parse.quote(q))
    req = urllib.request.Request(url, headers={"User-Agent": "HighGround/1.0 (hackathon flood app)"})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read())
    return [dict(label=d["display_name"], lon=float(d["lon"]), lat=float(d["lat"]),
                 inside=inside(float(d["lon"]), float(d["lat"]))) for d in data]


def handler(event, context):
    body = json.loads(event.get("body") or "{}")
    q = (body.get("q") or "").strip()[:200]
    if not q:
        return {"statusCode": 400, "body": json.dumps({"error": "Type an address."})}
    if "chennai" not in q.lower():
        q = q + ", Chennai"
    source, res = "Amazon Location Service", []
    try:
        res = [r for r in amazon(q) if r["inside"]]
    except Exception as e:
        print("amazon location error", e)
    if not res:
        try:
            source, res = "OpenStreetMap Nominatim", [r for r in nominatim(q) if r["inside"]]
        except Exception as e:
            print("nominatim error", e)
    return {"statusCode": 200, "headers": {"content-type": "application/json"},
            "body": json.dumps({"source": source, "results": res[:5]})}
