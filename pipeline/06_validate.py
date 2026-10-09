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
from common import CFG, CRS, OUT, RAW, WORK, grid_spec, review_dir, water_mask, write_json

V = CFG["validation"]
WEB = OUT / "web"
ZONE_RANK = {"Very Low": 1, "Low": 2, "Moderate": 3, "High": 4, "Very High": 5}


def r3(x):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), 3)


def clean(d):
    return {k: (clean(v) if isinstance(v, dict) else (r3(v) if isinstance(v, float) else v)) for k, v in d.items()}


def _seg_mean(grid, data, p):
    f = grid.ravel().astype(float)
    s = np.bincount(data[f"{p}_seg"], weights=f[data[f"{p}_cell"]], minlength=int(data[f"{p}_n"]))
    c = np.bincount(data[f"{p}_seg"], minlength=int(data[f"{p}_n"]))
    return np.where(c > 0, s / np.maximum(c, 1), np.nan)


def auc_reported_vs_unreported(grid, data, filt, group=None, boots=200, seed=0):
    """P(a reported street scores higher than an unreported one) for a continuous per-street score.
    Rank-based: flooding more, or a patchier map, does not raise it. 0.5 = chance."""
    from scipy import stats
    cs, us = _seg_mean(grid, data, "c"), _seg_mean(grid, data, "u")
    cm = filt(data["c_ward"]) & np.isfinite(cs)
    um = filt(data["u_ward"]) & np.isfinite(us)
    if group == "river_driven":
        cm &= data["c_river"]; um &= data["u_river"]
    elif group == "rain_driven":
        cm &= ~data["c_river"]; um &= ~data["u_river"]
    a, b = cs[cm], us[um]
    if len(a) < 20 or len(b) < 20:
        return dict(auc=None, ci95=None, n_reported=int(len(a)))
    auc = stats.mannwhitneyu(a, b).statistic / (len(a) * len(b))
    # streets in one ward are not independent: resample whole wards (block bootstrap)
    wa, wb = data["c_ward"][cm], data["u_ward"][um]
    wards = np.unique(np.concatenate([wa, wb]))
    ia_by = {w: np.nonzero(wa == w)[0] for w in wards}
    ib_by = {w: np.nonzero(wb == w)[0] for w in wards}
    rng = np.random.default_rng(seed)
    bs = []
    for _ in range(boots):
        pick = rng.choice(wards, len(wards), replace=True)
        ia = np.concatenate([ia_by[w] for w in pick])
        ib = np.concatenate([ib_by[w] for w in pick])
        if len(ia) < 20 or len(ib) < 20:
            continue
        if len(ib) > 4000:
            ib = rng.choice(ib, 4000, replace=False)
        bs.append(stats.mannwhitneyu(a[ia], b[ib]).statistic / (len(ia) * len(ib)))
    return dict(auc=float(auc), ci95=[float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))],
                ci_method="ward block bootstrap", n_reported=int(len(a)))


def point_auc(grid, pts_rc, rnd_rc):
    from scipy import ndimage as ndi, stats
    g = ndi.maximum_filter(grid, size=5)       # 60 m tolerance for point geolocation
    a = g[pts_rc]; b = g[rnd_rc]
    return float(stats.mannwhitneyu(a, b).statistic / (len(a) * len(b)))


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
    run_water = {k: water_mask(OUT / "runs" / rid) for k, rid in runs.items()}
    peak = {k: np.where(run_water[k], 0.0, np.load(OUT / "runs" / rid / "hmax.npy")) for k, rid in runs.items()}
    wet = {k: peak[k] >= V["hit_depth_m"] for k in runs}

    thr20 = np.percentile(dtm[gcc_land], 100 * V["baseline_lowest_share"])
    base20 = (dtm <= thr20) & ~sea & ~perm_water
    share_model = {k: float(w[gcc_land].mean()) for k, w in wet.items()}
    matched = {k: (dtm <= np.percentile(dtm[gcc_land], 100 * s)) & ~sea & ~perm_water for k, s in share_model.items()}

    def metrics(grid, filt):
        return {g: scoring.evaluate(grid, data, filt, None if g == "all" else g)
                for g in ("all", "rain_driven", "river_driven")}

    def gains(grid, filt):
        return {g: scoring.gain_over_matched_baseline(grid, data, filt, None if g == "all" else g)
                for g in ("all", "rain_driven", "river_driven")}

    by_group = {k: gains(w, scoring.even) for k, w in wet.items()}
    calib_half = {k: gains(w, scoring.odd) for k, w in wet.items()}
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

    # ---- honest skill tests (independent model review, Fri 15:50) --------------------------------
    from scipy import ndimage as ndi, stats
    import geopandas as gpd
    rng = np.random.default_rng(1)
    head_k = "rain_plus_reservoir"
    share = share_model[head_k]
    random_map = (rng.random(dtm.shape) < share) & gcc_land
    near_channel = -ndi.distance_transform_edt(~burn)
    scores = {"model": peak[head_k], "model_rain_only": peak["rain_only"], "low_elevation": -dtm,
              "near_a_channel": near_channel, "random": rng.random(dtm.shape)}
    auc = {k: {g: auc_reported_vs_unreported(v, data, scoring.even, None if g == "all" else g)
               for g in ("all", "rain_driven", "river_driven")} for k, v in scores.items()}
    nulls = dict(
        random_speckle_same_share=scoring.evaluate(random_map, data, scoring.even),
        model_shifted_4km=scoring.evaluate(np.roll(np.roll(wet[head_k], 130, 0), 0, 1) & gcc_land, data, scoring.even))
    nrsc_matched = dict(model=areal(wet[head_k]), elevation_same_share=areal(matched[head_k]), random_same_share=areal(random_map))
    # official GCC points vs random road points
    def pts_rc(gdf):
        x = gdf.geometry.x.values; y = gdf.geometry.y.values
        c = ((x - transform.c) / transform.a).astype(int); r = ((y - transform.f) / transform.e).astype(int)
        ok = (r >= 2) & (r < H - 2) & (c >= 2) & (c < W - 2)
        r, c = r[ok], c[ok]
        k = gcc_land[r, c] | ndi.binary_dilation(gcc_land, iterations=2)[r, c]
        return r[k], c[k]
    lines = gpd.read_file(WORK / "osm.gpkg", layer="lines")
    roads = lines[lines["highway"].isin(scoring.ROADS)].to_crs(CRS).sample(6000, random_state=7)
    rnd_pts = gpd.GeoDataFrame(geometry=roads.geometry.interpolate(rng.random(6000), normalized=True), crs=CRS)
    rr, rc = pts_rc(rnd_pts)
    points = {}
    for label, fn in (("GCC 2015 flood hotspots", "gcc_hotspots_2015.kml"), ("GCC 2015 stagnation points", "gcc_stagnation_2015.kml")):
        g = scoring._read_kml(RAW / "validation" / fn).to_crs(CRS)
        g = g[g.geometry.geom_type == "Point"]
        pr, pc = pts_rc(g)
        points[label] = dict(n=int(len(pr)), **{k: point_auc(v, (pr, pc), (rr, rc)) for k, v in
                             (("model", peak[head_k]), ("low_elevation", -dtm), ("near_a_channel", near_channel),
                              ("random", rng.random(dtm.shape)))})
    # ward level: share of road length reported vs model's share of road samples >= 15 cm (validation wards)
    cl = np.bincount(data["c_seg"], minlength=int(data["c_n"])).astype(float)
    ul = np.bincount(data["u_seg"], minlength=int(data["u_n"])).astype(float)
    f = wet[head_k].ravel()
    cwet = np.bincount(data["c_seg"], weights=f[data["c_cell"]], minlength=int(data["c_n"]))
    uwet = np.bincount(data["u_seg"], weights=f[data["u_cell"]], minlength=int(data["u_n"]))
    rep, mod = [], []
    for w in sorted(set(data["c_ward"][data["c_ward"] > 0]) | set(data["u_ward"][data["u_ward"] > 0])):
        if w % 2:
            continue
        L = cl[data["c_ward"] == w].sum() + ul[data["u_ward"] == w].sum()
        if L < 200:
            continue
        rep.append(cl[data["c_ward"] == w].sum() / L)
        mod.append((cwet[data["c_ward"] == w].sum() + uwet[data["u_ward"] == w].sum()) / L)
    wsp = stats.spearmanr(rep, mod)
    ward_level = dict(spearman=float(wsp.statistic), p=float(wsp.pvalue), wards=len(rep))

    m_all = auc["model"]["all"]
    lo = m_all["ci95"][0]
    verdict = ("slightly better than chance" if lo > 0.5 else "not distinguishable from chance")
    honest = dict(
        question="Pick one street residents reported flooded and one they did not. How often does the model say the reported one gets deeper water?",
        model=m_all, low_elevation=auc["low_elevation"]["all"], random=auc["random"]["all"],
        near_a_channel=auc["near_a_channel"]["all"], verdict=verdict,
        plain=(f"{round(m_all['auc'] * 100)}% of the time (chance is 50%; elevation alone {round(auc['low_elevation']['all']['auc'] * 100)}%, "
               f"distance to the nearest channel {round(auc['near_a_channel']['all']['auc'] * 100)}%). "
               "The 2015 reports mostly show where people reported, not only where it flooded, so at street level "
               "this test can only say the model is " + verdict + "."))

    anuga = None
    af = OUT / "anuga" / "design_200_mean" / "agreement.json"
    if af.exists():
        anuga = json.loads(af.read_text())

    head_run = "rain_plus_reservoir"
    head = dict(run=head_run, subset="validation wards (even numbers)",
                gain_over_matched_baseline=by_group[head_run]["all"]["gain"],
                model_hit_rate=by_group[head_run]["all"]["hit_rate"],
                model_false_rate=by_group[head_run]["all"]["false_rate"],
                baseline_hit_rate=baseline["all"]["hit_rate"],
                baseline_false_rate=baseline["all"]["false_rate"],
                matched_baseline_hit_rate=matched_b[head_run]["all"]["hit_rate"],
                matched_baseline_false_rate=matched_b[head_run]["all"]["false_rate"],
                model_flooded_share_of_city=share_model[head_run],
                reported_segments=by_group[head_run]["all"]["reported_segments"])

    proof = dict(
        honest_test=honest,
        auc_even_wards=auc,
        null_maps=nulls,
        nrsc_matched_share=nrsc_matched,
        gcc_points_auc=points,
        ward_level=ward_level,
        headline=head,
        sentence=(f"Storm-drain capacity ({cal['drainage_mm_h']:g} mm/h) is a stated assumption: on the tuning half of "
                  f"the wards, every value from 0 to 30 mm/h scored the same within its error bars."
                  if cal.get("method") == "assumption" else
                  f"We tuned one number, storm-drain capacity ({cal['drainage_mm_h']:g} mm/h), on half of "
                  f"Chennai's wards and tested on the other half."),
        calibration_note=None,
        metric_note=("The share of reported streets a map floods is easy to inflate: a random speckle of the same size "
                     "scores higher than the model, because reports are spread wherever people live. We show it, but we "
                     "lead with the ranking test above, which flooding more cannot game."),
        split=dict(rule=V["split"], parameter=cal["parameter"], value_mm_h=cal["drainage_mm_h"],
                   method=cal.get("method", "calibrated"), why=cal.get("why"),
                   candidates=cal.get("candidates_auc_odd_wards_2015_replay", cal.get("candidates"))),
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
            "At street level the 2015 reports barely separate the model from chance. Elevation alone does no better on the reports, but it does better than the model on GCC's own 2015 flood hotspots; distance to a channel is the strongest single signal.",
            "The model does not reproduce GCC's hazard map finding that Velachery floods far more than T. Nagar; its flooding follows small closed hollows in the 30 m terrain.",
            "Reports only say where it flooded, never where it stayed dry. 'Unreported' streets are used as a stand-in for dry, which they are not always.",
            "The reservoir release is modelled from the CAG/PWD timeline as an inflow at the Adyar's upstream edge; other tank surpluses are not included.",
            "Terrain is 30 m satellite elevation (Copernicus GLO-30) with buildings and trees removed by approximation.",
            "Drain capacity (10 mm/h) is an assumption; with it, storms under about 100 mm barely flood in the model, which is probably too little.",
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
            print(f"{k:22s} {g:13s} hit {m['hit_rate']:.3f} matched-baseline {m['matched_baseline_hit_rate']:.3f} gain {m['gain']:.3f} false {m['false_rate']:.3f} n={m['reported_segments']}")
    print("baseline", baseline["all"])


if __name__ == "__main__":
    main()
