# HighGround on AWS with Terraform

Everything HighGround runs on AWS is created from the `terraform/` folder and published with one script, `terraform/deploy.sh`. This page says what that creates, how to deploy and redeploy, and what to check when something looks wrong.

Live address as of 11 Oct 2026: <https://main.de7nem2wvfa4y.amplifyapp.com> (landing page at `/`, map at `/app`).

The older AWS SAM template in `infra/template.yaml` and `infra/deploy.sh` are not used by this deployment. Terraform zips the same function code from `infra/functions/` and `infra/layers/`, so there is one copy of the code and two ways it was once deployed. Use this one.

## What you need before the first run

- **Terraform 1.6 or newer** and **AWS CLI v2** on your PATH. Tested with Terraform 1.16.5, AWS provider 6.68.0, archive provider 2.8.1.
- **Node** for the site build. The script looks for `~/.nvm/versions/node/v24.21.0`; change that line in `deploy.sh` if your version differs.
- `zip`, `curl` and `openssl`.
- **`.env` in the repo root** with `AWS_PROFILE`, `AWS_REGION` and `ALERT_TEST_EMAIL`. The script uses only that profile. The email is where the budget alarm writes.
- **The model outputs** in `data/out/web/` (made by the pipeline). The site build bundles them.
- **The Strands layer**, built once into `infra/layers/strands/python/` (the command is in the README). The script stops with a clear message if it is missing.

`data/admin_token` is created on the first run if it does not exist. It is the shared secret for the admin "Run now" button.

## Commands

Run these from the repo root.

| Command | What it does | When to use it |
|---|---|---|
| `terraform/deploy.sh` | Every step below, in the order infra, forecast, site, data, outputs | First deploy, or after a destroy |
| `terraform/deploy.sh infra` | `terraform apply`: all AWS resources, including the Lambda code | You changed a `.tf` file or anything under `infra/functions/` or `infra/layers/` |
| `terraform/deploy.sh data` | Syncs the model outputs the Lambdas read to the data bucket | You re-ran the pipeline |
| `terraform/deploy.sh forecast` | Runs the forecast check once so tonight's forecast exists | After a first deploy, or to refresh by hand |
| `terraform/deploy.sh site` | Builds the web app, bundles it with the model outputs, publishes it on Amplify | You changed anything under `web/`, or re-ran the pipeline |
| `terraform/deploy.sh outputs` | Writes `data/deploy_outputs.json` (addresses and names other scripts read) | After `infra` |
| `terraform/deploy.sh destroy` | Removes everything Terraform created | See "Removing everything" first |

A frontend-only change needs `site` and nothing else. It does not run Terraform; it only reads the Amplify app, bucket and API address from the state.

### Looking before you apply

`terraform plan` needs the same values the script passes in. Run it like this:

```bash
set -a; source .env; set +a
export TF_VAR_aws_region=$AWS_REGION TF_VAR_aws_profile=$AWS_PROFILE
export TF_VAR_admin_token=$(tr -d '\n' < data/admin_token)
export TF_VAR_alert_email=$ALERT_TEST_EMAIL
export TF_VAR_strands_layer_key=$(cat terraform/build/strands_key)
terraform -chdir=terraform plan
```

Without these, Terraform asks for the token and the layer key at the prompt, and a blank email would plan to remove the budget notification.

## What gets created

57 resources, all tagged `Project = highground` and `ManagedBy = terraform`, in the region from `.env` (us-east-1).

| File | Resources |
|---|---|
| `storage.tf` | Two private, encrypted S3 buckets: **data** (the model outputs the Lambdas read) and **artifacts** (the Strands layer zip and the site bundle). DynamoDB table `highground-subscribers` (pay per request). SNS topic `highground-alerts`. |
| `lambda.tf` | Five Lambda functions (Python 3.12), two layers, one IAM role and one log group per function (logs kept 14 days), and the EventBridge Scheduler schedule that runs the forecast check every 3 hours. |
| `api.tf` | One API Gateway HTTP API with five routes, limited to 20 requests a second (burst 40) because the endpoints are open to the internet. |
| `site.tf` | The Amplify Hosting app and its `main` branch, with the rewrite rules and cache headers. The budget alarm `highground-30usd` ($30 a month, email at 80%). |

### The functions

| Function | Code | Timeout, memory | May touch |
|---|---|---|---|
| `highground-subscribe` | `infra/functions/subscribe` | 30 s, 512 MB | Subscribers table, read the data bucket, subscribe emails to the topic |
| `highground-forecast-check` | `infra/functions/forecast_check` | 180 s, 512 MB | Read and write the data bucket, subscribers table, publish to the topic, call Bedrock |
| `highground-assistant` | `infra/functions/assistant` | 90 s, 1024 MB | Read the data bucket, call Bedrock. Uses the Strands layer |
| `highground-geocode` | `infra/functions/geocode` | 15 s, 512 MB | Amazon Location Service place search |
| `highground-current-json` | `terraform/lambda/current_json` | 10 s, 512 MB | Read one file: `data/current.json` |

The first four share the `highground-common` layer (`infra/layers/common`). `current_json` is the only code that lives in the Terraform folder: it is deployment glue that hands the site tonight's forecast.

### The routes

| Route | Goes to |
|---|---|
| `POST /subscribe` | subscribe |
| `POST /admin/run` | forecast check (needs the admin token) |
| `POST /ask` | assistant |
| `GET /data/current.json` | current_json |
| `POST /geocode` | geocode if address search is on, otherwise current_json, which answers with an empty list |

## How a request reaches the app

```
Browser ──► Amplify Hosting ──► the site, and the model outputs under /data/
                    │
                    └─ /data/current.json ──► API Gateway ──► current_json ──► S3 (data bucket)

Browser ──► API Gateway ──► subscribe ──► DynamoDB, SNS
                        ──► assistant ──► S3, Bedrock
                        ──► forecast check (admin run)

EventBridge Scheduler (every 3 hours) ──► forecast check ──► Open-Meteo ──► S3 current.json ──► SNS email
```

Two Amplify rules do the routing on the site's own address:

1. `/data/current.json` is passed on to the API, because the forecast changes every 3 hours and the published site does not.
2. Any path that does not end in a known file extension is answered with `index.html`. This is what makes `/` (landing page) and `/app` (map) both work.

**If you add a new kind of file to the site** (for example `.mp4`, `.glb` or `.avif`), add its extension to the list in rule 2 in `site.tf` and run `infra`. Otherwise Amplify serves `index.html` in its place with a 200 status, and the file silently fails to load.

Cache headers: `sw.js`, `index.html`, `manifest.webmanifest` and `/data/current.json` are never cached; everything under `/assets/` is cached for a year (the file names carry a hash). Terraform ignores later changes to these headers, because Amplify hands them back in a different format and every plan would show a false difference. To change them, edit them in `site.tf`, remove the `lifecycle` block for one apply, then put it back.

## Settings

Set through `TF_VAR_<name>` in the environment; `deploy.sh` fills in the first five from `.env`, `data/admin_token` and `terraform/build/strands_key`.

| Variable | Default | Meaning |
|---|---|---|
| `aws_region` | `us-east-1` | From `.env` |
| `aws_profile` | `default` | From `.env` |
| `admin_token` | none | From `data/admin_token`. Marked sensitive |
| `alert_email` | empty | From `ALERT_TEST_EMAIL`. Empty means the budget has no notification |
| `strands_layer_key` | none | Where the script put the Strands layer zip in the artifacts bucket |
| `bedrock_model_id` | `us.anthropic.claude-sonnet-5-5` | Model for the assistant and the alert writer |
| `enable_address_search` | `false` | Sends `POST /geocode` to Amazon Location. See "Known limits" |
| `log_retention_days` | `14` | Lambda log retention |
| `project` | `highground` | Prefix for every resource name |

Example: `TF_VAR_enable_address_search=true terraform/deploy.sh infra`.

## State and secrets

- The Terraform state is a **local file**, `terraform/terraform.tfstate`. It is not in git, and it holds the admin token in plain text. Do not commit it or paste it anywhere.
- It exists **only on the laptop that ran the deploy**. Without it Terraform cannot change or remove what it created, so only that laptop can run `infra` or `destroy`. Keep a private copy somewhere safe. Never run `terraform apply` from a second machine with an empty state: it would try to create everything again.
- Also outside git: `.env`, `data/admin_token`, `data/deploy_outputs.json`, and `terraform/build/` (function zips, the site bundle, the upload settings).

## How the site is published

`deploy.sh site` does this:

1. Builds `web/` with the API address baked in. The build copies the model outputs into the bundle, so the site and its data are served from one address, as in local development.
2. Removes `current.json` from the bundle (rule 1 above serves it live).
3. Zips the result. On 11 Oct the bundle was 168 MB and 5,902 files.
4. Uploads the zip to the artifacts bucket in 5 MB parts, two at a time, with up to ten retries each.
5. Stops any unfinished Amplify job, then asks Amplify to fetch the zip from a link valid for one hour.
6. Waits for the Amplify job, asking every 5 seconds for up to 30 minutes.

The upload is the slow step: allow 20 to 40 minutes on a home uplink. On 11 Oct the whole `site` step ran from 21:10 to 21:49 IST, almost all of it upload; the Amplify job then took 18 seconds (about 3 minutes on the first publish that afternoon).

## Known limits of this deployment

- **No CloudFront distribution of our own.** AWS will not create CloudFront resources on this new account until Support has verified it. Amplify Hosting serves the site and the model outputs instead.
- **The assistant does not answer yet.** Bedrock refuses every call on this account for the same reason, so `POST /ask` returns an error. Alert emails fall back to their template wording.
- **Address search through Amazon Location is switched off.** The function is deployed and works when called directly. With the site's search code as deployed, turning it on lists Amazon's addresses above the app's own streets, and a picked street can answer for the wrong stretch. Off, the site searches its own places and streets.
- **The budget alarm is adopted, not created.** `site.tf` imports the existing `highground-30usd` budget. In an AWS account where that budget does not exist, remove the `import` block and Terraform will create it.
- **Email alerts need one manual step.** A new subscriber must click the confirmation link AWS sends before any alert reaches them.

## Removing everything

`terraform/deploy.sh destroy` deletes all 57 resources. Both buckets are emptied and deleted with their contents, the subscriber list is lost, and the budget alarm goes too.

The live address does not survive it. A later deploy creates a new Amplify app and a new API with new addresses, so every shared link and the address baked into the site change. Run the full `terraform/deploy.sh` afterwards, not single steps.

## When something looks wrong

**I deployed, but I still see the old site.** The app installs a service worker for offline use, and a new version waits until every HighGround tab is closed, so nobody's page reloads in the middle of a storm. Close all tabs of the site and open it again, or open it in a private window. People who have never visited get the new version straight away.

**The script stopped during the upload or while waiting.** Run `terraform/deploy.sh site` again. It starts the upload from the beginning and cancels the unfinished Amplify job first.

**A file on the live site comes back as the app's HTML.** Its extension is not in rule 2. See "How a request reaches the app".

**The Tonight card says the forecast is out of date.** Check that the schedule is running and that the forecast check succeeds:

```bash
aws scheduler get-schedule --name highground-forecast-check --query State
aws logs tail /aws/lambda/highground-forecast-check --since 6h
```

Then run `terraform/deploy.sh forecast` to refresh it by hand.

**An interrupted upload left parts behind.** They sit in the artifacts bucket and cost a little storage until removed:

```bash
BUCKET=$(terraform -chdir=terraform output -raw artifacts_bucket)
aws s3api list-multipart-uploads --bucket "$BUCKET"
aws s3api abort-multipart-upload --bucket "$BUCKET" --key deploy/site.zip --upload-id <id from the list>
```

**Where are the addresses?** `terraform -chdir=terraform output` prints the site address, API address, bucket names and table name. `data/deploy_outputs.json` holds the same after `deploy.sh outputs`.
