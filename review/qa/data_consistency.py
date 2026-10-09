"""QA: street JSON internal consistency per run (max vs hourly series, t15 vs series, saturation).
The card shows round(max) as the readout and derives 'Reaches 15 cm by' from the series."""
import base64, json, sys
from pathlib import Path
WEB = Path('/home/tekiru/Desktop/highground/data/out/web')
idx = json.loads((WEB / 'streets/index.json').read_text())
runs = json.loads((WEB / 'runs.json').read_text())
for run in sorted(p.name for p in (WEB / 'streets').iterdir() if p.is_dir() and p.name != 'geom'):
    n = mx_gt_ser = ser_gt_mx = band_contra = t15_mismatch = sat = len_bad = 0
    worst = []
    for t in idx['tiles']:
        f = WEB / f'streets/{run}/{t}.json'
        if not f.exists():
            continue
        v = json.loads(f.read_text())
        for i, s in enumerate(v['series']):
            ser = list(base64.b64decode(s))
            n += 1
            m = v['max'][i]
            pk = max(ser) if ser else 0
            if len(ser) != runs[run]['hours']:
                len_bad += 1
            if round(m) - pk >= 2:
                mx_gt_ser += 1; worst.append((round(m) - pk, t, i, m, pk))
            if pk - round(m) >= 2:
                ser_gt_mx += 1
            # readout >= 15 but series never reaches 15 -> "Stays under 15 cm" next to an unsafe band
            if (round(m) >= 15) != (pk >= 15):
                band_contra += 1
            st = next((k + 1 for k, x in enumerate(ser) if x >= 15), None)
            jt = v['t15'][i]
            jt = None if jt is None or jt < 0 else jt
            if (st is None) != (jt is None) or (st and jt and abs(st - jt) > 1):
                t15_mismatch += 1
            if m >= 255:
                sat += 1
    worst.sort(reverse=True)
    print(json.dumps({'run': run, 'segments': n, 'max_exceeds_series_peak_by_2cm+': mx_gt_ser, 'series_exceeds_max': ser_gt_mx,
                      'readout_vs_series_15cm_disagree': band_contra, 't15_json_vs_series_disagree': t15_mismatch,
                      'max_ge_255_saturated': sat, 'series_len_ne_hours': len_bad, 'worst': worst[:3]}))
