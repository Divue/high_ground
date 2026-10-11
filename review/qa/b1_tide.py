"""QA run 4: street segments that read deep water at hour 1 in a high-tide run but are dry at hour 1 in the
matching mean-tide run (sea water at high tide counted as street flooding)."""
import json, base64, struct
from pathlib import Path
WEB = Path('/home/tekiru/Desktop/highground/data/out/web')
idx = json.loads((WEB / 'streets/index.json').read_text())
dec = lambda b: struct.unpack(f'<{len(base64.b64decode(b))//2}H', base64.b64decode(b))
for hi, lo in [('design_200_high', 'design_200_mean'), ('design_50_high', 'design_50_mean')]:
    n = 0; named = []; peak_at_h1 = 0
    for t in idx['tile_bounds_lonlat']:
        g = json.loads((WEB / f'streets/geom/{t}.json').read_text())['segs']
        a = json.loads((WEB / f'streets/{hi}/{t}.json').read_text()); b = json.loads((WEB / f'streets/{lo}/{t}.json').read_text())
        for i in range(len(g)):
            sa, sb = dec(a['series'][i]), dec(b['series'][i])
            if sa[0] >= 15 and sb[0] < 5:
                n += 1
                if g[i][1]: named.append((g[i][1], sa[0], a['max'][i], a['pre'][i], g[i][4][0], g[i][4][1]))
    print(hi, 'vs', lo, 'segments >=15 cm at hour 1 only at high tide:', n, 'named:', len(named))
    for x in sorted(set(named))[:40]: print('   ', x)
