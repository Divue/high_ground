#!/usr/bin/env bash
# One-command AWS deploy for HighGround. Uses only the profile named in .env (currently AWS_PROFILE=default).
#   1. checks credentials, creates the $30 budget alarm if missing
#   2. picks the newest enabled Claude Sonnet model/inference profile on Bedrock
#   3. sam deploy (S3, Lambda, API Gateway, DynamoDB, SNS, EventBridge Scheduler, Amplify app)
#   4. uploads the model outputs the Lambdas read to s3://<bucket>/data/
#   5. runs forecast-check once so current.json exists
#   6. builds the web app against API Gateway and deploys it, with the model outputs, to Amplify Hosting
# The site's data is served by Amplify Hosting, not by a CloudFront distribution of our own: AWS does not
# create CloudFront resources on this account until Support has verified it.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd .. && pwd)
set -a; source "$ROOT/.env"; set +a
: "${AWS_PROFILE:?AWS_PROFILE missing in .env}"
: "${AWS_REGION:?AWS_REGION missing in .env}"
export AWS_PROFILE AWS_REGION AWS_DEFAULT_REGION=$AWS_REGION
export PATH=$HOME/.local/bin:$HOME/.nvm/versions/node/v24.21.0/bin:$PATH
STACK=${STACK:-highground}
LOG=$ROOT/data/logs
mkdir -p "$LOG"

echo "== identity"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "account ${ACCOUNT:0:4}******** region $AWS_REGION profile $AWS_PROFILE"

echo "== budget alarm (\$30)"
if ! aws budgets describe-budget --account-id "$ACCOUNT" --budget-name highground-30usd >/dev/null 2>&1; then
  NOTIFY=${ALERT_TEST_EMAIL:-}
  BUDGET='{"BudgetName":"highground-30usd","BudgetLimit":{"Amount":"30","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}'
  if [[ "$NOTIFY" == *@* && "$NOTIFY" != "you@example.com" ]]; then
    aws budgets create-budget --account-id "$ACCOUNT" --budget "$BUDGET" \
      --notifications-with-subscribers "[{\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":80,\"ThresholdType\":\"PERCENTAGE\"},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$NOTIFY\"}]}]"
  else
    aws budgets create-budget --account-id "$ACCOUNT" --budget "$BUDGET"
  fi
  echo "created budget highground-30usd"
else
  echo "budget exists"
fi

echo "== Bedrock model"
MODEL_ID=${MODEL_ID:-$(python3 - <<'EOF'
import json, subprocess
def run(*a):
    return json.loads(subprocess.run(["aws", *a, "--output", "json"], capture_output=True, text=True, check=True).stdout)
profiles = run("bedrock", "list-inference-profiles").get("inferenceProfileSummaries", [])
cands = [p["inferenceProfileId"] for p in profiles if "anthropic.claude" in p["inferenceProfileId"]
         and p.get("status", "ACTIVE") == "ACTIVE"]
def score(i):
    s = 0
    if "sonnet" in i: s += 1000
    import re
    nums = [int(x) for x in re.findall(r"(\d+)", i.split("anthropic.claude")[-1])[:3]]
    return (s, nums)
cands.sort(key=score, reverse=True)
us = [c for c in cands if c.startswith("us.")] or cands
print(us[0] if us else "")
EOF
)}
[ -n "$MODEL_ID" ] || { echo "No Claude model available on Bedrock in $AWS_REGION"; exit 1; }
echo "model: $MODEL_ID"
if ! aws bedrock-runtime converse --model-id "$MODEL_ID" --messages '[{"role":"user","content":[{"text":"Reply with OK"}]}]' \
     --inference-config maxTokens=5 >/dev/null 2>"$LOG/bedrock_check.err"; then
  echo "WARNING: Bedrock converse failed (model access not enabled?): $(head -c 300 "$LOG/bedrock_check.err")"
fi

echo "== SAM deploy"
ADMIN_TOKEN=${ADMIN_TOKEN:-$(cat "$ROOT/data/admin_token" 2>/dev/null || (openssl rand -hex 12 | tee "$ROOT/data/admin_token"))}
[ -d layers/strands/python/strands ] || { echo "Strands layer missing: build it first (see README)"; exit 1; }
# a first deploy that failed leaves an empty ROLLBACK_COMPLETE stack that cannot be updated
if [ "$(aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true)" = ROLLBACK_COMPLETE ]; then
  aws cloudformation delete-stack --stack-name "$STACK"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK"
fi
sam deploy --stack-name "$STACK" --region "$AWS_REGION" --profile "$AWS_PROFILE" --resolve-s3 \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --no-confirm-changeset --no-fail-on-empty-changeset \
  --parameter-overrides "BedrockModelId=$MODEL_ID" "AdminToken=$ADMIN_TOKEN" | tail -20

out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET=$(out DataBucketName); API=$(out ApiUrl); APP=$(out AmplifyAppId); SITE=$(out SiteUrl)
echo "bucket $BUCKET  api $API  site $SITE"

echo "== upload the model outputs the Lambdas read"
# size + time (not --size-only): a re-export that keeps a file's size must still upload.
# Stored as they are (the Lambdas read the bytes directly); browsers get their copy from Amplify Hosting.
aws s3 sync "$ROOT/data/out/web/" "s3://$BUCKET/data/" --exclude "*" --include "streets/*" \
  --include "parking.json" --include "hospitals.json" --include "graph/nodes.bin" --include "graph/edges.bin" \
  --include "graph/len.bin" --include "graph/depth_*.bin" --no-progress | tail -3

echo "== site URL into the stack (alert emails link to it)"
sam deploy --stack-name "$STACK" --region "$AWS_REGION" --profile "$AWS_PROFILE" --resolve-s3 \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --no-confirm-changeset --no-fail-on-empty-changeset \
  --parameter-overrides "BedrockModelId=$MODEL_ID" "AdminToken=$ADMIN_TOKEN" "SiteUrl=$SITE" | tail -3

echo "== first forecast check"
curl -s -X POST "$API/admin/run" -H 'content-type: application/json' -d "{\"token\":\"$ADMIN_TOKEN\"}" | head -c 600; echo

echo "== build + deploy web and model outputs (Amplify Hosting)"
cd "$ROOT/web"
VITE_API_BASE="$API" npx vite build >/dev/null
rm -f dist/data/current.json   # tonight's forecast comes from the API (an Amplify rule passes it on), not from this copy
rm -f "$ROOT/data/site.zip"; (cd dist && zip -qr "$ROOT/data/site.zip" .)
echo "site.zip $(du -h "$ROOT/data/site.zip" | cut -f1), $(find dist -type f | wc -l) files"
# The bundle goes to our own bucket first, two 5 MB parts at a time, and Amplify fetches it from there.
# One long upload to Amplify's own upload address timed out (HTTP 400) on a slow, lossy link, and ten parts
# at once each ran too slowly to finish before the connection dropped.
UPCFG=$(mktemp)
[ "$AWS_PROFILE" = default ] && SECTION=default || SECTION="profile $AWS_PROFILE"
printf '[%s]\nregion = %s\nretry_mode = standard\nmax_attempts = 10\ns3 =\n    max_concurrent_requests = 2\n    multipart_chunksize = 5MB\n    multipart_threshold = 5MB\n' \
  "$SECTION" "$AWS_REGION" > "$UPCFG"
AWS_CONFIG_FILE="$UPCFG" aws s3 cp "$ROOT/data/site.zip" "s3://$BUCKET/deploy/site.zip" --no-progress >/dev/null
rm -f "$UPCFG"
# a run that stopped half-way leaves an unfinished job, and Amplify refuses a new one until it is cancelled
for j in $(aws amplify list-jobs --app-id "$APP" --branch-name main \
    --query "jobSummaries[?status=='PENDING' || status=='CREATED' || status=='RUNNING'].jobId" --output text); do
  aws amplify stop-job --app-id "$APP" --branch-name main --job-id "$j" >/dev/null
done
SRC=$(aws s3 presign "s3://$BUCKET/deploy/site.zip" --expires-in 3600)
JOB=$(aws amplify start-deployment --app-id "$APP" --branch-name main --source-url "$SRC" --source-url-type ZIP \
  --query jobSummary.jobId --output text)
S=PENDING
for i in $(seq 1 360); do
  S=$(aws amplify get-job --app-id "$APP" --branch-name main --job-id "$JOB" --query job.summary.status --output text)
  [ "$S" = SUCCEED ] && break; [ "$S" = FAILED ] && { echo "Amplify deploy failed"; exit 1; }; sleep 5
done
[ "$S" = SUCCEED ] || { echo "Amplify deploy still $S after 30 minutes"; exit 1; }
echo "== live: $SITE"
cat > "$ROOT/data/deploy_outputs.json" <<EOF
{"bucket":"$BUCKET","api":"$API","site":"$SITE","model":"$MODEL_ID","amplify_app":"$APP"}
EOF
