"""05_features: routing graph, per-scenario edge depths, dry parking, hospital reachability,
and a small gazetteer for offline address search.

Outputs (data/out/web/):
  graph/meta.json, graph/nodes.bin (f32 lon,lat), graph/edges.bin (u32 a,b), graph/len.bin (f32 m),
  graph/cls.bin (u8 road class), graph/geom_off.bin (u32), graph/geom.bin (f32 lon,lat)
  graph/depth_<run>.bin (u16 cm, peak depth along edge; bridges 0)
  parking.json, hospitals.json, places.json
"""
from __future__ import annotations

import json
from collections import defaultdict

import numpy as np
import osmium
from pyproj import Transformer
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from common import CFG, CRS, OUT, WORK, grid_spec, write_json

WEB = OUT / "web"
DRIVE = {
    "motorway": 0, "trunk": 0, "motorway_link": 0, "trunk_link": 0,
    "primary": 1, "primary_link": 1, "secondary": 2, "secondary_link": 2,
    "tertiary": 3, "tertiary_link": 3, "unclassified": 4, "residential": 4,
    "living_street": 4, "road": 4, "service": 5,
}
CAR_CM = CFG["routing"]["car_impassable_cm"]


class Collector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []         # (cls, is_bridge, [(ref, lon, lat)], name, wid)
        self.hospitals = []
        self.parking = []
        self.places = []

    def way(self, w):
        hw = w.tags.get("highway")
        tags = w.tags
        if hw in DRIVE:
            try:
                nodes = [(n.ref, n.lon, n.lat) for n in w.nodes]
            except osmium.InvalidLocationError:
                return
            br = tags.get("bridge", "no") not in ("no",) or tags.get("layer", "0")[:1] in "123456789"
            self.ways.append((DRIVE[hw], bool(br), nodes, tags.get("name", ""), w.id))
        if tags.get("amenity") == "hospital" or tags.get("healthcare") == "hospital":
            try:
                lons = np.array([n.lon for n in w.nodes])
                lats = np.array([n.lat for n in w.nodes])
            except osmium.InvalidLocationError:
                return
            x = lons * 111_320 * np.cos(np.radians(13.0))
            y = lats * 110_540
            area = 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
            self.hospitals.append(dict(id=f"w{w.id}", name=tags.get("name", ""), lon=float(lons.mean()),
                                       lat=float(lats.mean()), beds=tags.get("beds", ""), area=float(area)))
        if tags.get("amenity") == "parking" or tags.get("building") == "parking":
            try:
                pts = [(n.lon, n.lat) for n in w.nodes]
            except osmium.InvalidLocationError:
                return
            self.parking.append(dict(id=f"w{w.id}", name=tags.get("name", ""),
                                     kind="multi-storey" if tags.get("parking") in ("multi-storey", "underground_no")
                                     or tags.get("building") == "parking" else "surface",
                                     pts=pts))

    def node(self, n):
        t = n.tags
        if t.get("amenity") == "hospital" or t.get("healthcare") == "hospital":
            self.hospitals.append(dict(id=f"n{n.id}", name=t.get("name", ""), lon=n.location.lon,
                                       lat=n.location.lat, beds=t.get("beds", ""), area=0.0))
        if t.get("place") in ("suburb", "neighbourhood", "quarter", "village", "town", "locality") and t.get("name"):
            self.places.append([t.get("name"), round(n.location.lon, 5), round(n.location.lat, 5), t.get("place")])


def build_graph(ways):
    use = defaultdict(int)
    for _, _, nodes, _, _ in ways:
        for k, (ref, _, _) in enumerate(nodes):
            use[ref] += 1 if 0 < k < len(nodes) - 1 else 2
    nid = {}
    nodes_ll = []
    edges, cls, brg, geoms, names = [], [], [], [], []
    for c, br, nodes, name, wid in ways:
        start = 0
        for k in range(1, len(nodes)):
            if use[nodes[k][0]] >= 2 or k == len(nodes) - 1:
                seg = nodes[start:k + 1]
                ids = []
                for ref, lon, lat in (seg[0], seg[-1]):
                    if ref not in nid:
                        nid[ref] = len(nodes_ll)
                        nodes_ll.append((lon, lat))
                    ids.append(nid[ref])
                if ids[0] != ids[1]:
                    edges.append(ids)
                    cls.append(c)
                    brg.append(br)
                    geoms.append([(lon, lat) for _, lon, lat in seg])
                    names.append(name)
                start = k
    return np.array(nodes_ll), np.array(edges), np.array(cls), np.array(brg), geoms, names


def main():
    transform, W, H = grid_spec()
    w, s, e, n = CFG["domain"]["bbox_wgs84"]
    h = Collector()
    h.apply_file(str(WORK / "chennai.osm.pbf"), locations=True)
    print(f"{len(h.ways)} drivable ways, {len(h.hospitals)} hospitals, {len(h.parking)} parking, {len(h.places)} places")

    nodes, edges, cls, brg, geoms, names = build_graph(h.ways)
    to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    print(f"graph: {len(nodes)} nodes, {len(edges)} edges")

    # edge lengths and sample cells
    off = [0]
    flat = []
    lengths = np.zeros(len(edges), np.float32)
    samp_r, samp_c, samp_e = [], [], []
    for i, g in enumerate(geoms):
        arr = np.array(g)
        x, y = to_utm.transform(arr[:, 0], arr[:, 1])
        seglen = np.hypot(np.diff(x), np.diff(y))
        lengths[i] = seglen.sum()
        flat.extend(np.round(arr.ravel(), 6))
        off.append(len(flat) // 2)
        # sample every 15 m
        cum = np.concatenate([[0], np.cumsum(seglen)])
        d = np.arange(0, cum[-1] + 1e-6, 15.0) if cum[-1] > 15 else np.array([cum[-1] / 2])
        xs = np.interp(d, cum, x)
        ys = np.interp(d, cum, y)
        c = ((xs - transform.c) / transform.a).astype(int).clip(0, W - 1)
        r = ((ys - transform.f) / transform.e).astype(int).clip(0, H - 1)
        samp_r.append(r)
        samp_c.append(c)
        samp_e.append(np.full(len(r), i))
    samp_r = np.concatenate(samp_r)
    samp_c = np.concatenate(samp_c)
    samp_e = np.concatenate(samp_e)
    water = (np.load(WORK / "landcover.npy") == 4) | np.load(WORK / "waterway.npy")
    keep_s = ~water[samp_r, samp_c]
    samp_r, samp_c, samp_e = samp_r[keep_s], samp_c[keep_s], samp_e[keep_s]

    g = WEB / "graph"
    g.mkdir(parents=True, exist_ok=True)
    nodes.astype(np.float32).tofile(g / "nodes.bin")
    edges.astype(np.uint32).tofile(g / "edges.bin")
    lengths.tofile(g / "len.bin")
    cls.astype(np.uint8).tofile(g / "cls.bin")
    np.array(off, np.uint32).tofile(g / "geom_off.bin")
    np.array(flat, np.float32).tofile(g / "geom.bin")
    write_json(g / "names.json", names)

    runs = json.loads((OUT / "runs.json").read_text())
    # arterial set = trunk/primary edges
    art = cls <= 1
    tree = cKDTree(nodes * [np.cos(np.radians(13.0)), 1.0])

    # hospitals: dedupe, keep named, inside bbox
    # major hospitals only: mapped campuses >= 4000 m2 or >= 100 beds (OSM tags many clinics as hospitals)
    def beds(x):
        try:
            return int(str(x["beds"]).split(";")[0])
        except ValueError:
            return 0
    hosp = [x for x in h.hospitals if x["name"] and w <= x["lon"] <= e and s <= x["lat"] <= n
            and (x["area"] >= 4000 or beds(x) >= 100)]
    seen = set()
    hosp = [x for x in hosp if not (x["name"].lower() in seen or seen.add(x["name"].lower()))]
    hq = np.array([[x["lon"], x["lat"]] for x in hosp])
    dist, hnode = tree.query(hq * [np.cos(np.radians(13.0)), 1.0])
    keep = dist * 111_000 < 400
    hosp = [dict(x, node=int(nd)) for x, nd, k in zip(hosp, hnode, keep) if k]
    print(f"{len(hosp)} named hospitals within 400 m of the road graph")

    # parking candidates
    cand = []
    for i in np.nonzero(brg & (cls <= 3) & (lengths > 150))[0]:
        gg = geoms[i]
        mid = gg[len(gg) // 2]
        cand.append(dict(id=f"e{i}", kind="flyover", name=names[i] or "Flyover", lon=mid[0], lat=mid[1],
                         ends=[gg[0], gg[-1]], edge=int(i)))
    for p in h.parking:
        pts = np.array(p["pts"])
        x, y = to_utm.transform(pts[:, 0], pts[:, 1])
        area = 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
        if p["kind"] == "multi-storey" or area >= 3000:
            cand.append(dict(id=p["id"], kind=p["kind"] if p["kind"] == "multi-storey" else "open ground",
                             name=p["name"] or ("Multi-storey parking" if p["kind"] == "multi-storey" else "Parking ground"),
                             lon=float(pts[:, 0].mean()), lat=float(pts[:, 1].mean()), area=float(area),
                             pts=pts[:: max(1, len(pts) // 12)].tolist()))
    # merge adjacent flyover pieces with the same name (keep the longest per name+1km cell)
    best = {}
    for c in cand:
        key = (c["kind"], c["name"], round(c["lon"], 2), round(c["lat"], 2))
        if c["kind"] != "flyover" or key not in best:
            best[key if c["kind"] == "flyover" else c["id"]] = c
    cand = list(best.values())
    print(f"{len(cand)} parking candidates ({sum(c['kind']=='flyover' for c in cand)} flyovers)")

    def cell(lon, lat):
        x, y = to_utm.transform(lon, lat)
        return (int(np.clip((y - transform.f) / transform.e, 0, H - 1)),
                int(np.clip((x - transform.c) / transform.a, 0, W - 1)))

    park_runs, hosp_runs = {}, {}
    for rid in runs:
        hmax = np.load(OUT / "runs" / rid / "hmax.npy")
        dep = np.zeros(len(edges), np.float32)
        np.maximum.at(dep, samp_e, hmax[samp_r, samp_c])
        dep[brg] = 0.0
        dcm = np.clip(np.round(dep * 100), 0, 65535).astype(np.uint16)
        dcm.tofile(g / f"depth_{rid}.bin")

        # parking: dry flags
        flags = []
        for c in cand:
            if c["kind"] == "flyover":
                ends = [hmax[cell(*pt)] for pt in c["ends"]]
                flags.append(int(min(ends) * 100 < CAR_CM))
            elif c["kind"] == "multi-storey":
                flags.append(int(hmax[cell(c["lon"], c["lat"])] * 100 < CAR_CM))
            else:
                v = [hmax[cell(*pt)] for pt in c["pts"]] + [hmax[cell(c["lon"], c["lat"])]]
                flags.append(int(np.percentile(v, 90) * 100 < 5))
        park_runs[rid] = flags

        # hospitals: connectivity over car-passable edges
        ok = dcm < CAR_CM
        a, b = edges[ok, 0], edges[ok, 1]
        N = len(nodes)
        adj = coo_matrix((np.ones(len(a)), (a, b)), shape=(N, N))
        ncomp, lab = connected_components(adj, directed=False)
        w_node = np.zeros(N)
        np.add.at(w_node, edges[ok, 0], lengths[ok] / 2)
        np.add.at(w_node, edges[ok, 1], lengths[ok] / 2)
        comp_len = np.bincount(lab, weights=w_node, minlength=ncomp)
        art_len = np.bincount(lab[edges[ok & art, 0]], weights=lengths[ok & art], minlength=ncomp)
        main_comp = int(np.argmax(art_len))
        total = lengths.sum()
        res = []
        for x in hosp:
            cmp_ = lab[x["node"]]
            res.append([int(cmp_ == main_comp), round(float(comp_len[cmp_] / total), 4)])
        hosp_runs[rid] = res
        cut = sum(1 - r[0] for r in res)
        print(f"{rid}: {int((dcm >= CAR_CM).sum())} edges impassable for cars, {cut}/{len(hosp)} hospitals cut off, "
              f"{sum(park_runs[rid])}/{len(cand)} parking dry")

    write_json(g / "meta.json", dict(nodes=int(len(nodes)), edges=int(len(edges)), runs=list(runs),
                                     car_impassable_cm=CAR_CM,
                                     two_wheeler_impassable_cm=CFG["routing"]["two_wheeler_impassable_cm"],
                                     classes={"0": "motorway/trunk", "1": "primary", "2": "secondary",
                                              "3": "tertiary", "4": "residential", "5": "service"}), indent=1)
    write_json(WEB / "parking.json", dict(
        note="Check local traffic advisories before parking on a flyover.",
        rule={"flyover": f"deck is elevated; dry if at least one approach is under {CAR_CM} cm at peak",
              "multi-storey": f"dry if the entrance stays under {CAR_CM} cm at peak",
              "open ground": "dry if 90% of the ground stays under 5 cm at peak"},
        candidates=[{k: v for k, v in c.items() if k not in ("pts", "ends", "edge")} for c in cand],
        dry=park_runs))
    write_json(WEB / "hospitals.json", dict(
        rule=f"Reachable = connected to the main arterial network by roads under {CAR_CM} cm at peak.",
        selection="Major hospitals: OSM amenity=hospital mapped as a campus of at least 4,000 m², or tagged with 100+ beds.",
        hospitals=[{k: (round(v, 6) if isinstance(v, float) else v) for k, v in x.items() if k != "area"} for x in hosp],
        runs={rid: {"reach": [r[0] for r in v], "share": [r[1] for r in v],
                    "cut_off": sum(1 - r[0] for r in v)} for rid, v in hosp_runs.items()}))
    places = sorted({p[0]: p for p in h.places}.values())
    write_json(WEB / "places.json", places)
    print("05_features done")


if __name__ == "__main__":
    main()
