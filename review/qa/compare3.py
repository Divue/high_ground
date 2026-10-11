"""QA run 3: compare the hero-flow UI readings (qa3_hero.json) with the model files (ref3.py logic)."""
import json, subprocess, sys, re
from datetime import datetime, timedelta
from pathlib import Path
OUT = Path('/home/tekiru/Desktop/highground/review/qa/run3')
H = json.loads((OUT / 'qa3_hero.json').read_text())
runs = json.loads(Path('/home/tekiru/Desktop/highground/data/out/web/runs.json').read_text())
qs = [{'q': r['q'], 'run': r['run'], 'lon': r['card']['here'][0], 'lat': r['card']['here'][1]} for r in H['results'] if r.get('card') and r['card'].get('here')]
ref = {}
for line in subprocess.run([sys.executable, str(OUT.parent / 'ref3.py'), json.dumps(qs)], capture_output=True, text=True, check=True).stdout.splitlines():
    d = json.loads(line); ref[(d['run'], d['q'])] = d

now = datetime.now()
start = now.replace(hour=18, minute=0, second=0, microsecond=0) - (timedelta(days=1) if now.hour < 6 else timedelta(0))
def clock(h, with_day=None):
    t = start + timedelta(hours=h)
    with_day = h > 12 if with_day is None else with_day
    s = f"{t.hour % 12 or 12} {'AM' if t.hour < 12 else 'PM'}"
    return f"{t:%a} {s}" if with_day else s
norm = lambda s: re.sub(r'\s+', ' ', (s or '').replace(' ', ' ')).strip()

issues = []
rows = []
for r in H['results']:
    k = (r['run'], r['q']); c = r.get('card'); f = ref.get(k)
    if not c or not f:
        issues.append(f"{k}: no card/ref ({r.get('error')})"); continue
    p = []
    big = int(re.match(r'(\d+)', c['readout_label']).group(1))
    if c['street'].replace(' (on a bridge)', '') != f['street']: p.append(f"street UI {c['street']} vs ref {f['street']}")
    if big != f['round_max']: p.append(f"big number {big} vs ref max {f['round_max']}")
    if big != f['peak']: p.append(f"big number {big} vs series peak {f['peak']}")
    if c['readout_shown'] and int(c['readout_shown']) != big: p.append(f"shown {c['readout_shown']} != label {big}")
    g = c['glyph'] and int(re.search(r'Water at (\d+)', c['glyph']).group(1))
    if big >= 5 and g != big: p.append(f"glyph {g} vs big {big}")
    if big < 5 and c['glyph']: p.append('glyph shown for dry street')
    when = norm(c['when'])
    if f['t15_hour']:
        exp = f"Reaches 15 cm by {clock(f['t15_hour'])}"
        if not when.startswith(exp): p.append(f"when '{when}' vs expected '{exp}'")
    elif f['peak'] >= 5 and not when.startswith('Stays under 15 cm'): p.append(f"when '{when}' expected Stays under 15 cm")
    elif f['peak'] < 5 and when != 'Stays dry': p.append(f"when '{when}' expected Stays dry")
    if f['peak'] >= 5 and f['peak_hour'] and f"peak {clock(f['peak_hour'])}" not in when: p.append(f"peak time in '{when}' vs expected peak {clock(f['peak_hour'])}")
    if f['json_t15'] not in (None, -1) and f['t15_hour'] and abs(f['json_t15'] - f['t15_hour']) > 0: p.append(f"t15 json {f['json_t15']} vs series {f['t15_hour']}")
    # slider after the rise sits at the peak hour
    if f['peak_hour'] and c['slider'] and c['slider']['v'] != f['peak_hour'] and not r.get('when_to_leave'): p.append(f"slider at {c['slider']['v']} after rise, peak hour {f['peak_hour']}")
    if c['slider'] and c['slider']['max'] != runs[r['run']]['hours']: p.append(f"slider max {c['slider']['max']} vs hours {runs[r['run']]['hours']}")
    # every hour read back vs series
    bad_h = []
    for hh in r.get('hours') or []:
        h = hh['h']; exp_v = f['series'][h - 1]
        if norm(hh['now']) != clock(h): bad_h.append(f"h{h} clock {norm(hh['now'])} vs {clock(h)}")
        if h != f['peak_hour']:
            m = re.match(r'At (.+?): (\d+) cm', norm(hh['at'] or ''))
            if not m: bad_h.append(f"h{h} no At line"); continue
            if int(m.group(2)) != exp_v: bad_h.append(f"h{h} At {m.group(2)} vs series {exp_v}")
            if m.group(1) != clock(h): bad_h.append(f"h{h} At clock {m.group(1)} vs {clock(h)}")
        else:
            if hh['at']: bad_h.append(f"h{h}=peak but At line shown")
        rr = runs[r['run']]['rain_mm_h']; exp_rain = round(rr[h - 1]) if h - 1 < len(rr) else 0
        mm = re.match(r'(\d+) mm', hh['rain'] or '')
        if not mm or int(mm.group(1)) != exp_rain: bad_h.append(f"h{h} rain '{hh['rain']}' vs {exp_rain}")
    if bad_h: p.append(f"hour readback: {len(bad_h)} mismatches e.g. {bad_h[:3]}")
    # rise samples: shown number within [0, max], slider monotonic, ends at peak
    rise = r.get('rise') or []
    if rise:
        ns = [s['n'] for s in rise if s['n'] is not None]
        hs = [s['h'] for s in rise if s['h'] is not None]
        if ns and max(ns) > big: p.append(f"rise shows {max(ns)} > peak {big}")
        if any(b < a for a, b in zip(hs, hs[1:])): p.append(f"slider went backwards during rise {hs}")
        # number vs series at the slider hour (allow the 320 ms tween: compare with any value between prev and this hour)
        off = 0
        for s in rise:
            if s['n'] is None or s['h'] is None or 'at the peak' in (s['label'] or ''): continue
            lo = min(f['series'][max(0, s['h'] - 9):s['h']]) if s['h'] > 0 else 0
            hi = max(f['series'][max(0, s['h'] - 9):s['h']]) if s['h'] > 0 else 0
            if not (lo - 1 <= s['n'] <= hi + 1): off += 1
        if off: p.append(f"rise: {off}/{len(rise)} samples where the number is outside the series range near the slider hour")
        gl = [(s['n'], s['glyph']) for s in rise if s['glyph'] is not None and s['n'] is not None and int(s['glyph']) != s['n']]
        if gl: p.append(f"rise: glyph != number in {len(gl)} samples e.g. {gl[:2]}")
        r['rise_summary'] = {'samples': len(rise), 'hours': sorted(set(hs)), 'numbers': ns[:: max(1, len(ns) // 12)], 'ms_to_peak_note': next((s['t'] for s in rise if 'at the peak' in (s['label'] or '')), None)}
    # parking
    ui_p = [re.match(r'(.+?), ([\d.]+ k?m)', x).groups() for x in c['parking']]
    rp = f['parking']
    if ui_p and rp:
        if ui_p[0][0] != rp[0]['name']: p.append(f"parking #1 UI {ui_p[0][0]} vs ref {rp[0]['name']}")
    elif ui_p or rp: p.append(f"parking UI {ui_p} vs ref {rp}")
    if rp and rp[0]['d_m'] > 1500: p.append(f"nearest dry parking is {rp[0]['d_m']} m away ({rp[0]['name']})")
    if r.get('parking_after_more') and len(rp) > 1:
        if not r['parking_after_more'][1].startswith(rp[1]['name']): p.append(f"2nd parking UI {r['parking_after_more'][1]} vs ref {rp[1]['name']}")
    if len(rp) > 1 and not any('more dry place' in b for b in c['more_btn']) and not r.get('parking_after_more'): p.append('no "1 more" button though 2+ dry options')
    # nearby
    m = re.match(r'(\d+) of (\d+) streets', c['nearby'] or '')
    if m and (int(m.group(1)), int(m.group(2))) != tuple(f['nearby']): p.append(f"nearby UI {m.groups()} vs ref {f['nearby']}")
    # decision / leave-by
    if f['t15_hour'] and rp:
        d = norm(c['decision'])
        dm = re.match(r'Move your car to (.+?) by (.+)\.', d)
        if dm:
            if dm.group(1) != rp[0]['name']: p.append(f"decision target {dm.group(1)} vs parking #1 {rp[0]['name']}")
            if norm(c['marker']) != f"leave by {dm.group(2)}": p.append(f"marker '{c['marker']}' vs decision time {dm.group(2)}")
            lb = round(float(c['marker_left'].rstrip('%')) / 100 * (runs[r['run']]['hours'] - 1)) + 1 if c['marker_left'] else None
            if lb and lb > max(1, f['t15_hour'] - 1): p.append(f"leave-by hour {lb} not before 15 cm hour {f['t15_hour']}")
            if lb and clock(lb) != dm.group(2): p.append(f"marker position hour {lb} ({clock(lb)}) vs label {dm.group(2)}")
            if lb and f['series'][lb - 1] >= 15: p.append(f"leave-by hour {lb}: street already {f['series'][lb-1]} cm")
            if c['route_safe_pts'] < 2: p.append('decision but no amber route drawn')
        else: p.append(f"flooding street, decision='{d}'")
    if not f['t15_hour'] and c['decision']: p.append('decision shown for a street that never reaches 15 cm')
    if f['frame_vs_series_max_abs_diff'] and f['frame_vs_series_max_abs_diff'] > 10: p.append(f"water frame vs series differ by up to {f['frame_vs_series_max_abs_diff']} cm ({f['frame_vs_series_hours_diff_gt10']} hours >10 cm)")
    if not c['subscribe_btn']: p.append('no subscribe button')
    elif c['subscribe_visible'] is False: p.append('subscribe button below the fold of the card')
    rows.append({'run': r['run'], 'q': r['q'], 'street': c['street'], 'big': big, 'when': when, 'band': c['band'], 'decision': norm(c['decision']), 'marker': c['marker'],
                 'parking': c['parking'], 'more': r.get('parking_after_more'), 'nearby': c['nearby'], 'wtl': r.get('when_to_leave'), 'rise': r.get('rise_summary'),
                 'ref': {k2: f[k2] for k2 in ('seg', 'round_max', 't15_hour', 'peak_hour', 'parking', 'nearby', 'frame_vs_series_max_abs_diff')}, 'problems': p})
for x in rows:
    print(json.dumps(x, ensure_ascii=False))
(OUT / 'compare3.json').write_text(json.dumps(rows, indent=1, ensure_ascii=False))
print('TOTAL rows', len(rows), 'with problems', sum(1 for x in rows if x['problems']))
for i in issues: print('ISSUE', i)
