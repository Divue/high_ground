"""subscribe: POST /subscribe {email, lat, lon}

Finds the street segment, stores the subscriber in DynamoDB, and creates (or updates)
an SNS email subscription whose filter policy lists the subscriber's segment ids.
The resident confirms through the email SNS sends.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime

import boto3

import hg

ddb = boto3.resource("dynamodb").Table(os.environ["TABLE"])
sns = boto3.client("sns")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"}, "body": json.dumps(body)}


def handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
        email = body["email"].strip().lower()
        lat, lon = float(body["lat"]), float(body["lon"])
    except Exception:
        return _resp(400, {"error": "Send email, lat and lon."})
    if not EMAIL.match(email):
        return _resp(400, {"error": "That email address does not look right."})
    seg = hg.nearest_segment(lat, lon)
    if seg is None:
        return _resp(400, {"error": "That point is outside the area HighGround models (Greater Chennai)."})

    risk = hg.street_risk(lat, lon) if hg.current().get("scenario") else {"max_depth_cm": 0}
    ddb.put_item(Item=dict(pk=f"{email}#{seg['segment_id']}", email=email, segment_id=seg["segment_id"],
                           street=seg["name"], lat=str(lat), lon=str(lon),
                           last_cm=int(risk.get("max_depth_cm", 0)),
                           created=datetime.now(hg.IST).isoformat(timespec="minutes")))
    # all segments this email follows
    segs = sorted({it["segment_id"] for it in ddb.scan(
        FilterExpression="email = :e", ExpressionAttributeValues={":e": email}).get("Items", [])})
    policy = json.dumps({"segment_id": segs})

    topic = os.environ["TOPIC_ARN"]
    existing = None
    for page in sns.get_paginator("list_subscriptions_by_topic").paginate(TopicArn=topic):
        for s in page["Subscriptions"]:
            if s["Protocol"] == "email" and s["Endpoint"].lower() == email:
                existing = s["SubscriptionArn"]
    if existing and existing.startswith("arn:"):
        sns.set_subscription_attributes(SubscriptionArn=existing, AttributeName="FilterPolicy", AttributeValue=policy)
        status = "subscribed"
    elif existing:
        status = "pending_confirmation"
    else:
        sns.subscribe(TopicArn=topic, Protocol="email", Endpoint=email, ReturnSubscriptionArn=True,
                      Attributes={"FilterPolicy": policy, "FilterPolicyScope": "MessageAttributes"})
        status = "confirmation_sent"
    return _resp(200, {"status": status, "street": seg["name"], "segment_id": seg["segment_id"]})
