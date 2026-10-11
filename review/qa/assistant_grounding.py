"""QA run 4: offline check of the assistant's number-grounding (infra/functions/assistant/app.py) with the real
tool output for a street (Lambda layer on local data). Strands/Bedrock are stubbed; no LLM is called.
Feeds replies containing invented numbers and reports which ones the checker marks 'from the model'."""
import json, os, sys, types
from pathlib import Path
ROOT = Path('/home/tekiru/Desktop/highground')
os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
sys.path.insert(0, str(ROOT / 'infra/layers/common/python'))
import hg
WEB = ROOT / 'data/out/web'
hg._get = lambda key: (WEB / key).read_bytes()
st = types.ModuleType('strands'); st.Agent = object; st.tool = lambda f: f
sm = types.ModuleType('strands.models'); sm.BedrockModel = object
sys.modules['strands'] = st; sys.modules['strands.models'] = sm
sys.path.insert(0, str(ROOT / 'infra/functions/assistant'))
import app
sc = {'run': 'michaung2023', 'start_local': '2026-10-09T18:00'}
app.CTX['scenario'] = sc
r = app.get_street_risk(12.96328, 80.21367)          # Arumugam Road
print('tool says: street', r['street'], 'max', r['max_depth_cm'], 'reaches 15 cm at', r['reaches_15cm_at'], 'peak at', r['peak_at'])
tests = {
  'faithful': f"In the Michaung replay, {r['street']} peaks at about {r['max_depth_cm']} cm around {r['peak_at']}.",
  'invented depth 20 cm': f"{r['street']} will have about 20 cm of water.",
  'invented depth 45 cm': f"{r['street']} will have about 45 cm of water.",
  'invented 3 km detour': "The safe route is 3 km longer.",
  'invented 85% chance': "There is an 85% chance your street floods.",
  'invented 7 hospitals': "7 hospitals will be cut off tonight.",
  'invented 250 mm': "About 250 mm of rain is expected.",
}
for k, txt in tests.items():
    g = app.grounding(txt)
    print(f'{k:24} -> ', [(n['value'], 'from the model' if n['grounded'] else 'NOT in model output') for n in g])
