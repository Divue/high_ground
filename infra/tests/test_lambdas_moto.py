"""Local end-to-end test of subscribe -> forecast-check -> SNS alert, with moto mocking
S3, DynamoDB, SNS and SQS. Model files come from data/out/web. Bedrock is stubbed to fail
so the fallback alert text (built from the same numbers) is exercised."""
import importlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "data" / "out" / "web"
os.environ.update(AWS_ACCESS_KEY_ID="testing", AWS_SECRET_ACCESS_KEY="testing", AWS_DEFAULT_REGION="us-east-1",
                  DATA_BUCKET="hg-test", DATA_PREFIX="data/", TABLE="subs", MODEL_ID="stub", ADMIN_TOKEN="t0k")
os.environ.pop("AWS_PROFILE", None)
sys.path.insert(0, str(ROOT / "infra" / "layers" / "common" / "python"))

import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

LAT, LON = 12.9633, 80.2137   # Arumugam Road, Velachery
RUN = sys.argv[1] if len(sys.argv) > 1 else "design_200_mean"


@mock_aws
def main():
    s3 = boto3.client("s3")
    s3.create_bucket(Bucket="hg-test")
    idx = json.loads((WEB / "streets/index.json").read_text())
    keys = ["streets/index.json", "parking.json", "hospitals.json", "runs.json"]
    for t, (w, s, e, n) in idx["tile_bounds_lonlat"].items():
        if w - 0.01 < LON < e + 0.01 and s - 0.01 < LAT < n + 0.01:
            keys.append(f"streets/geom/{t}.json")
            keys += [f"streets/{r}/{t}.json" for r in idx["runs"]]
    for k in keys:
        if (WEB / k).exists():
            s3.put_object(Bucket="hg-test", Key="data/" + k, Body=(WEB / k).read_bytes())
    boto3.client("dynamodb").create_table(TableName="subs", BillingMode="PAY_PER_REQUEST",
                                          AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}],
                                          KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}])
    sns = boto3.client("sns")
    topic = sns.create_topic(Name="alerts")["TopicArn"]
    os.environ["TOPIC_ARN"] = topic

    for mod in ("app",):
        sys.modules.pop(mod, None)
    sys.path.insert(0, str(ROOT / "infra/functions/subscribe"))
    sub = importlib.import_module("app")
    r = sub.handler({"body": json.dumps({"email": "resident@example.com", "lat": LAT, "lon": LON})}, None)
    print("subscribe:", r["statusCode"], r["body"])
    seg = json.loads(r["body"])["segment_id"]

    # an SQS queue with the same filter policy stands in for the inbox
    sqs = boto3.client("sqs")
    q = sqs.create_queue(QueueName="inbox")["QueueUrl"]
    qarn = sqs.get_queue_attributes(QueueUrl=q, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
    sns.subscribe(TopicArn=topic, Protocol="sqs", Endpoint=qarn,
                  Attributes={"FilterPolicy": json.dumps({"segment_id": [seg]}), "FilterPolicyScope": "MessageAttributes",
                              "RawMessageDelivery": "true"})

    sys.modules.pop("app", None)
    sys.path.remove(str(ROOT / "infra/functions/subscribe"))
    sys.path.insert(0, str(ROOT / "infra/functions/forecast_check"))
    fc = importlib.import_module("app")
    fc.bedrock.converse = lambda **k: (_ for _ in ()).throw(RuntimeError("bedrock stubbed"))
    fc.choose = lambda total: {"run": RUN} if total else None   # pin the scenario to a run present in the test data
    r = fc.handler({"body": json.dumps({"token": "t0k", "override_mm": 210, "force_alert": True})}, None)
    body = json.loads(r["body"])
    print("forecast-check:", r["statusCode"], "subscribers", body["subscribers"], "alerts", body["alerts_sent"])
    msgs = sqs.receive_message(QueueUrl=q, MaxNumberOfMessages=5).get("Messages", [])
    print("inbox:", len(msgs), "message(s)")
    for m in msgs:
        print("---\n" + m["Body"][:600])
    cur = json.loads(s3.get_object(Bucket="hg-test", Key="data/current.json")["Body"].read())
    print("current.json scenario:", cur["scenario"], "| forecast mm:", cur["forecast"]["mean_24h_mm"])
    assert r["statusCode"] == 200 and body["alerts_sent"] >= 1 and msgs, "alert path failed"
    print("OK: subscribe -> forecast-check -> SNS -> filtered delivery")


if __name__ == "__main__":
    main()
