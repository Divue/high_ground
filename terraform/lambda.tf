# ---------------------------------------------------------------- Lambda: layers, functions, roles, logs
# The function code is the repo's own (infra/functions, infra/layers), zipped as it is.
locals {
  infra = "${path.module}/../infra"

  functions = {
    subscribe      = { dir = "${local.infra}/functions/subscribe", timeout = 30, memory = 512, common = true, strands = false }
    forecast_check = { dir = "${local.infra}/functions/forecast_check", timeout = 180, memory = 512, common = true, strands = false }
    assistant      = { dir = "${local.infra}/functions/assistant", timeout = 90, memory = 1024, common = true, strands = true }
    geocode        = { dir = "${local.infra}/functions/geocode", timeout = 15, memory = 512, common = true, strands = false }
    current_json   = { dir = "${path.module}/lambda/current_json", timeout = 10, memory = 512, common = false, strands = false }
  }

  common_env = {
    DATA_BUCKET = aws_s3_bucket.data.bucket
    DATA_PREFIX = "data/"
    TABLE       = aws_dynamodb_table.subscribers.name
    TOPIC_ARN   = aws_sns_topic.alerts.arn
    MODEL_ID    = var.bedrock_model_id
  }
  # kept out of local.functions: a for_each map may not carry a sensitive value
  extra_env = {
    forecast_check = { ADMIN_TOKEN = var.admin_token, SITE_URL = local.site_url }
  }

  data_arn  = aws_s3_bucket.data.arn
  table_arn = aws_dynamodb_table.subscribers.arn

  # the same grants as the SAM policy templates the stack used (S3ReadPolicy, S3CrudPolicy, DynamoDBCrudPolicy)
  s3_read = {
    Effect   = "Allow"
    Action   = ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation", "s3:GetObjectVersion", "s3:GetLifecycleConfiguration"]
    Resource = [local.data_arn, "${local.data_arn}/*"]
  }
  s3_crud = {
    Effect = "Allow"
    Action = ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation", "s3:GetObjectVersion", "s3:PutObject",
    "s3:PutObjectAcl", "s3:GetLifecycleConfiguration", "s3:PutLifecycleConfiguration", "s3:DeleteObject"]
    Resource = [local.data_arn, "${local.data_arn}/*"]
  }
  ddb_crud = {
    Effect = "Allow"
    Action = ["dynamodb:GetItem", "dynamodb:DeleteItem", "dynamodb:PutItem", "dynamodb:Scan", "dynamodb:Query",
      "dynamodb:UpdateItem", "dynamodb:BatchWriteItem", "dynamodb:BatchGetItem", "dynamodb:DescribeTable",
    "dynamodb:ConditionCheckItem"]
    Resource = [local.table_arn, "${local.table_arn}/index/*"]
  }
  bedrock = {
    Effect   = "Allow"
    Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    Resource = "*"
  }

  policies = {
    subscribe = [local.ddb_crud, local.s3_read, {
      Effect   = "Allow"
      Action   = ["sns:Subscribe", "sns:ListSubscriptionsByTopic", "sns:SetSubscriptionAttributes"]
      Resource = [aws_sns_topic.alerts.arn, "${aws_sns_topic.alerts.arn}:*"] # the topic and its subscriptions
    }]
    forecast_check = [local.s3_crud, local.ddb_crud, local.bedrock, {
      Effect   = "Allow"
      Action   = "sns:Publish"
      Resource = aws_sns_topic.alerts.arn
    }]
    assistant = [local.s3_read, local.bedrock]
    # Amazon Location Service, Places API v2: no resource to create, only this grant
    geocode = [{
      Effect   = "Allow"
      Action   = ["geo-places:Geocode", "geo-places:Autocomplete", "geo-places:SearchText", "geo-places:Suggest"]
      Resource = "arn:aws:geo-places:${var.aws_region}::provider/default"
    }]
    current_json = [{
      Effect   = "Allow"
      Action   = "s3:GetObject"
      Resource = "${local.data_arn}/data/current.json"
    }]
  }
}

data "archive_file" "fn" {
  for_each    = local.functions
  type        = "zip"
  source_dir  = each.value.dir
  output_path = "${path.module}/build/${each.key}.zip"
  excludes    = ["__pycache__", "__pycache__/**", "**/__pycache__/**"]
}

data "archive_file" "common_layer" {
  type        = "zip"
  source_dir  = "${local.infra}/layers/common"
  output_path = "${path.module}/build/common_layer.zip"
  excludes    = ["python/__pycache__", "python/__pycache__/**", "**/__pycache__/**"]
}

resource "aws_lambda_layer_version" "common" {
  layer_name               = "${var.project}-common"
  description              = "HighGround shared helpers (hg.py): every number comes from model output files in S3"
  filename                 = data.archive_file.common_layer.output_path
  source_code_hash         = data.archive_file.common_layer.output_base64sha256
  compatible_runtimes      = ["python3.12"]
  compatible_architectures = ["x86_64"]
}

# the zip is put in the artifacts bucket by deploy.sh; a new key makes a new layer version
resource "aws_lambda_layer_version" "strands" {
  layer_name               = "${var.project}-strands"
  description              = "Strands Agents SDK (AWS open source) and dependencies"
  s3_bucket                = aws_s3_bucket.artifacts.bucket
  s3_key                   = var.strands_layer_key
  compatible_runtimes      = ["python3.12"]
  compatible_architectures = ["x86_64"]
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fn" {
  for_each           = local.functions
  name               = "${var.project}-${replace(each.key, "_", "-")}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "logs" {
  for_each   = local.functions
  role       = aws_iam_role.fn[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "fn" {
  for_each = local.functions
  name     = "access"
  role     = aws_iam_role.fn[each.key].id
  policy   = jsonencode({ Version = "2012-10-17", Statement = local.policies[each.key] })
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.functions
  name              = "/aws/lambda/${var.project}-${replace(each.key, "_", "-")}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "fn" {
  for_each         = local.functions
  function_name    = "${var.project}-${replace(each.key, "_", "-")}"
  role             = aws_iam_role.fn[each.key].arn
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  handler          = "app.handler"
  filename         = data.archive_file.fn[each.key].output_path
  source_code_hash = data.archive_file.fn[each.key].output_base64sha256
  timeout          = each.value.timeout
  memory_size      = each.value.memory
  layers = concat(
    each.value.common ? [aws_lambda_layer_version.common.arn] : [],
    each.value.strands ? [aws_lambda_layer_version.strands.arn] : [],
  )
  environment {
    variables = merge(local.common_env, lookup(local.extra_env, each.key, {}))
  }
  depends_on = [aws_cloudwatch_log_group.fn, aws_iam_role_policy_attachment.logs, aws_iam_role_policy.fn]
}

# ---------------------------------------------------------------- the 3-hourly forecast check
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.project}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler" {
  name = "invoke-forecast-check"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "lambda:InvokeFunction", Resource = aws_lambda_function.fn["forecast_check"].arn }]
  })
}

resource "aws_scheduler_schedule" "forecast_check" {
  name                = "${var.project}-forecast-check"
  description         = "HighGround forecast check"
  schedule_expression = "rate(3 hours)"
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = aws_lambda_function.fn["forecast_check"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
  depends_on = [aws_iam_role_policy.scheduler]
}
