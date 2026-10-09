"""HighGround shared helpers for Lambdas. Every number returned here is read from
model output files in S3; nothing is invented or estimated outside the model."""
from __future__ import annotations

import base64
import heapq
import json
import math
import os
import struct
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import boto3

BUCKET = os.environ.get("DATA_BUCKET", "")
PREFIX = os.environ.get("DATA_PREFIX", "data/")
IST = timezone(timedelta(hours=5, minutes=30))
s3 = boto3.client("s3")

BANDS = [(5, "dry", "Dry"), (15, "wet", "Wet but passable"),
         (30, "unsafe_two_wheeler", "Unsafe for two-wheelers"), (10 ** 9, "unsafe_car", "Unsafe for cars")]
LIMITS = [
    "Terrain is 30 m satellite elevation (Copernicus GLO-30) with buildings and trees removed by approximation, so small dips and kerbs are invisible.",
    "Storm drains are modelled as one uniform capacity (mm per hour) calibrated on half of the GCC wards, not as a drain network.",
    "Scenarios are precomputed 24-hour storms (50–400 mm); tonight's forecast is matched to the two nearest and blended.",
    "The 2015 reservoir release is a documented assumption built from the CAG/PWD release timeline.",
    "Storm surge and blocked drains are not modelled.",
    "Drain capacity was tuned on the extreme 2015 floods (best fit: drains add nothing); for smaller storms the model probably shows more water than residents will see.",
    "This is not an official warning. Follow GCC, IMD and Tamil Nadu SDMA advisories. In danger, call 112.",
]


def _get(key: str) -> bytes:
    return s3.get_object(Bucket=BUCKET, Key=PREFIX + key)["Body"].read()


@lru_cache(maxsize=256)
def s3_json(key: str):
    return json.loads(_get(key))


def current() -> dict:
    """current.json changes every run, so it is never cached."""
    try:
        return json.loads(_get("current.json"))
    except Exception:
        return {}


def band(cm: float) -> dict:
    for top, code, label in BANDS:
        if cm < top:
            return {"code": code, "label": label}
    return {"code": "unsafe_car", "label": "Unsafe for cars"}


def _dist_m(lon1, lat1, lon2, lat2):
    k = math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lon2 - lon1) * 111_320 * k, (lat2 - lat1) * 110_540)


def _pt_seg(px, py, ax, ay, bx, by):
    k = math.cos(math.radians(py))
    ax_, bx_, px_ = ax * k, bx * k, px * k
    dx, dy = bx_ - ax_, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px_ - ax_) * dx + (py - ay) * dy) / L))
    return _dist_m(px, py, (ax_ + t * dx) / k, ay + t * dy)


def nearest_segment(lat: float, lon: float):
    idx = s3_json("streets/index.json")
    best = None
    for tile, (w, s, e, n) in idx["tile_bounds_lonlat"].items():
        if not (w - 0.004 <= lon <= e + 0.004 and s - 0.004 <= lat <= n + 0.004):
            continue
        for i, (sid, name, hw, br, flat) in enumerate(s3_json(f"streets/geom/{tile}.json")["segs"]):
            # prefer named public streets for an address answer
            penalty = (25 if hw == "service" else 0) + (12 if not name else 0)
            for j in range(0, len(flat) - 2, 2):
                d = _pt_seg(lon, lat, flat[j], flat[j + 1], flat[j + 2], flat[j + 3]) + penalty
                if best is None or d < best[0]:
                    best = (d, tile, i, sid, name, hw, br)
    if best is None:
        return None
    d, tile, i, sid, name, hw, br = best
    return dict(tile=tile, index=i, segment_id=sid, name=name or "Unnamed street", highway=hw,
                bridge=bool(br), distance_m=round(d))


def scenario_mix(sc: dict | None = None):
    """[(run_id, weight)] for the requested scenario: current forecast blend or one run."""
    sc = sc or current().get("scenario")
    if not sc:
        return []
    if sc.get("run"):
        return [(sc["run"], 1.0)]
    mix = [(sc["lower"], 1 - sc["w"]), (sc["upper"], sc["w"])]
    return [(r, w) for r, w in mix if w > 0]       # never fetch a run that carries no weight


def segment_values(tile: str, index: int, mix):
    mx, series = 0.0, None
    for rid, w in mix:
        v = s3_json(f"streets/{rid}/{tile}.json")
        mx += w * v["max"][index]
        s = list(base64.b64decode(v["series"][index]))
        series = [w * x for x in s] if series is None else [a + w * x for a, x in zip(series, s)]
    series = [round(x) for x in (series or [])]
    t15 = next((h + 1 for h, x in enumerate(series) if x >= 15), None)
    peak_h = (series.index(max(series)) + 1) if series and max(series) > 0 else None
    return dict(max_cm=round(mx), series_cm=series, hours_to_15cm=t15, peak_hour=peak_h)


def clock(start_iso: str | None, hours: float | None):
    if start_iso is None or hours is None:
        return None
    t = datetime.fromisoformat(start_iso) + timedelta(hours=hours)
    return t.strftime("%-I %p") + (" " + t.strftime("%a") if hours >= 18 else "")


def street_risk(lat: float, lon: float, sc: dict | None = None) -> dict:
    cur = current()
    mix = scenario_mix(sc)
    seg = nearest_segment(lat, lon)
    if seg is None:
        return {"error": "No street found near this point inside the model area (Greater Chennai)."}
    if not mix:
        return dict(street=seg["name"], segment_id=seg["segment_id"], forecast=cur.get("forecast"),
                    scenario=None, note="Tonight's forecast is below the smallest modelled storm (50 mm). "
                                        "The model shows no flooding for tonight. Try a replay of a past storm.")
    v = segment_values(seg["tile"], seg["index"], mix)
    start = (sc or {}).get("start_local") or cur.get("start_local")
    return dict(street=seg["name"], segment_id=seg["segment_id"], distance_to_point_m=seg["distance_m"],
                bridge=seg["bridge"], scenario=sc or cur.get("scenario"), forecast=cur.get("forecast"),
                max_depth_cm=v["max_cm"], band=band(v["max_cm"]), hours_to_15cm=v["hours_to_15cm"],
                reaches_15cm_at=clock(start, v["hours_to_15cm"]), peak_hour=v["peak_hour"],
                peak_at=clock(start, v["peak_hour"]), hourly_depth_cm=v["series_cm"], start_local=start,
                source="HighGround model output (streets/*.json)")


def _dominant(mix):
    return max(mix, key=lambda m: m[1])[0] if mix else None


def dry_parking(lat: float, lon: float, sc: dict | None = None, limit: int = 3) -> dict:
    p = s3_json("parking.json")
    rid = _dominant(scenario_mix(sc)) or "design_50_mean"
    flags = p["dry"][rid]
    out = []
    for c, ok in zip(p["candidates"], flags):
        if ok:
            out.append(dict(name=c["name"], kind=c["kind"], lon=c["lon"], lat=c["lat"],
                            straight_line_m=round(_dist_m(lon, lat, c["lon"], c["lat"]))))
    out.sort(key=lambda x: x["straight_line_m"])
    return dict(scenario_run=rid, options=out[:limit], note=p["note"], rule=p["rule"])


def hospital_status(sc: dict | None = None) -> dict:
    h = s3_json("hospitals.json")
    rid = _dominant(scenario_mix(sc)) or "design_50_mean"
    r = h["runs"][rid]
    cut = [x["name"] for x, ok in zip(h["hospitals"], r["reach"]) if not ok]
    return dict(scenario_run=rid, hospitals=len(h["hospitals"]), cut_off=len(cut), cut_off_names=cut[:25],
                rule=h["rule"])


# ------------------------------------------------------------------ routing (A*)
@lru_cache(maxsize=1)
def graph():
    import array
    def arr(key, code):
        a = array.array(code)
        a.frombytes(_get(key))
        return a
    nodes = arr("graph/nodes.bin", "f")
    edges = arr("graph/edges.bin", "I")
    lens = arr("graph/len.bin", "f")
    adj = {}
    for e in range(len(lens)):
        a, b = edges[2 * e], edges[2 * e + 1]
        adj.setdefault(a, []).append((b, e))
        adj.setdefault(b, []).append((a, e))
    return nodes, edges, lens, adj


@lru_cache(maxsize=32)
def edge_depth(rid: str):
    import array
    a = array.array("H")
    a.frombytes(_get(f"graph/depth_{rid}.bin"))
    return a


def _nearest_node(nodes, lon, lat):
    best, bi = 1e18, -1
    k = math.cos(math.radians(lat))
    for i in range(0, len(nodes), 2):
        d = ((nodes[i] - lon) * k) ** 2 + (nodes[i + 1] - lat) ** 2
        if d < best:
            best, bi = d, i // 2
    return bi


def safe_route(frm, to, sc: dict | None = None, mode: str = "car") -> dict:
    nodes, edges, lens, adj = graph()
    mix = scenario_mix(sc)
    limit = 30 if mode == "car" else 15
    deps = [(edge_depth(r), w) for r, w in mix]
    s = _nearest_node(nodes, frm[1], frm[0])
    t = _nearest_node(nodes, to[1], to[0])

    def h(n):
        return _dist_m(nodes[2 * n], nodes[2 * n + 1], nodes[2 * t], nodes[2 * t + 1])

    def run(blocked):
        dist = {s: 0.0}
        prev = {}
        pq = [(h(s), s)]
        while pq:
            f, u = heapq.heappop(pq)
            if u == t:
                break
            for v, e in adj.get(u, ()):
                if blocked and sum(w * d[e] for d, w in deps) >= limit:
                    continue
                nd = dist[u] + lens[e]
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    prev[v] = (u, e)
                    heapq.heappush(pq, (nd + h(v), v))
        if t not in dist:
            return None
        path, n = [], t
        while n != s:
            n, e = prev[n]
            path.append(e)
        return dist[t], path[::-1]

    normal = run(False)
    safe = run(True)
    flooded_on_normal = 0
    if normal:
        flooded_on_normal = sum(1 for e in normal[1] if sum(w * d[e] for d, w in deps) >= limit)
    return dict(mode=mode, impassable_above_cm=limit,
                normal_route_m=round(normal[0]) if normal else None,
                normal_route_flooded_edges=flooded_on_normal,
                safe_route_m=round(safe[0]) if safe else None,
                safe_route_exists=safe is not None,
                detour_m=round(safe[0] - normal[0]) if (safe and normal) else None,
                safe_edges=safe[1] if safe else [])
