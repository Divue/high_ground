"""05b_navigation: what turn-by-turn directions and flood-safe navigation need from OpenStreetMap,
aligned edge by edge with the routing graph written by 05_features (no model rerun).

    python pipeline/05b_navigation.py

Outputs (data/out/web/graph/):
  flags.bin  u8 per edge: 1 one-way along the edge (a->b), 2 one-way against it (b->a),
             4 roundabout, 8 tunnel or underpass, 16 slip road (*_link)
  refs.json  road number per edge ("" if none), for directions on unnamed roads
and data/out/web/pois.json: pharmacies, fuel stations, police and fire stations inside the model area.
"""
import importlib.util
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))       # common.py, as when 05_features runs from pipeline/
spec = importlib.util.spec_from_file_location("features", HERE / "05_features.py")
F = importlib.util.module_from_spec(spec)
spec.loader.exec_module(F)


def main():
    h = F.Collector()
    h.apply_file(str(F.WORK / "chennai.osm.pbf"), locations=True)
    nodes, edges, cls, brg, geoms, names = F.build_graph(h.ways)
    wids = F.build_graph.wids
    g = F.WEB / "graph"
    # the graph must be the one already served: same nodes and edges, in the same order
    old_e = np.fromfile(g / "edges.bin", np.uint32).reshape(-1, 2)
    assert old_e.shape == edges.shape and np.array_equal(old_e, edges.astype(np.uint32)), "graph changed: rerun 05_features"
    flags = np.zeros(len(edges), np.uint8)
    refs = []
    for i, wid in enumerate(wids):
        t = h.waytags[wid]
        ow = t["oneway"]
        if ow in ("yes", "true", "1") or (t["junction"] in ("roundabout", "circular") and ow != "no"):
            flags[i] |= 1
        elif ow == "-1":
            flags[i] |= 2
        if t["junction"] in ("roundabout", "circular"):
            flags[i] |= 4
        if t["tunnel"] not in ("", "no") or t["covered"] == "yes" or t["layer"].startswith("-"):
            flags[i] |= 8
        if t["link"]:
            flags[i] |= 16
        refs.append(t["ref"])
    flags.tofile(g / "flags.bin")
    F.write_json(g / "refs.json", refs)
    w, s, e, n = F.CFG["domain"]["bbox_wgs84"]
    pois = [p for p in h.pois if w <= p[2] <= e and s <= p[3] <= n]
    F.write_json(F.WEB / "pois.json", dict(
        note="OpenStreetMap; opening hours and flood status unknown. Call ahead.",
        kinds={"pharmacy": "Pharmacy", "fuel": "Fuel station", "police": "Police station", "fire": "Fire station"},
        pois=pois))
    c = lambda b: int(((flags & b) > 0).sum())
    print(f"flags: one-way {c(1) + c(2)} edges, roundabout {c(4)}, tunnel/underpass {c(8)}, slip {c(16)}; "
          f"refs {sum(1 for r in refs if r)}; pois {len(pois)} "
          f"({', '.join(f'{k} {sum(p[0] == k for p in pois)}' for k in ('pharmacy', 'fuel', 'police', 'fire'))})")


if __name__ == "__main__":
    main()
