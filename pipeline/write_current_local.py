"""Write data/out/web/current.json from the live Open-Meteo forecast, using the same code
as the forecast-check Lambda (for local runs and offline builds; no AWS calls)."""
import json
import sys
import types
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "infra/layers/common/python"))
sys.path.insert(0, str(ROOT / "infra/functions/forecast_check"))
import os
os.environ.update(TABLE="local", TOPIC_ARN="local", MODEL_ID="local", AWS_DEFAULT_REGION="us-east-1")
import boto3  # noqa: E402
boto3.resource = lambda *a, **k: types.SimpleNamespace(Table=lambda n: None)
import app  # noqa: E402
import hg  # noqa: E402

start, pts = app.forecast()
mean = round(sum(v["total_24h_mm"] for v in pts.values()) / len(pts), 1)
sc = app.choose(mean)
cur = dict(updated_at=datetime.now(hg.IST).isoformat(timespec="minutes"), start_local=start.isoformat(timespec="minutes"),
           forecast=dict(points=pts, mean_24h_mm=mean, source="Open-Meteo hourly precipitation", demo_override=False),
           scenario=dict(sc, tide="mean") if sc else None,
           note=None if sc else "Forecast is below the smallest modelled storm; the model shows no flooding.")
(ROOT / "data/out/web/current.json").write_text(json.dumps(cur))
print(json.dumps({k: cur[k] for k in ("updated_at", "scenario", "note")}), "mean", mean)
