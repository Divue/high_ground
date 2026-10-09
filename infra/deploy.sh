#!/usr/bin/env bash
# One-command AWS deploy for HighGround. Uses ONLY the profile named in .env (AWS_PROFILE=highground).
#   1. checks credentials, creates the $10 budget alarm if missing
#   2. picks the newest enabled Claude Sonnet model/inference profile on Bedrock
#   3. sam deploy (S3, CloudFront, Lambda, API Gateway, DynamoDB, SNS, EventBridge Scheduler, Amplify app)
#   4. uploads model outputs to s3://<bucket>/data/
#   5. builds the web app against CloudFront + API Gateway and deploys it to Amplify Hosting
#   6. runs forecast-check once so current.json exists
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

echo "== budget alarm (\$10)"
if ! aws budgets describe-budget --account-id "$ACCOUNT" --budget-name highground-10usd >/dev/null 2>&1; then
  NOTIFY=${ALERT_TEST_EMAIL:-}
  BUDGET='{"BudgetName":"highground-10usd","BudgetLimit":{"Amount":"10","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}'
  if [[ "$NOTIFY" == *@* && "$NOTIFY" != "you@example.com" ]]; then
    aws budgets create-budget --account-id "$ACCOUNT" --budget "$BUDGET" \
      --notifications-with-subscribers "[{\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":80,\"ThresholdType\":\"PERCENTAGE\"},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$NOTIFY\"}]}]"
  else
    aws budgets create-budget --account-id "$ACCOUNT" --budget "$BUDGET"
  fi
  echo "created budget highground-10usd"
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
sam deploy --stack-name "$STACK" --region "$AWS_REGION" --profile "$AWS_PROFILE" --resolve-s3 \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --no-confirm-changeset --no-fail-on-empty-changeset \
  --parameter-overrides "BedrockModelId=$MODEL_ID" "AdminToken=$ADMIN_TOKEN" | tail -20

out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET=$(out DataBucketName); CDN=$(out CdnDomain); API=$(out ApiUrl); APP=$(out AmplifyAppId); SITE=$(out SiteUrl)
echo "bucket $BUCKET  cdn $CDN  api $API  site $SITE"

echo "== upload model outputs"
aws s3 sync "$ROOT/data/out/web/" "s3://$BUCKET/data/" --exclude "current.json" --size-only --no-progress | tail -3
aws s3 cp "$ROOT/data/out/web/basemap/chennai.pmtiles" "s3://$BUCKET/data/basemap/chennai.pmtiles" --content-type application/octet-stream --no-progress >/dev/null

echo "== site URL into the stack (alert emails link to it)"
sam deploy --stack-name "$STACK" --region "$AWS_REGION" --profile "$AWS_PROFILE" --resolve-s3 \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --no-confirm-changeset --no-fail-on-empty-changeset \
  --parameter-overrides "BedrockModelId=$MODEL_ID" "AdminToken=$ADMIN_TOKEN" "SiteUrl=$SITE" | tail -3

echo "== first forecast check"
curl -s -X POST "$API/admin/run" -H 'content-type: application/json' -d "{\"token\":\"$ADMIN_TOKEN\"}" | head -c 600; echo

echo "== build + deploy web (Amplify Hosting)"
cd "$ROOT/web"
VITE_DATA_BASE="https://$CDN/data" VITE_API_BASE="$API" npx vite build >/dev/null
rm -rf dist/data          # model data is served from CloudFront, not bundled with the site
rm -f "$ROOT/data/site.zip"; (cd dist && zip -qr "$ROOT/data/site.zip" .)
DEP=$(aws amplify create-deployment --app-id "$APP" --branch-name main --output json)
JOB=$(echo "$DEP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["jobId"])')
URL=$(echo "$DEP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["zipUploadUrl"])')
curl -s -T "$ROOT/data/site.zip" "$URL" -H 'Content-Type: application/zip' >/dev/null
aws amplify start-deployment --app-id "$APP" --branch-name main --job-id "$JOB" >/dev/null
for i in $(seq 1 60); do
  S=$(aws amplify get-job --app-id "$APP" --branch-name main --job-id "$JOB" --query job.summary.status --output text)
  [ "$S" = SUCCEED ] && break; [ "$S" = FAILED ] && { echo "Amplify deploy failed"; exit 1; }; sleep 5
done
echo "== live: $SITE"
cat > "$ROOT/data/deploy_outputs.json" <<EOF
{"bucket":"$BUCKET","cdn":"$CDN","api":"$API","site":"$SITE","model":"$MODEL_ID","amplify_app":"$APP"}
EOF
