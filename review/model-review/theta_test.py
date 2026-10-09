"""Builder's follow-up to dt_halving.py: does the theta scheme (theta 0.7) at the production
timestep (alpha 0.7) remove the sloshing outliers vs a converged plain run (alpha 0.175)?"""
import importlib, json, math, sys
import numpy as np
sys.path.insert(0, "/home/tekiru/Desktop/highground/review/model-review")
sys.path.insert(0, "/home/tekiru/Desktop/highground/pipeline")
dh = importlib.import_module("dt_halving")
fm = dh.fm
orig = fm.momentum
def make(theta):
    state = {}
    def mom(h, z32, qx, qy, n2, dt, dx, g, hdry):
        if theta >= 1.0:
            return orig(h, z32, qx, qy, n2, dt, dx, g, hdry)
        qx0 = qx.copy(); qy0 = qy.copy()
        fm.momentum_theta(h, z32, qx, qy, qx0, qy0, n2, dt, dx, g, hdry, theta)
    return mom
res = {}
fm.momentum = make(1.0); ref = dh.sim(0.175)
inner = ~dh.ring & ~dh.burn & (dh.lc != 4)
for name, th, al in (("plain_a0.7", 1.0, 0.7), ("theta0.7_a0.7", 0.7, 0.7), ("theta0.8_a0.7", 0.8, 0.7), ("plain_a0.5", 1.0, 0.5)):
    fm.momentum = make(th); X = dh.sim(al)
    d = np.abs((X["hmax"] - ref["hmax"])[inner]) * 100
    wa, wx = X["hmax"][inner] >= 0.15, ref["hmax"][inner] >= 0.15
    res[name] = dict(steps=X["steps"], mass_err_pct=float(X["mass_err_pct"]), mean_abs_cm=round(float(d.mean()), 3),
                     p99_cm=round(float(np.percentile(d, 99)), 2), max_cm=round(float(d.max()), 1),
                     cells_over_30cm=int((d > 30).sum()), wet15_agreement=round(float((wa == wx).mean()), 4))
    print(name, res[name], flush=True)
json.dump(res, open("/home/tekiru/Desktop/highground/review/model-review/theta_test.json", "w"), indent=1)
