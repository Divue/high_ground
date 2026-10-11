import json
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
import numpy as np
r = json.load(open("/home/tekiru/Desktop/highground/review/model/v3/subbox_results.json"))
order = [("FULL:design_200_mean:608,1310,220,633", "v3 full run (first 14 h)"), ("E0_base", "E0 sub-box baseline"), ("E6_alpha0.25", "E6 half timestep"),
         ("E7_drain0", "E7 drains 0 mm/h"), ("E3_nodrainburn", "E3 drains not burnt"), ("E1_cap0.3", "E1 pit cap 0.3 m"), ("E5_cap0.15", "E5 pit cap 0.15 m"),
         ("E2_fillbuilt", "E2 fill pits in built cells"), ("E4_smoothbuilt2", "E4 smooth built cells"), ("E8_open", "E8 3x3 opening filter"), ("E9_fillall", "E9 fill all pits")]
order = [(k, l) for k, l in order if k in r]
fig, ax = plt.subplots(1, 2, figsize=(16, 6), dpi=100)
y = np.arange(len(order))
ax[0].barh(y - .2, [r[k]["velachery_wet15"] for k, _ in order], .4, label="Velachery (1.2 km)", color="#1C6E9C")
ax[0].barh(y + .2, [r[k]["tnagar_wet15"] for k, _ in order], .4, label="T. Nagar (1 km)", color="#F2A541")
ax[0].axvline(.25, ls="--", c="k", lw=.8); ax[0].set_yticks(y, [l for _, l in order]); ax[0].invert_yaxis()
ax[0].set_xlabel("share of land >= 15 cm, 200 mm storm"); ax[0].legend(); ax[0].set_title("Place gate: only filling every closed pit (E9) puts Velachery above T. Nagar")
ax[1].barh(y - .2, [r[k]["auc_odd"] for k, _ in order], .4, label="AUC odd wards (tuning half)", color="#7FD3D8")
ax[1].barh(y + .2, [r[k]["nrsc_hit"] - r[k]["nrsc_random_hit_same_share"] for k, _ in order], .4, label="NRSC hit minus random map of same size", color="#3E5560")
ax[1].set_yticks(y, ["" for _ in order]); ax[1].invert_yaxis(); ax[1].axvline(.5, c="k", lw=.5); ax[1].legend(loc="lower right")
ax[1].set_title("Skill inside the box barely moves (chance AUC = 0.5)")
plt.tight_layout(); plt.savefig("/home/tekiru/Desktop/highground/review/model/v3/subbox_experiments.png"); print("ok")
