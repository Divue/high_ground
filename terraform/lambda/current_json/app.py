"""GET /data/current.json: tonight's forecast, as the forecast-check Lambda last wrote it to S3.

The site is served by Amplify Hosting, and the forecast changes every 3 hours, so it is not part of
the published site: an Amplify rule passes the site's /data/current.json on to this function.
While address search is switched off in the Terraform (enable_address_search = false) this function
also answers POST /geocode with an empty list, so the site keeps to its own list of places and streets,
as the local build does, without a failed request in the browser.
Deployment glue only; it lives with the Terraform and reads the file, nothing else.
"""
import json
import os

import boto3

s3 = boto3.client("s3")


def handler(event, context):
    if event.get("routeKey") == "POST /geocode":
        return {"statusCode": 200, "headers": {"content-type": "application/json"},
                "body": json.dumps({"source": "", "results": []})}
    try:
        body = s3.get_object(Bucket=os.environ["DATA_BUCKET"],
                             Key=os.environ.get("DATA_PREFIX", "data/") + "current.json")["Body"].read().decode()
        return {"statusCode": 200, "headers": {"content-type": "application/json", "cache-control": "no-store"},
                "body": body}
    except Exception as e:
        print("current.json not readable", e)
        return {"statusCode": 404, "headers": {"content-type": "application/json"},
                "body": json.dumps({"error": "No forecast has been written yet."})}
