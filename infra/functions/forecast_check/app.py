"""forecast-check: EventBridge Scheduler (every 3 h) and POST /admin/run.

1. Open-Meteo hourly precipitation for Velachery, T. Nagar, Anna Nagar, Tambaram.
2. Next-24-hour totals -> mean -> the two nearest precomputed scenarios + blend weight.
3. Write current.json to S3.
4. For each subscriber, compare their street's risk band with the band stored at the
   last run; on change, Bedrock writes two plain sentences from the model numbers and
   SNS emails them (message attribute segment_id matches the subscriber's filter policy).
"""
from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timedelta

import boto3

import hg

POINTS = {"Velachery": (12.9791, 80.2209), "T. Nagar": (13.0418, 80.2341),
          "Anna Nagar": (13.0850, 80.2101), "Tambaram": (12.9249, 80.1000)}
TOTALS = [50, 100, 150, 200, 300, 400]
DRY_BELOW_MM = 25          # below half the smallest scenario we report "dry tonight"

ddb = boto3.resource("dynamodb").Table(os.environ["TABLE"])
sns = boto3.client("sns")
bedrock = boto3.client("bedrock-runtime")


def forecast():
    lats = ",".join(str(p[0]) for p in POINTS.values())
    lons = ",".join(str(p[1]) for p in POINTS.values())
    url = ("https://api.open-meteo.com/v1/forecast?"
           f"latitude={lats}&longitude={lons}&hourly=precipitation&forecast_days=2&timezone=Asia%2FKolkata")
    with urllib.request.urlopen(url, timeout=20) as r:
        data = json.loads(r.read())
    now = datetime.now(hg.IST).replace(minute=0, second=0, microsecond=0, tzinfo=None)
    out = {}
    start = None
    for name, loc in zip(POINTS, data):
        times = [datetime.fromisoformat(t) for t in loc["hourly"]["time"]]
        p = loc["hourly"]["precipitation"]
        i0 = next(i for i, t in enumerate(times) if t >= now)
        start = times[i0]
        seg = [x or 0.0 for x in p[i0:i0 + 24]]
        out[name] = dict(total_24h_mm=round(sum(seg), 1), hourly_mm=[round(x, 1) for x in seg])
    return start, out


def choose(total):
    if total < DRY_BELOW_MM:
        return None
    if total <= TOTALS[0]:
        return dict(lower=f"design_{TOTALS[0]}_mean", upper=f"design_{TOTALS[0]}_mean", w=0.0)
    if total >= TOTALS[-1]:
        return dict(lower=f"design_{TOTALS[-1]}_mean", upper=f"design_{TOTALS[-1]}_mean", w=0.0)
    for a, b in zip(TOTALS, TOTALS[1:]):
        if a <= total <= b:
            return dict(lower=f"design_{a}_mean", upper=f"design_{b}_mean", w=round((total - a) / (b - a), 3))


def write_alert(street, old, new, info, parking):
    """Bedrock turns model numbers into two sentences. Fallback text uses the same numbers."""
    facts = dict(street=street, old_band=old["label"], new_band=new["label"], max_depth_cm=info["max_depth_cm"],
                 reaches_15cm_at=info.get("reaches_15cm_at"), forecast_mm=info.get("forecast", {}).get("mean_24h_mm"),
                 dry_parking=parking[0]["name"] if parking else None,
                 dry_parking_m=parking[0]["straight_line_m"] if parking else None)
    prompt = (
        "Write a flood alert for a Chennai resident in exactly two short sentences: what changed, then what to do. "
        "Use only these facts and numbers; do not add any other number. If dry_parking is null, do not mention parking. "
        "If the new band is Dry, say the risk has dropped. Facts: " + json.dumps(facts))
    try:
        r = bedrock.converse(modelId=os.environ["MODEL_ID"],
                             messages=[{"role": "user", "content": [{"text": prompt}]}],
                             inferenceConfig={"maxTokens": 160, "temperature": 0.2})
        text = r["output"]["message"]["content"][0]["text"].strip()
    except Exception as e:  # keep alerts flowing even if Bedrock is unavailable
        print("bedrock error", e)
        mm = facts["forecast_mm"]
        mm = f"{mm:g}" if isinstance(mm, (int, float)) else mm
        text = (f"Tonight's forecast is about {mm} mm; {street} is now '{new['label']}' "
                f"with up to {facts['max_depth_cm']} cm of water"
                + (f" by {facts['reaches_15cm_at']}." if facts["reaches_15cm_at"] else ".")
                + (f" Move your car to {facts['dry_parking']} ({facts['dry_parking_m']} m away) before then."
                   if facts["dry_parking"] else ""))
    return text, facts


def handler(event, context):
    body = {}
    if isinstance(event, dict) and event.get("body"):
        body = json.loads(event["body"])
        if body.get("token") != os.environ.get("ADMIN_TOKEN"):
            return {"statusCode": 403, "body": json.dumps({"error": "bad token"})}
    start, pts = forecast()
    mean = round(sum(v["total_24h_mm"] for v in pts.values()) / len(pts), 1)
    override = body.get("override_mm")
    total = float(override) if override is not None else mean
    sc = choose(total)
    cur = dict(updated_at=datetime.now(hg.IST).isoformat(timespec="minutes"),
               start_local=start.isoformat(timespec="minutes"),
               forecast=dict(points=pts, mean_24h_mm=total if override is not None else mean,
                             source="Open-Meteo hourly precipitation", demo_override=override is not None),
               scenario=dict(sc, tide="mean") if sc else None,
               note=None if sc else "Forecast is below the smallest modelled storm; the model shows no flooding.")
    hg.s3.put_object(Bucket=hg.BUCKET, Key=hg.PREFIX + "current.json", Body=json.dumps(cur).encode(),
                     ContentType="application/json", CacheControl="max-age=60")

    sent = 0
    items = ddb.scan().get("Items", [])
    for it in items:
        info = hg.street_risk(float(it["lat"]), float(it["lon"]), sc=None) if sc else {"max_depth_cm": 0}
        new = hg.band(info.get("max_depth_cm", 0))
        old = hg.band(float(it.get("last_cm", 0)))
        if new["code"] != old["code"] or body.get("force_alert"):
            parking = hg.dry_parking(float(it["lat"]), float(it["lon"]))["options"] if sc else []
            text, facts = write_alert(it.get("street", "Your street"), old, new, info, parking)
            sns.publish(TopicArn=os.environ["TOPIC_ARN"], Subject=f"HighGround: {it.get('street', 'your street')} — {new['label']}",
                        Message=text + "\n\nNumbers from the HighGround flood model (not an official warning). "
                                       "Follow GCC/IMD advisories. In danger, call 112.\n" + os.environ.get("SITE_URL", ""),
                        MessageAttributes={"segment_id": {"DataType": "String", "StringValue": it["segment_id"]}})
            sent += 1
        ddb.update_item(Key={"pk": it["pk"]}, UpdateExpression="SET last_cm = :c, last_run = :t",
                        ExpressionAttributeValues={":c": int(info.get("max_depth_cm", 0)), ":t": cur["updated_at"]})
    result = dict(current=cur, subscribers=len(items), alerts_sent=sent)
    print(json.dumps(result)[:2000])
    return {"statusCode": 200, "headers": {"content-type": "application/json"}, "body": json.dumps(result)}
