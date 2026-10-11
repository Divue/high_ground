"""QA run 3: expected 'Watch the whole storm' captions per hour, derived independently from runs.json."""
import json, sys
from datetime import datetime, timedelta
runs = json.load(open('/home/tekiru/Desktop/highground/data/out/web/runs.json'))
def short(start, h):
    d = start + timedelta(hours=h)
    t = f"{d.hour % 12 or 12}{':%02d' % d.minute if d.minute else ''} {'AM' if d.hour < 12 else 'PM'}"
    return f"{d:%a} {t}"
def full(start, h):
    d = start + timedelta(hours=h)
    t = f"{d.hour % 12 or 12}:{d.minute:02d} {'AM' if d.hour < 12 else 'PM'}"
    return f"{d:%a} {d.day} {d:%b} {d.year}, {t}"
out = {}
for rid in sys.argv[1:]:
    r = runs[rid]; s = datetime.fromisoformat(r['start_local'])
    rain = r['rain_mm_h']; w = r['wet_share_15cm_hourly']
    ev = []
    first = next((i for i, x in enumerate(rain) if x >= 1), None)
    if first is not None: ev.append((first + 1, 'Rain begins.'))
    hv = rain.index(max(rain)); ev.append((hv + 1, f"{round(rain[hv])} mm fell in this one hour"))
    if r.get('reservoir'):
        res = r['reservoir']
        hr = lambda t: round((datetime.fromisoformat(t) - s).total_seconds() / 3600)
        ev.append((max(1, hr(res['rising_from_local'])), 'release passes 10,000 cusecs'))
        ev.append((max(1, hr(res['peak_from_local'])), f"peak, {res['peak_cusecs']:,} cusecs"))
    k = w.index(max(w)); ev.append((k + 1, f"{round(w[k]*100)}% of the modelled area passes 15 cm"))
    last = max((i for i, x in enumerate(rain) if x >= 1), default=-1)
    if last >= 0 and last + 2 <= r['hours']: ev.append((last + 2, 'The rain stops.'))
    ev.append((r['hours'], f"{r['hours']} hours after the start, {round(w[-1]*100)}% of the land is still under 15 cm."))
    ev.sort()
    out[rid] = {'start': r['start_local'], 'hours': r['hours'], 'reservoir': r.get('reservoir'),
                'events': [(h, short(s, h), t) for h, t in ev],
                'per_hour': {h: {'clock': full(s, h), 'share': f"{round(w[h-1]*100)}%"} for h in range(1, r['hours'] + 1)}}
print(json.dumps(out))
