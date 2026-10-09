"""06_validate: 2015 replay metrics -> data/out/web/proof.json (the Proof screen reads only this).

Reports, on the VALIDATION half (even-numbered GCC wards) unless stated:
- hit rate / false rate / skill / lift for rain-only and rain + reservoir runs,
  split into river-driven (<= 500 m from Adyar/Cooum) and rain-driven locations;
- the naive baseline (lowest 20% of GCC land is flooded) and a matched-share
  baseline (lowest X%, X = the model's own flooded share);
- zone agreement with GCC hazard zones;
- areal agreement with the NRSC 2015 inundation extent;
- ANUGA vs fast-model agreement for Velachery, when available.
"""
from __future__ import annotations

import json

import geopandas as gpd
import numpy as np
from rasterio.features import rasterize

import scoring
from common import CFG, CRS, OUT, RAW, WORK, grid_spec, review_dir, write_json

V = CFG["validation"]
WEB = OUT / "web"
ZONE_RANK = {"Very Low": 1, "Low": 2, "Moderate": 3, "High": 4, "Very High": 5}


def r3(x):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), 3)


def clean(d):
    return {k: (clean(v) if isinstance(v, dict) else (r3(v) if isinstance(v, float) else v)) for k, v in d.items()}


def main():
    transform, W, H = grid_spec()
    data = scoring.prepare()
    cal = json.loads((OUT / "calibration.json").read_text())
    sea = np.load(WORK / "sea.npy")
    dtm = np.load(WORK / "dtm_bare.npy")
    burn = np.load(WORK / "waterway.npy")

    wd = scoring.wards()
    ward_grid = rasterize([(g, w) for g, w in zip(wd.geometry, wd["ward"])], out_shape=(H, W),
                          transform=transform, fill=0, dtype="int32")
    perm_water = (np.load(WORK / "landcover.npy") == 4) | burn
    gcc_land = (ward_grid > 0) & ~sea & ~perm_water

    runs = {"rain_only": "dec2015_rain", "rain_plus_reservoir": "dec2015_reservoir"}
    wet = {k: (np.load(OUT / "runs" / rid / "hmax.npy") >= V["hit_depth_m"]) & ~perm_water for k, rid in runs.items()}

    thr20 = np.percentile(dtm[gcc_land], 100 * V["baseline_lowest_share"])
    base20 = (dtm <= thr20) & ~sea & ~perm_water
    share_model = {k: float(w[gcc_land].mean()) for k, w in wet.items()}
    matched = {k: (dtm <= np.percentile(dtm[gcc_land], 100 * s)) & ~sea & ~perm_water for k, s in share_model.items()}

    def metrics(grid, filt):
        return {g: scoring.evaluate(grid, data, filt, None if g == "all" else g)
                for g in ("all", "rain_driven", "river_driven")}

    by_group = {k: metrics(w, scoring.even) for k, w in wet.items()}
    calib_half = {k: metrics(w, scoring.odd) for k, w in wet.items()}
    outside = {k: scoring.evaluate(w, data, lambda a: a < 0) for k, w in wet.items()}
    baseline = metrics(base20, scoring.even)
    matched_b = {k: metrics(m, scoring.even) for k, m in matched.items()}

    # GCC hazard zones
    zones = scoring._read_kml(RAW / "validation" / "gcc_hazard_zones.kml").to_crs(CRS)
    zones["rank"] = zones["CATEGORY"].map(ZONE_RANK).fillna(0).astype(int)
    zones = zones.sort_values("rank")
    zgrid = rasterize([(g, r) for g, r in zip(zones.geometry, zones["rank"]) if g is not None],
                      out_shape=(H, W), transform=transform, fill=0, dtype="uint8")

    def zone_agree(grid):
        m = grid & gcc_land & (zgrid > 0) & ~burn
        n = m.sum()
        hi = (m & (zgrid >= 3)).sum()
        return dict(flooded_cells_in_zoned_area=int(n),
                    share_in_moderate_high_veryhigh=hi / n if n else None,
                    share_in_low_verylow=(n - hi) / n if n else None,
                    city_share_moderate_or_higher=float(((zgrid >= 3) & gcc_land).sum() / ((zgrid > 0) & gcc_land).sum()))

    zone = {k: zone_agree(w) for k, w in wet.items()}
    zone["baseline_lowest_20pct"] = zone_agree(base20)

    # NRSC 2015 inundation extent (satellite-derived)
    nrsc = scoring._read_kml(RAW / "validation" / "inundation_2015.kml").to_crs(CRS)
    ngrid = rasterize([(g, 1) for g in nrsc.geometry if g is not None], out_shape=(H, W),
                      transform=transform, fill=0, dtype="uint8").astype(bool)

    def areal(grid):
        a = grid & gcc_land
        b = ngrid & gcc_land
        return dict(csi=(a & b).sum() / max((a | b).sum(), 1), hit=(a & b).sum() / max(b.sum(), 1),
                    model_share=a.sum() / gcc_land.sum(), nrsc_share=b.sum() / gcc_land.sum())

    nrsc_m = {k: areal(w) for k, w in wet.items()}
    nrsc_m["baseline_lowest_20pct"] = areal(base20)

    anuga = None
    af = OUT / "anuga" / "design_200_mean" / "agreement.json"
    if af.exists():
        anuga = json.loads(af.read_text())

    head_run = "rain_plus_reservoir"
    head = dict(run=head_run, subset="validation wards (even numbers)",
                model_hit_rate=by_group[head_run]["all"]["hit_rate"],
                model_false_rate=by_group[head_run]["all"]["false_rate"],
                baseline_hit_rate=baseline["all"]["hit_rate"],
                baseline_false_rate=baseline["all"]["false_rate"],
                matched_baseline_hit_rate=matched_b[head_run]["all"]["hit_rate"],
                matched_baseline_false_rate=matched_b[head_run]["all"]["false_rate"],
                model_flooded_share_of_city=share_model[head_run],
                reported_segments=by_group[head_run]["all"]["reported_segments"])

    proof = dict(
        headline=head,
        sentence=(f"We tuned one number, storm-drain capacity ({cal['drainage_mm_h']:g} mm/h), on half of "
                  f"Chennai's wards and tested on the other half."),
        split=dict(rule=V["split"], parameter=cal["parameter"], value_mm_h=cal["drainage_mm_h"],
                   objective=cal["objective"], candidates=cal["candidates"]),
        by_group=by_group,
        calibration_half=calib_half,
        outside_gcc=outside,
        baseline=dict(rule=f"lowest {int(100*V['baseline_lowest_share'])}% of GCC land by elevation is flooded",
                      threshold_m=float(thr20), metrics=baseline),
        matched_baseline=dict(rule="lowest X% of GCC land flooded, X = the model's own flooded share",
                              shares=share_model, metrics=matched_b),
        zones=zone,
        nrsc_2015=nrsc_m,
        anuga=anuga,
        thresholds=dict(hit_depth_cm=int(V["hit_depth_m"] * 100), hit_length_share=V["hit_length_share"],
                        river_buffer_m=V["river_buffer_m"]),
        caveats=[
            "Citizen reports are cumulative over Nov–Dec 2015, not one night, and come mostly from areas with more internet users.",
            "Reports only say where it flooded, never where it stayed dry. 'Unreported' streets are used as a stand-in for dry, which they are not always.",
            "The reservoir release is modelled from the CAG/PWD timeline as an inflow at the Adyar's upstream edge; other tank surpluses are not included.",
            "Terrain is 30 m satellite elevation (Copernicus GLO-30) with buildings and trees removed by approximation.",
        ],
        sources=["OpenCity: Chennai 2015 Crowd-sourced Flooding Locations (osm-in/flood-map contributors)",
                 "OpenCity: Chennai Flood Hazard Zones Map (GCC)", "OpenCity: Chennai 2015 Floods Inundation Zone",
                 "OpenCity: Chennai GCC Ward Map 2022"],
    )
    proof = clean(proof)
    write_json(WEB / "proof.json", proof, indent=1)
    write_json(OUT / "proof.json", proof, indent=1)

    # crowd streets for the Proof split-screen (simplified, with model hit flags)
    crowd = scoring._read_kml(RAW / "validation" / "crowd_2015.kml").to_crs(CRS)
    crowd = crowd[crowd["is_flooded"].astype(str) == "1"].explode(index_parts=False).reset_index(drop=True)
    flat = wet[head_run].ravel()
    cs = scoring.flooded_share(flat, data["c_seg"], data["c_cell"], int(data["c_n"]))
    out = gpd.GeoDataFrame(dict(ward=data["c_ward"], river=data["c_river"].astype(int),
                                hit=(cs >= V["hit_length_share"]).astype(int)),
                           geometry=crowd.geometry.simplify(5), crs=CRS).to_crs("EPSG:4326")
    (WEB / "proof").mkdir(parents=True, exist_ok=True)
    out.to_file(WEB / "proof" / "crowd_2015.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)

    # review plot
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 3, figsize=(20, 11), dpi=100)
    for ax, grid, title in ((axes[0], wet["rain_only"], "2015 replay, rain only"),
                            (axes[1], wet["rain_plus_reservoir"], "2015 replay, rain + reservoir"),
                            (axes[2], base20, "Baseline: lowest 20% of land")):
        ax.imshow(np.where(sea, 0.2, 1.0), cmap="gray", vmin=0, vmax=1)
        ax.imshow(np.ma.masked_where(~grid, grid), cmap="Blues", vmin=0, vmax=1.3, alpha=0.9)
        ax.set_title(title)
        ax.axis("off")
    plt.tight_layout()
    plt.savefig(review_dir("p3") / "validation_maps.png")
    plt.close()
    print(json.dumps(head, indent=1))
    for k in by_group:
        for g, m in by_group[k].items():
            print(f"{k:22s} {g:13s} hit {m['hit_rate']} false {m['false_rate']} skill {m['skill']} n={m['reported_segments']}")
    print("baseline", baseline["all"])


if __name__ == "__main__":
    main()
