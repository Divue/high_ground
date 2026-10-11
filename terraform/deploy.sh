#!/usr/bin/env bash
# HighGround on AWS with Terraform. Uses only the profile named in the repo's .env.
#
#   terraform/deploy.sh            every step, in order
#   terraform/deploy.sh infra      Terraform: S3, DynamoDB, SNS, Lambda (+ layers), API Gateway,
#                                  EventBridge Scheduler, Amplify Hosting, IAM, logs, budget alarm
#   terraform/deploy.sh data       the model outputs the Lambdas read -> s3://<data bucket>/data/
#   terraform/deploy.sh forecast   run forecast-check once, so tonight's forecast exists
#   terraform/deploy.sh site       build the web app, bundle it with the model outputs, publish on Amplify
#   terraform/deploy.sh outputs    write data/deploy_outputs.json (pipeline/gates.py p4/p5 read it)
#   terraform/deploy.sh destroy    remove everything Terraform created (the budget alarm included)
#
# No CloudFront distribution of our own: AWS does not create CloudFront resources on this account until
# Support has verified it, so Amplify Hosting serves the site and its data from one address.
# Nothing in pipeline/, infra/ or web/ is edited: the functions are zipped as they are and the site is
# built from the working tree.
set -euo pipefail
cd "$(dirname "$0")"
TF=$(pwd)
ROOT=$(cd .. && pwd)
set -a; source "$ROOT/.env"; set +a
: "${AWS_PROFILE:?AWS_PROFILE missing in .env}"
: "${AWS_REGION:?AWS_REGION missing in .env}"
export AWS_PROFILE AWS_REGION AWS_DEFAULT_REGION=$AWS_REGION
export PATH=$HOME/.local/bin:$HOME/.nvm/versions/node/v24.21.0/bin:$PATH
mkdir -p "$TF/build" "$ROOT/data"

[ -s "$ROOT/data/admin_token" ] || openssl rand -hex 12 > "$ROOT/data/admin_token"
export TF_VAR_aws_region=$AWS_REGION TF_VAR_aws_profile=$AWS_PROFILE
export TF_VAR_admin_token=$(tr -d '\n' < "$ROOT/data/admin_token")
NOTIFY=${ALERT_TEST_EMAIL:-}
[[ "$NOTIFY" == *@* && "$NOTIFY" != "you@example.com" ]] && export TF_VAR_alert_email=$NOTIFY
[ -s "$TF/build/strands_key" ] && export TF_VAR_strands_layer_key=$(cat "$TF/build/strands_key")

# The uplink here is slow and lossy: a large file goes up in 5 MB parts, two at a time, with patient retries
# (ten parts at once lost a part; one long PUT timed out).
UPCFG=$TF/build/aws_upload_config
[ "$AWS_PROFILE" = default ] && SECTION=default || SECTION="profile $AWS_PROFILE"
printf '[%s]\nregion = %s\nretry_mode = standard\nmax_attempts = 10\ns3 =\n    max_concurrent_requests = 2\n    multipart_chunksize = 5MB\n    multipart_threshold = 5MB\n' \
  "$SECTION" "$AWS_REGION" > "$UPCFG"
big_cp() { AWS_CONFIG_FILE="$UPCFG" aws s3 cp "$1" "$2" --no-progress; }

out() { terraform -chdir="$TF" output -raw "$1"; }

infra() {
  echo "== identity"
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  echo "account ${ACCOUNT:0:4}******** region $AWS_REGION profile $AWS_PROFILE"
  terraform -chdir="$TF" init -input=false >/dev/null

  echo "== artefact bucket, then the Strands layer zip"
  [ -d "$ROOT/infra/layers/strands/python/strands" ] || { echo "Strands layer missing: build it first (see README)"; exit 1; }
  TF_VAR_strands_layer_key=${TF_VAR_strands_layer_key:-pending} terraform -chdir="$TF" apply -input=false -auto-approve \
    -target=aws_s3_bucket.artifacts -target=aws_s3_bucket_public_access_block.artifacts \
    -target=aws_s3_bucket_server_side_encryption_configuration.artifacts | tail -4
  ART=$(out artifacts_bucket)
  if [ ! -s "$TF/build/strands_key" ] || ! aws s3api head-object --bucket "$ART" --key "$(cat "$TF/build/strands_key")" >/dev/null 2>&1; then
    if [ -n "${STRANDS_ZIP_S3:-}" ]; then
      # the same zip is already in the account (an earlier deploy): copy it inside S3, no upload
      KEY="layers/strands-$(basename "$STRANDS_ZIP_S3" | cut -c1-12).zip"
      aws s3 cp "$STRANDS_ZIP_S3" "s3://$ART/$KEY" --no-progress
    else
      [ -s "$TF/build/strands_layer.zip" ] || (cd "$ROOT/infra/layers/strands" && zip -qr -X "$TF/build/strands_layer.zip" python -x '*/__pycache__/*')
      KEY="layers/strands-$(sha256sum "$TF/build/strands_layer.zip" | cut -c1-12).zip"
      big_cp "$TF/build/strands_layer.zip" "s3://$ART/$KEY"
    fi
    echo "$KEY" > "$TF/build/strands_key"
  fi
  export TF_VAR_strands_layer_key=$(cat "$TF/build/strands_key")

  echo "== everything else"
  terraform -chdir="$TF" apply -input=false -auto-approve
}

data() {
  BUCKET=$(out data_bucket)
  echo "== upload the model outputs the Lambdas read -> s3://$BUCKET/data/"
  # Stored as they are (the Lambdas read the bytes directly); browsers get their copy from Amplify Hosting.
  # size + time (not --size-only): a re-export that keeps a file's size must still upload.
  AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=10 aws s3 sync "$ROOT/data/out/web/" "s3://$BUCKET/data/" --exclude "*" \
    --include "streets/*" --include "parking.json" --include "hospitals.json" --include "graph/nodes.bin" \
    --include "graph/edges.bin" --include "graph/len.bin" --include "graph/depth_*.bin" --no-progress | tail -3
  echo "objects under data/: $(aws s3 ls "s3://$BUCKET/data/" --recursive | wc -l)"
}

forecast() {
  echo "== first forecast check"
  curl -s -X POST "$(out api_url)/admin/run" -H 'content-type: application/json' \
    -d "{\"token\":\"$TF_VAR_admin_token\"}" | head -c 600; echo
}

site() {
  API=$(out api_url); APP=$(out amplify_app_id); ART=$(out artifacts_bucket); SITE=$(out site_url)
  echo "== build the web app (data on the site's own address, API at $API)"
  cd "$ROOT/web"
  VITE_API_BASE="$API" npx vite build >/dev/null
  rm -f dist/data/current.json   # tonight's forecast comes through the API (an Amplify rule passes it on)
  rm -f "$TF/build/site.zip"; (cd dist && zip -qr "$TF/build/site.zip" .)
  echo "site.zip $(du -h "$TF/build/site.zip" | cut -f1), $(find dist -type f | wc -l) files"
  echo "== upload the bundle, then Amplify fetches it"
  big_cp "$TF/build/site.zip" "s3://$ART/deploy/site.zip" >/dev/null
  # a run that stopped half-way leaves an unfinished job, and Amplify refuses a new one until it is cancelled
  for j in $(aws amplify list-jobs --app-id "$APP" --branch-name main \
      --query "jobSummaries[?status=='PENDING' || status=='CREATED' || status=='RUNNING'].jobId" --output text); do
    aws amplify stop-job --app-id "$APP" --branch-name main --job-id "$j" >/dev/null
  done
  SRC=$(aws s3 presign "s3://$ART/deploy/site.zip" --expires-in 3600)
  JOB=$(aws amplify start-deployment --app-id "$APP" --branch-name main --source-url "$SRC" --source-url-type ZIP \
    --query jobSummary.jobId --output text)
  S=PENDING
  for i in $(seq 1 360); do
    # a dropped connection while asking is not a failed deploy: ask again
    S=$(aws amplify get-job --app-id "$APP" --branch-name main --job-id "$JOB" --query job.summary.status --output text 2>/dev/null || echo UNKNOWN)
    [ "$S" = SUCCEED ] && break; [ "$S" = FAILED ] && { echo "Amplify deploy failed"; exit 1; }; sleep 5
  done
  [ "$S" = SUCCEED ] || { echo "Amplify deploy still $S after 30 minutes"; exit 1; }
  echo "== live: $SITE"
}

outputs() {
  cat > "$ROOT/data/deploy_outputs.json" <<EOF
{"bucket":"$(out data_bucket)","api":"$(out api_url)","site":"$(out site_url)","model":"$(out bedrock_model_id)","amplify_app":"$(out amplify_app_id)","deployed_with":"terraform"}
EOF
  cat "$ROOT/data/deploy_outputs.json"
}

case "${1:-all}" in
  infra) infra ;;
  data) data ;;
  forecast) forecast ;;
  site) site ;;
  outputs) outputs ;;
  destroy) TF_VAR_strands_layer_key=${TF_VAR_strands_layer_key:-none} terraform -chdir="$TF" destroy -input=false ;;
  all) infra; forecast; site; data; outputs ;;
  *) echo "usage: $0 [infra|data|forecast|site|outputs|destroy]"; exit 2 ;;
esac
