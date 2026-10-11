"""QA run 4: find searchable places (places.json) whose answer-card segment is pre==1 (wet before the storm),
plus searchable places whose segment is already >=15 cm at hour 1 without the pre flag."""
import json, sys
sys.path.insert(0, '/home/tekiru/Desktop/highground/review/qa')
from pathlib import Path
import importlib.util
spec = importlib.util.spec_from_file_location('ref3core', '/home/tekiru/Desktop/highground/review/qa/ref3.py')
src = Path('/home/tekiru/Desktop/highground/review/qa/ref3.py').read_text().split('runs = json.loads')[0]
ns = {}; exec(src, ns)
WEB = Path('/home/tekiru/Desktop/highground/data/out/web')
scan = json.load(open('/home/tekiru/Desktop/highground/review/qa/run4/b1_scan.json'))
places = json.loads((WEB / 'places.json').read_text())
out = {}
for run in ['michaung2023', 'dec2015_reservoir', 'fengal2024']:
    names = {x['name'] for x in scan[run]['examples'].get('pre_named', [])}
    names |= {x[3] for x in scan[run]['examples'].get('notpre_h1_ge15', []) if x[3]}
    res = []
    for n, lon, lat, kind in places:
        if n not in names: continue
        b = ns['nearest'](lon, lat)
        if not b: continue
        d, t, i, sid, sname, hw, br, flat = b
        v = ns['vals'](run, t)
        s = ns['decode'](v['series'][i])
        pk = max(s); t15 = next((k + 1 for k, x in enumerate(s) if x >= 15), None)
        res.append(dict(q=n, lon=lon, lat=lat, seg=sid, street=sname, hw=hw, br=bool(br), d=round(d), pre=(v.get('pre') or [0]*9999)[i],
                        max=v['max'][i], h1=s[0], t15=t15, peak_h=s.index(pk) + 1, series=s[:12]))
    out[run] = res
    print(run, len(res), 'pre', sum(r['pre'] for r in res), 'notpre_h1>=15', sum(1 for r in res if not r['pre'] and r['h1'] >= 15))
    for r in res[:60]:
        if r['pre'] or r['h1'] >= 15: print('  ', r['q'], r['street'], r['seg'], 'pre', r['pre'], 'max', r['max'], 'h1', r['h1'], 't15', r['t15'], r['series'][:6])
json.dump(out, open('/home/tekiru/Desktop/highground/review/qa/run4/b1_places.json', 'w'), indent=0)
