"""QA run 4, B1: scan every street tile for segments flagged pre==1 (wet before the storm) in the replays.
Checks: max == peak(series); t15 field == first series hour >= 15; pre streets that read 'Stays dry';
pre streets whose 15 cm hour is hour 1 (=> leave-by can't be before it). Writes run4/b1_scan.json."""
import base64, json, struct, collections
from pathlib import Path
WEB = Path('/home/tekiru/Desktop/highground/data/out/web')
idx = json.loads((WEB / 'streets/index.json').read_text())
NB = idx.get('series_bytes', 1)
dec = lambda b: list(struct.unpack(f'<{len(base64.b64decode(b))//2}H', base64.b64decode(b))) if NB == 2 else list(base64.b64decode(b))
out = {}
for run in ['michaung2023', 'dec2015_reservoir', 'fengal2024', 'dec2015_rain', 'design_200_mean']:
    st = collections.Counter(); ex = collections.defaultdict(list)
    for t in idx['tile_bounds_lonlat']:
        g = json.loads((WEB / f'streets/geom/{t}.json').read_text())
        v = json.loads((WEB / f'streets/{run}/{t}.json').read_text())
        pre = v.get('pre') or [0] * len(v['max'])
        for i, (sid, name, hw, br, flat) in enumerate(g['segs']):
            s = dec(v['series'][i]); pk = max(s) if s else 0
            t15 = next((k + 1 for k, x in enumerate(s) if x >= 15), None)
            st['segments'] += 1
            if v['max'][i] != pk: st['max_ne_series_peak'] += 1; ex['max_ne_peak'].append((t, i, sid, v['max'][i], pk))
            jt = v['t15'][i]
            if (jt in (-1, None) and t15) or (jt not in (-1, None) and t15 is not None and jt != t15 and jt + 1 != t15):
                st['t15_field_mismatch'] += 1; ex['t15_mismatch'].append((t, i, sid, jt, t15))
            if not pre[i]: continue
            st['pre'] += 1
            mid = (len(flat) // 4) * 2
            rec = dict(tile=t, i=i, id=sid, name=name, hw=hw, br=br, lon=flat[mid], lat=flat[mid + 1], max=v['max'][i], h1=s[0], t15=t15, jt15=jt, peak_h=s.index(pk) + 1 if pk else None)
            if pk < 5: st['pre_and_stays_dry'] += 1; ex['pre_dry'].append(rec)
            elif pk < 15: st['pre_and_under15'] += 1; ex['pre_under15'].append(rec)
            if t15 == 1: st['pre_t15_hour1'] += 1; ex['pre_t15_1'].append(rec)
            elif t15: st['pre_t15_later'] += 1; ex['pre_t15_later'].append(rec)
            if s[0] >= 15: st['pre_h1_ge15'] += 1
            if name: st['pre_named'] += 1; ex['pre_named'].append(rec)
        # non-pre streets already >=15 at hour 1
        for i in range(len(v['max'])):
            if not pre[i]:
                s = dec(v['series'][i])
                if s and s[0] >= 15: st['notpre_h1_ge15'] += 1; ex['notpre_h1_ge15'].append((t, i, g['segs'][i][0], g['segs'][i][1], s[:3]))
    out[run] = {'stats': dict(st), 'examples': {k: v[:400] for k, v in ex.items()}}
    print(run, dict(st))
json.dump(out, open('/home/tekiru/Desktop/highground/review/qa/run4/b1_scan.json', 'w'), indent=0)
